import type { z } from 'zod';
import * as Y from 'yjs';
import { recordActivity } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { flushLiveDocument } from '../../../core/document/live-state.js';
import { collectAssetRefs, remapAssetIds, remapDocumentAssets } from '../../../core/document/remap-assets.js';
import { AppError, isAppError } from '../../../core/errors.js';
import { isUuid, uuidv7 } from '../../../core/ids.js';
import { objectKeysOf } from '../../../core/jobs/purge.js';
import type { LogSink } from '../../../core/logger.js';
import { requireProject, requireWorkspace, type WorkspaceAccess } from '../../../core/permissions.js';
import type { RpcClient } from '../../../core/rpc.js';
import type { StorageDriver } from '../../../core/storage/index.js';
import { storedContent } from '../../../core/versions.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ProjectSummary } from '../../../shared/api/projects.js';
import type {
  PublishTemplateBodySchema,
  TemplateLikeResponse,
  TemplateListQuery,
  TemplateSummary,
} from '../../../shared/api/templates.js';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { documentSchemaVersion, migrate } from '../../../shared/document/migrations.js';
import { DOCUMENT_SCHEMA_VERSION } from '../../../shared/document/schema.js';
import type { Actor } from '../../types.js';
import { loadVisibleAssets } from '../assets/access.js';
import { copyAsset, type AssetCopyTarget, type CopySource } from '../assets/service.js';
import { summarySelect, toSummary as toProjectSummary } from '../projects/summary.js';

export interface TemplateDeps {
  db: Db;
  storage: StorageDriver;
  rpc: RpcClient;
  logger: LogSink;
}

type StorageDeps = Pick<TemplateDeps, 'db' | 'storage' | 'logger'>;

// Mientras se copian los assets la plantilla existe con esta versión y no aparece en ningún sitio.
const PUBLISHING_SCHEMA_VERSION = 0;
const published = { schemaVersion: { gte: 1 } } as const;

const templateSelect = (userId: string) =>
  ({
    id: true,
    organizationId: true,
    name: true,
    description: true,
    createdById: true,
    previewAssetId: true,
    likesCount: true,
    createdAt: true,
    likes: { where: { userId }, select: { userId: true }, take: 1 },
  }) as const;

type TemplateRow = Prisma.TemplateGetPayload<{ select: ReturnType<typeof templateSelect> }>;

const copySourceSelect = {
  id: true,
  source: true,
  storageKey: true,
  variants: true,
  mime: true,
  sizeBytes: true,
  width: true,
  height: true,
  sha256: true,
  name: true,
  inGallery: true,
} as const;

async function present(db: Db, userId: string, rows: TemplateRow[]): Promise<TemplateSummary[]> {
  if (rows.length === 0) return [];
  const creatorIds = [...new Set(rows.flatMap((row) => (row.createdById ? [row.createdById] : [])))];
  const [users, favorites] = await Promise.all([
    creatorIds.length ? db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : [],
    db.favorite.findMany({
      where: { userId, targetType: 'template', targetId: { in: rows.map((row) => row.id) } },
      select: { targetId: true },
    }),
  ]);
  const names = new Map(users.map((user) => [user.id, user.name]));
  const favoriteIds = new Set(favorites.map((favorite) => favorite.targetId));
  return rows.map((row) => {
    const creatorName = row.createdById ? names.get(row.createdById) : undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      scope: row.organizationId ? 'workspace' : 'parcify',
      createdBy: row.createdById && creatorName !== undefined ? { id: row.createdById, name: creatorName } : null,
      previewAssetId: row.previewAssetId,
      likesCount: row.likesCount,
      liked: row.likes.length > 0,
      favorite: favoriteIds.has(row.id),
      createdAt: row.createdAt.toISOString(),
    };
  });
}

async function deleteKeys(deps: StorageDeps, keys: string[], context: Record<string, unknown>): Promise<void> {
  if (keys.length === 0) return;
  try {
    await deps.storage.delete(keys);
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, ...context }, 'No se pudieron borrar objetos del storage');
  }
}

// Copia todos o ninguno: si una copia falla, se borran las anteriores y se lanza STORAGE_ERROR.
async function copyAll(
  deps: StorageDeps,
  sources: CopySource[],
  target: (source: CopySource) => AssetCopyTarget,
  written: string[],
): Promise<Map<string, string>> {
  const remap = new Map<string, string>();
  for (const source of sources) {
    try {
      const copy = await copyAsset(deps, source, target(source));
      written.push(...copy.keys);
      remap.set(source.id, copy.id);
    } catch (error) {
      deps.logger.error({ err: { message: (error as Error).message }, assetId: source.id }, 'No se pudo copiar el asset');
      throw new AppError('STORAGE_ERROR', { cause: error });
    }
  }
  return remap;
}

function documentRefs(state: Uint8Array): string[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return collectAssetRefs(doc).filter(isUuid);
  } finally {
    doc.destroy();
  }
}

// Plantilla visible para el usuario: del espacio (siendo miembro) o de Parcify.
async function requireTemplate(db: Db, userId: string, templateId: string, minRole?: 'admin') {
  const template = await db.template.findFirst({
    where: { id: templateId, ...published },
    select: { id: true, organization: { select: { slug: true } } },
  });
  if (!template) throw new AppError('NOT_FOUND');
  if (!template.organization) {
    if (minRole) throw new AppError('FORBIDDEN');
    return template;
  }
  try {
    await requireWorkspace(db, userId, template.organization.slug, minRole ? { minRole } : {});
  } catch (error) {
    if (isAppError(error) && error.code === 'WORKSPACE_NOT_FOUND') throw new AppError('NOT_FOUND');
    throw error;
  }
  return template;
}

export async function requireVisibleTemplate(db: Db, userId: string, templateId: string): Promise<void> {
  await requireTemplate(db, userId, templateId);
}

// El estado se pide por RPC a collab; los assets se copian a claves propias de la plantilla para que no dependa
// del proyecto de origen.
export async function publishTemplate(
  deps: TemplateDeps,
  actor: Actor,
  projectId: string,
  body: z.infer<typeof PublishTemplateBodySchema>,
): Promise<TemplateSummary> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'template:publish');
  if (!access.orgRole) throw new AppError('FORBIDDEN');
  if (access.project.workspaceDeleted) throw new AppError('WORKSPACE_IN_TRASH');
  await flushLiveDocument(deps.rpc, actor.userId, projectId);
  const content = await storedContent(deps.db, projectId);
  const organizationId = access.project.organizationId;

  const template = await deps.db.template.create({
    data: {
      organizationId,
      name: body.name,
      description: body.description || null,
      createdById: actor.userId,
      state: new Uint8Array(0),
      schemaVersion: PUBLISHING_SCHEMA_VERSION,
      assetRefs: [],
    },
    select: { id: true },
  });

  const written: string[] = [];
  try {
    const previewId = access.project.previewAssetId;
    const ids = new Set(documentRefs(content.state));
    if (previewId) ids.add(previewId);
    const sources = await loadVisibleAssets(deps.db, actor.userId, [...ids]);
    const remap = await copyAll(
      deps,
      sources,
      () => ({ organizationId, ownerId: actor.userId, projectId: null, templateId: template.id, source: 'template' }),
      written,
    );
    const remapped = remapDocumentAssets(content.state, remap);
    const own = new Set(remap.values());
    const saved = await deps.db.template.update({
      where: { id: template.id },
      data: {
        state: new Uint8Array(remapped.state),
        schemaVersion: content.schemaVersion,
        assetRefs: remapped.assetRefs.filter((id) => own.has(id)),
        previewAssetId: previewId ? (remap.get(previewId) ?? null) : null,
      },
      select: templateSelect(actor.userId),
    });
    const [summary] = await present(deps.db, actor.userId, [saved]);
    return summary!;
  } catch (error) {
    await deleteKeys(deps, written, { templateId: template.id });
    // Los Asset de la plantilla caen en cascada.
    await deps.db.template.delete({ where: { id: template.id } }).catch((cause: unknown) =>
      deps.logger.error({ err: { message: (cause as Error).message }, templateId: template.id }, 'No se pudo deshacer la plantilla'),
    );
    throw error;
  }
}

export async function listTemplates(
  deps: Pick<TemplateDeps, 'db'>,
  actor: Actor,
  slug: string,
  query: TemplateListQuery,
): Promise<{ items: TemplateSummary[]; nextCursor: string | null }> {
  const access = await requireWorkspace(deps.db, actor.userId, slug);
  const and: Prisma.TemplateWhereInput[] = [
    published,
    { OR: [{ organizationId: access.workspace.id }, { organizationId: null }] },
  ];
  if (query.q) and.push({ name: { contains: query.q, mode: 'insensitive' } });
  if (query.filter === 'favorites') {
    const favorites = await deps.db.favorite.findMany({
      where: { userId: actor.userId, targetType: 'template' },
      select: { targetId: true },
    });
    and.push({ id: { in: favorites.map((favorite) => favorite.targetId) } });
  }
  const rows = await deps.db.template.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: templateSelect(actor.userId),
  });
  const page = rows.slice(0, query.limit);
  return {
    items: await present(deps.db, actor.userId, page),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

// Primero los objetos: si el storage falla, la plantilla se queda y se puede reintentar.
export async function deleteTemplate(deps: StorageDeps, actor: Actor, templateId: string): Promise<void> {
  await requireTemplate(deps.db, actor.userId, templateId, 'admin');
  const assets = await deps.db.asset.findMany({ where: { templateId }, select: { storageKey: true, variants: true } });
  const keys = assets.flatMap(objectKeysOf);
  if (keys.length > 0) {
    try {
      await deps.storage.delete(keys);
    } catch (error) {
      throw new AppError('STORAGE_ERROR', { cause: error });
    }
  }
  await deps.db.$transaction(async (tx) => {
    await tx.favorite.deleteMany({ where: { targetType: 'template', targetId: templateId } });
    await tx.template.delete({ where: { id: templateId } });
  });
}

// La clave primaria (templateId, userId) hace el like único; el contador cambia solo si cambió la fila.
export async function setTemplateLike(
  deps: Pick<TemplateDeps, 'db'>,
  actor: Actor,
  templateId: string,
  liked: boolean,
): Promise<TemplateLikeResponse> {
  await requireTemplate(deps.db, actor.userId, templateId);
  return deps.db.$transaction(async (tx) => {
    const changed = liked
      ? (await tx.templateLike.createMany({ data: [{ templateId, userId: actor.userId }], skipDuplicates: true })).count
      : -(await tx.templateLike.deleteMany({ where: { templateId, userId: actor.userId } })).count;
    const row =
      changed === 0
        ? await tx.template.findUniqueOrThrow({ where: { id: templateId }, select: { likesCount: true } })
        : await tx.template.update({
            where: { id: templateId },
            data: { likesCount: { increment: changed } },
            select: { likesCount: true },
          });
    return { liked, likesCount: row.likesCount };
  });
}

function nodeStats(doc: Y.Doc): { nodeCount: number; nodeCountByType: Record<string, number> } {
  const nodeCountByType: Record<string, number> = {};
  let nodeCount = 0;
  doc.getMap(ROOT_KEYS.nodes).forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const type = String(value.get('type'));
    nodeCount++;
    nodeCountByType[type] = (nodeCountByType[type] ?? 0) + 1;
  });
  return { nodeCount, nodeCountByType };
}

// Estado de la plantilla migrado a la versión actual y con los assetId de las copias del proyecto.
function projectState(state: Uint8Array, remap: ReadonlyMap<string, string>) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    migrate(doc);
    remapAssetIds(doc, remap);
    const encoded = Y.encodeStateAsUpdate(doc);
    return {
      state: encoded,
      schemaVersion: documentSchemaVersion(doc) ?? DOCUMENT_SCHEMA_VERSION,
      assetRefs: collectAssetRefs(doc).filter(isUuid),
      ...nodeStats(doc),
    };
  } finally {
    doc.destroy();
  }
}

async function discardProject(deps: StorageDeps, projectId: string, written: string[]): Promise<void> {
  await deleteKeys(deps, written, { projectId });
  await deps.db.project.delete({ where: { id: projectId } }).catch((error: unknown) =>
    deps.logger.error({ err: { message: (error as Error).message }, projectId }, 'No se pudo deshacer el proyecto'),
  );
}

// Proyecto nuevo con el estado de la plantilla y copias propias de sus assets (source = upload; la vista previa
// sigue siendo preview). Si una copia falla, no queda ni el proyecto ni objetos sueltos.
export async function createProjectFromTemplate(
  deps: StorageDeps,
  actor: Actor,
  access: WorkspaceAccess,
  body: { name: string; templateId: string },
): Promise<ProjectSummary> {
  const template = await deps.db.template.findFirst({
    where: {
      id: body.templateId,
      ...published,
      OR: [{ organizationId: access.workspace.id }, { organizationId: null }],
    },
    select: { id: true, state: true, assetRefs: true, previewAssetId: true },
  });
  if (!template) throw new AppError('NOT_FOUND');

  const projectId = uuidv7();
  const created = await deps.db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        id: projectId,
        organizationId: access.workspace.id,
        name: body.name,
        createdById: actor.userId,
        templateId: template.id,
      },
      select: summarySelect(actor.userId),
    });
    if (access.role === 'member') {
      await tx.projectMember.create({ data: { projectId, userId: actor.userId, role: 'admin', addedById: actor.userId } });
    }
    await recordActivity(tx, {
      type: 'project.created',
      actorId: actor.userId,
      projectId,
      data: { templateId: template.id },
    });
    return project;
  });

  const written: string[] = [];
  try {
    const ids = new Set(template.assetRefs);
    if (template.previewAssetId) ids.add(template.previewAssetId);
    const sources = await deps.db.asset.findMany({
      where: { id: { in: [...ids] }, templateId: template.id, status: 'ready', deletedAt: null },
      select: copySourceSelect,
    });
    const remap = await copyAll(
      deps,
      sources,
      (source) => ({
        organizationId: access.workspace.id,
        ownerId: actor.userId,
        projectId,
        source: source.id === template.previewAssetId ? 'preview' : 'upload',
      }),
      written,
    );
    const content = projectState(new Uint8Array(template.state), remap);
    const previewAssetId = template.previewAssetId ? (remap.get(template.previewAssetId) ?? null) : null;
    await deps.db.$transaction(async (tx) => {
      await tx.projectDocument.create({
        data: {
          projectId,
          state: new Uint8Array(content.state),
          schemaVersion: content.schemaVersion,
          epoch: 1,
          sizeBytes: content.state.byteLength,
          nodeCount: content.nodeCount,
          nodeCountByType: content.nodeCountByType,
          assetRefs: content.assetRefs,
        },
      });
      if (previewAssetId) await tx.project.update({ where: { id: projectId }, data: { previewAssetId } });
    });
    return toProjectSummary({ ...created, previewAssetId }, access.workspace.slug, 'admin', false);
  } catch (error) {
    await discardProject(deps, projectId, written);
    throw error;
  }
}
