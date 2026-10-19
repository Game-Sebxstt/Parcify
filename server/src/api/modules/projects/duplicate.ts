import type { z } from 'zod';
import { recordActivity } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { remapDocumentAssets } from '../../../core/document/remap-assets.js';
import { AppError } from '../../../core/errors.js';
import { uuidv7 } from '../../../core/ids.js';
import type { LogSink } from '../../../core/logger.js';
import { requireProject, requireWorkspace } from '../../../core/permissions.js';
import type { StorageDriver } from '../../../core/storage/index.js';
import type { ProjectSummary } from '../../../shared/api/projects.js';
import type { Actor } from '../../types.js';
import { loadVisibleAssets } from '../assets/access.js';
import { cloneAssets } from '../assets/service.js';
import type { DuplicateProjectBodySchema } from './schemas.js';
import { summarySelect, toSummary } from './summary.js';

const COPY_SUFFIX = ' (copia)';
const MAX_NAME = 80;

export function copyName(name: string): string {
  return `${name.slice(0, MAX_NAME - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

async function personalSlug(db: Db, userId: string): Promise<string> {
  const personal = await db.organization.findFirst({
    where: { personal: true, deletedAt: null, members: { some: { userId, role: 'owner' } } },
    select: { slug: true },
  });
  if (!personal) throw new AppError('WORKSPACE_NOT_FOUND');
  return personal.slug;
}

// Copia el estado del documento y sus assets con ids nuevos; el duplicado pertenece a quien duplica.
export async function duplicateProject(
  deps: { db: Db; storage: StorageDriver; logger: LogSink },
  actor: Actor,
  projectId: string,
  body: z.infer<typeof DuplicateProjectBodySchema>,
): Promise<ProjectSummary> {
  const source = await requireProject(deps.db, actor.userId, projectId);
  // Sin destino: el mismo espacio si se es miembro; si no (invitado externo), el personal.
  const targetSlug =
    body.targetWorkspaceSlug ?? (source.orgRole ? source.project.workspaceSlug : await personalSlug(deps.db, actor.userId));
  const target = await requireWorkspace(deps.db, actor.userId, targetSlug);

  const document = await deps.db.projectDocument.findUnique({ where: { projectId } });
  const assetIds = new Set(document?.assetRefs ?? []);
  if (source.project.previewAssetId) assetIds.add(source.project.previewAssetId);

  const newId = uuidv7();
  const created = await deps.db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        id: newId,
        organizationId: target.workspace.id,
        name: copyName(source.project.name),
        createdById: actor.userId,
      },
      select: summarySelect(actor.userId),
    });
    if (target.role === 'member') {
      await tx.projectMember.create({
        data: { projectId: newId, userId: actor.userId, role: 'admin', addedById: actor.userId },
      });
    }
    await recordActivity(tx, {
      type: 'project.duplicated',
      actorId: actor.userId,
      projectId: newId,
      data: { sourceProjectId: projectId },
    });
    return project;
  });

  const visible = await loadVisibleAssets(deps.db, actor.userId, [...assetIds]);
  const remap = await cloneAssets(deps, visible, {
    projectId: newId,
    organizationId: target.workspace.id,
    ownerId: actor.userId,
  });

  if (document) {
    const remapped = remapDocumentAssets(document.state, remap);
    await deps.db.projectDocument.create({
      data: {
        projectId: newId,
        state: new Uint8Array(remapped.state),
        schemaVersion: document.schemaVersion,
        epoch: 1,
        sizeBytes: remapped.state.byteLength,
        nodeCount: document.nodeCount,
        nodeCountByType: document.nodeCountByType ?? {},
        assetRefs: remapped.assetRefs,
      },
    });
  }
  const previewAssetId = source.project.previewAssetId ? (remap.get(source.project.previewAssetId) ?? null) : null;
  if (previewAssetId) await deps.db.project.update({ where: { id: newId }, data: { previewAssetId } });

  return toSummary({ ...created, previewAssetId }, target.workspace.slug, 'admin', false);
}
