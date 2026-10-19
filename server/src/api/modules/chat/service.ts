import type { z } from 'zod';
import { incrementDaily } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { publishProjectEvent } from '../../../core/events.js';
import type { LogSink } from '../../../core/logger.js';
import { loadProjectAccess, requireProject } from '../../../core/permissions.js';
import type { Redis } from '../../../core/redis.js';
import {
  CHAT_LIMITS,
  type ChatListQuerySchema,
  type ChatMessageDto,
  type CreateChatMessageBodySchema,
  type UpdateChatMessageBodySchema,
} from '../../../shared/api/chat.js';
import { can } from '../../../shared/permissions.js';
import type { Actor } from '../../types.js';

export interface ChatDeps {
  db: Db;
  redis: Redis;
  logger: LogSink;
}

const messageSelect = {
  id: true,
  projectId: true,
  authorId: true,
  body: true,
  replyToId: true,
  attachments: true,
  mentions: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
} as const;

interface MessageRow {
  id: string;
  projectId: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  attachments: string[];
  mentions: string[];
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

// Por puntos de código, para no partir un emoji.
function excerptOf(body: string): string {
  const chars = Array.from(body);
  return chars.length > CHAT_LIMITS.excerptMax ? `${chars.slice(0, CHAT_LIMITS.excerptMax).join('')}…` : body;
}

async function present(db: Db, rows: MessageRow[]): Promise<ChatMessageDto[]> {
  if (rows.length === 0) return [];
  const replyIds = [...new Set(rows.flatMap((row) => (row.replyToId ? [row.replyToId] : [])))];
  const replies = replyIds.length
    ? await db.chatMessage.findMany({
        where: { id: { in: replyIds } },
        select: { id: true, projectId: true, authorId: true, body: true, deletedAt: true },
      })
    : [];
  const userIds = [...new Set([...rows.map((row) => row.authorId), ...replies.map((reply) => reply.authorId)])];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, avatarAssetId: true } });
  const userById = new Map(users.map((user) => [user.id, user]));
  const replyById = new Map(replies.map((reply) => [reply.id, reply]));

  return rows.map((row) => {
    const author = userById.get(row.authorId);
    const deleted = row.deletedAt !== null;
    let replyTo: ChatMessageDto['replyTo'] = null;
    if (row.replyToId) {
      const original = replyById.get(row.replyToId);
      const gone = !original || original.projectId !== row.projectId || original.deletedAt !== null;
      replyTo = {
        id: row.replyToId,
        authorName: original ? (userById.get(original.authorId)?.name ?? null) : null,
        excerpt: gone ? '' : excerptOf(original.body),
        deleted: gone,
      };
    }
    return {
      id: row.id,
      projectId: row.projectId,
      author: { id: row.authorId, name: author?.name ?? null, avatarAssetId: author?.avatarAssetId ?? null },
      body: deleted ? '' : row.body,
      replyTo,
      attachments: deleted ? [] : row.attachments,
      mentions: deleted ? [] : row.mentions,
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

async function publishMessage(deps: ChatDeps, message: ChatMessageDto) {
  try {
    await publishProjectEvent(deps.redis, message.projectId, { type: 'chat.message', message });
  } catch (error) {
    deps.logger.error(
      { err: { message: (error as Error).message }, projectId: message.projectId },
      'No se pudo publicar chat.message',
    );
  }
}

// Solo se puede mencionar a quien tiene acceso efectivo al proyecto.
async function checkMentions(db: Db, projectId: string, mentions: string[]): Promise<void> {
  const access = await Promise.all(mentions.map((userId) => loadProjectAccess(db, userId, projectId)));
  const issues = mentions.flatMap((_userId, index) =>
    access[index] ? [] : [{ path: `body.mentions.${index}`, message: 'sin acceso al proyecto' }],
  );
  if (issues.length) throw new AppError('VALIDATION_FAILED', { details: { issues } });
}

async function checkAttachments(db: Db, projectId: string, attachments: string[]): Promise<void> {
  if (attachments.length === 0) return;
  const found = await db.asset.count({
    where: { id: { in: attachments }, projectId, status: 'ready', deletedAt: null },
  });
  if (found !== attachments.length) throw new AppError('INVALID_ATTACHMENT');
}

export async function listMessages(
  deps: ChatDeps,
  actor: Actor,
  projectId: string,
  query: z.infer<typeof ChatListQuerySchema>,
): Promise<{ items: ChatMessageDto[]; nextCursor: string | null }> {
  await requireProject(deps.db, actor.userId, projectId);
  let before: { id: string; createdAt: Date } | null = null;
  if (query.before) {
    before = await deps.db.chatMessage.findFirst({
      where: { id: query.before, projectId },
      select: { id: true, createdAt: true },
    });
    if (!before) return { items: [], nextCursor: null };
  }
  const rows = await deps.db.chatMessage.findMany({
    where: {
      projectId,
      ...(before
        ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: messageSelect,
  });
  const page = rows.slice(0, query.limit).reverse();
  return {
    items: await present(deps.db, page),
    nextCursor: rows.length > query.limit ? (page[0]?.id ?? null) : null,
  };
}

export async function createMessage(
  deps: ChatDeps,
  actor: Actor,
  projectId: string,
  body: z.infer<typeof CreateChatMessageBodySchema>,
): Promise<ChatMessageDto> {
  await requireProject(deps.db, actor.userId, projectId, 'chat:write');
  const attachments = [...new Set(body.attachments ?? [])];
  const mentions = [...new Set(body.mentions ?? [])];
  await checkAttachments(deps.db, projectId, attachments);
  if (body.replyToId) {
    const original = await deps.db.chatMessage.findFirst({
      where: { id: body.replyToId, projectId },
      select: { id: true },
    });
    if (!original) {
      throw new AppError('VALIDATION_FAILED', {
        details: { issues: [{ path: 'body.replyToId', message: 'el mensaje no existe en este proyecto' }] },
      });
    }
  }
  await checkMentions(deps.db, projectId, mentions);

  const row = await deps.db.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        projectId,
        authorId: actor.userId,
        body: body.body,
        replyToId: body.replyToId ?? null,
        attachments,
        mentions,
      },
      select: messageSelect,
    });
    await incrementDaily(tx, { projectId, userId: actor.userId, counter: 'chatMessages', at: created.createdAt });
    return created;
  });
  const [message] = await present(deps.db, [row]);
  await publishMessage(deps, message!);
  return message!;
}

export async function updateMessage(
  deps: ChatDeps,
  actor: Actor,
  projectId: string,
  messageId: string,
  body: z.infer<typeof UpdateChatMessageBodySchema>,
): Promise<ChatMessageDto> {
  await requireProject(deps.db, actor.userId, projectId, 'chat:write');
  const existing = await deps.db.chatMessage.findFirst({
    where: { id: messageId, projectId, deletedAt: null },
    select: { authorId: true, mentions: true },
  });
  if (!existing) throw new AppError('NOT_FOUND');
  if (existing.authorId !== actor.userId) throw new AppError('FORBIDDEN');
  const mentions = body.mentions ? [...new Set(body.mentions)] : existing.mentions;
  if (body.mentions) await checkMentions(deps.db, projectId, mentions);

  const { count } = await deps.db.chatMessage.updateMany({
    where: { id: messageId, deletedAt: null },
    data: { body: body.body, mentions, editedAt: new Date() },
  });
  if (count === 0) throw new AppError('NOT_FOUND');
  const row = await deps.db.chatMessage.findUniqueOrThrow({ where: { id: messageId }, select: messageSelect });
  const [message] = await present(deps.db, [row]);
  await publishMessage(deps, message!);
  return message!;
}

// Borrado lógico: el autor o un admin del proyecto. Repetirlo no cambia nada.
export async function deleteMessage(deps: ChatDeps, actor: Actor, projectId: string, messageId: string): Promise<void> {
  const access = await requireProject(deps.db, actor.userId, projectId);
  const existing = await deps.db.chatMessage.findFirst({
    where: { id: messageId, projectId },
    select: { authorId: true, deletedAt: true },
  });
  if (!existing) throw new AppError('NOT_FOUND');
  const own = existing.authorId === actor.userId && can(access.role, 'chat:write');
  if (!own && !can(access.role, 'chat:moderate')) throw new AppError('FORBIDDEN');
  if (existing.deletedAt) return;

  const { count } = await deps.db.chatMessage.updateMany({
    where: { id: messageId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count === 0) return;
  const row = await deps.db.chatMessage.findUniqueOrThrow({ where: { id: messageId }, select: messageSelect });
  const [message] = await present(deps.db, [row]);
  await publishMessage(deps, message!);
}
