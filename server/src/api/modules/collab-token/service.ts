import type { z } from 'zod';
import { signCollabToken } from '../../../core/collab-token.js';
import type { Config } from '../../../core/config.js';
import type { Db } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { requireProject } from '../../../core/permissions.js';
import type { CollabTokenResponseSchema } from '../../../shared/api/projects.js';
import { pickCollabColor } from '../../../shared/collab-colors.js';
import { documentNameFor } from '../../../shared/document/keys.js';
import type { Actor } from '../../types.js';

export interface CollabTokenDeps {
  db: Db;
  config: Pick<Config, 'collabTokenSecret' | 'collabOrigin'>;
}

export function collabUrl(origin: string): string {
  return new URL(origin).origin.replace(/^http/, 'ws');
}

// INSERT … ON CONFLICT DO NOTHING y relectura: dos peticiones a la vez acaban con el mismo color.
async function colorFor(db: Db, projectId: string, userId: string): Promise<string> {
  const existing = await db.projectColor.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { color: true },
  });
  if (existing) return existing.color;
  const used = await db.projectColor.findMany({ where: { projectId }, select: { color: true } });
  const color = pickCollabColor(userId, used.map((row) => row.color));
  await db.projectColor.createMany({ data: [{ projectId, userId, color }], skipDuplicates: true });
  const stored = await db.projectColor.findUniqueOrThrow({
    where: { projectId_userId: { projectId, userId } },
    select: { color: true },
  });
  return stored.color;
}

export async function issueCollabToken(
  deps: CollabTokenDeps,
  actor: Actor,
  projectId: string,
): Promise<z.infer<typeof CollabTokenResponseSchema>> {
  const access = await requireProject(deps.db, actor.userId, projectId);
  const user = await deps.db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true } });
  if (!user) throw new AppError('UNAUTHORIZED');
  const [color, document] = await Promise.all([
    colorFor(deps.db, projectId, actor.userId),
    deps.db.projectDocument.findUnique({ where: { projectId }, select: { epoch: true } }),
  ]);
  const epoch = document?.epoch ?? 1;
  const token = await signCollabToken(deps.config.collabTokenSecret, {
    sub: user.id,
    pid: projectId,
    role: access.role,
    sid: actor.sessionId,
    ep: epoch,
  });
  return {
    token,
    url: collabUrl(deps.config.collabOrigin),
    documentName: documentNameFor(projectId),
    role: access.role,
    user: { id: user.id, name: user.name, color },
    epoch,
  };
}
