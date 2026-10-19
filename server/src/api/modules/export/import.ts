import * as Y from 'yjs';
import { recordActivity } from '../../../core/activity.js';
import type { Db } from '../../../core/db.js';
import { collectAssetRefs } from '../../../core/document/remap-assets.js';
import { AppError } from '../../../core/errors.js';
import { isUuid, uuidv7 } from '../../../core/ids.js';
import type { Semaphore } from '../../../core/images/semaphore.js';
import type { LogSink } from '../../../core/logger.js';
import { requireWorkspace } from '../../../core/permissions.js';
import type { Redis } from '../../../core/redis.js';
import type { StorageDriver } from '../../../core/storage/index.js';
import { MAX_UPLOAD_BYTES } from '../../../shared/api/assets.js';
import type { ImportProjectResponse } from '../../../shared/api/projects.js';
import { documentFromJson, InvalidDocumentError, readDocumentJson, referencedAssets } from '../../../shared/document/from-json.js';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { DOCUMENT_SCHEMA_VERSION } from '../../../shared/document/schema.js';
import { ARCHIVE_PATHS, ManifestSchema, type DocumentJson, type Manifest } from '../../../shared/document/to-json.js';
import type { Actor } from '../../types.js';
import { loadVisibleAssets } from '../assets/access.js';
import { cloneAssets, storedVariants, storeImportedImage } from '../assets/service.js';
import type { ImportGate } from './gate.js';
import { ArchiveError, ZipArchive } from './zip.js';

const KiB = 1024;
const MiB = 1024 * KiB;

export const IMPORT_LIMITS = {
  maxManifestBytes: 64 * KiB,
  maxDocumentBytes: 64 * MiB,
  maxAssetBytes: MAX_UPLOAD_BYTES,
  maxAssets: 2_000,
} as const;

export interface ImportDeps {
  db: Db;
  redis: Redis;
  storage: StorageDriver;
  semaphore: Semaphore;
  gate: ImportGate;
  logger: LogSink;
}

const ASSET_ENTRY = /^assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]{1,5}$/i;

function invalid(reason: string): AppError {
  return new AppError('INVALID_ARCHIVE', { details: { reason } });
}

function asArchiveError(error: unknown): unknown {
  if (error instanceof ArchiveError || error instanceof InvalidDocumentError) return invalid(error.reason);
  return error;
}

function parseJson(bytes: Buffer, reason: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalid(reason);
  }
}

// Todo lo que se puede comprobar sin crear nada: directorio central, manifest y forma de document.json.
function readArchive(buffer: Buffer): { zip: ZipArchive; manifest: Manifest; data: DocumentJson } {
  const zip = ZipArchive.open(buffer);
  const manifestBytes = zip.read(ARCHIVE_PATHS.manifest, IMPORT_LIMITS.maxManifestBytes);
  if (!manifestBytes) throw invalid('missing_manifest');
  const manifest = ManifestSchema.safeParse(parseJson(manifestBytes, 'manifest'));
  if (!manifest.success) throw invalid('manifest');
  if (manifest.data.schemaVersion > DOCUMENT_SCHEMA_VERSION) throw invalid('schema_too_new');
  const documentBytes = zip.read(ARCHIVE_PATHS.document, IMPORT_LIMITS.maxDocumentBytes);
  if (!documentBytes) throw invalid('missing_document');
  return { zip, manifest: manifest.data, data: readDocumentJson(parseJson(documentBytes, 'document')) };
}

function embeddedAssets(zip: ZipArchive): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of zip.entries.keys()) {
    const match = ASSET_ENTRY.exec(name);
    const id = match?.[1]?.toLowerCase();
    if (id && !found.has(id)) found.set(id, name);
  }
  return found;
}

function documentStats(doc: Y.Doc) {
  const byType: Record<string, number> = {};
  let nodeCount = 0;
  doc.getMap(ROOT_KEYS.nodes).forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const type = String(value.get('type'));
    nodeCount++;
    byType[type] = (byType[type] ?? 0) + 1;
  });
  return { nodeCount, nodeCountByType: byType, assetRefs: collectAssetRefs(doc).filter(isUuid) };
}

// Si algo falla después de crear el proyecto, no queda ni el proyecto ni sus objetos en el storage.
async function discardProject(deps: ImportDeps, projectId: string): Promise<void> {
  try {
    const assets = await deps.db.asset.findMany({ where: { projectId }, select: { storageKey: true, variants: true } });
    const keys = assets.flatMap((asset) => [asset.storageKey, ...Object.values(storedVariants(asset.variants)).map((variant) => variant.key)]);
    if (keys.length) await deps.storage.delete(keys);
    await deps.db.project.delete({ where: { id: projectId } });
  } catch (error) {
    deps.logger.error({ err: { message: (error as Error).message }, projectId }, 'No se pudo deshacer la importación');
  }
}

// `readBody` se llama después de comprobar el acceso y de tener hueco: quien no es miembro, o llega con el
// cupo de importaciones simultáneas lleno, no llega a subir el archivo.
export async function importProject(
  deps: ImportDeps,
  actor: Actor,
  slug: string,
  readBody: () => Promise<Buffer>,
): Promise<ImportProjectResponse> {
  const access = await requireWorkspace(deps.db, actor.userId, slug);
  const release = deps.gate.admit(actor.userId);
  try {
    return await runImport(deps, actor, access, await readBody());
  } finally {
    release();
  }
}

async function runImport(
  deps: ImportDeps,
  actor: Actor,
  access: Awaited<ReturnType<typeof requireWorkspace>>,
  buffer: Buffer,
): Promise<ImportProjectResponse> {
  let archive: ReturnType<typeof readArchive>;
  try {
    archive = readArchive(buffer);
  } catch (error) {
    throw asArchiveError(error);
  }
  const { zip, manifest, data } = archive;

  const projectId = uuidv7();
  await deps.db.$transaction(async (tx) => {
    await tx.project.create({
      data: { id: projectId, organizationId: access.workspace.id, name: manifest.name, createdById: actor.userId },
    });
    // Como al crear: un member del espacio administra lo que importa.
    if (access.role === 'member') {
      await tx.projectMember.create({ data: { projectId, userId: actor.userId, role: 'admin', addedById: actor.userId } });
    }
    await recordActivity(tx, { type: 'project.created', actorId: actor.userId, projectId, data: { source: 'import' } });
  });

  try {
    const target = { projectId, organizationId: access.workspace.id, ownerId: actor.userId };
    const refs = referencedAssets(data);
    let droppedAssets = Math.max(0, refs.length - IMPORT_LIMITS.maxAssets);
    const embedded = embeddedAssets(zip);
    const remap = new Map<string, string>();
    const external: string[] = [];
    for (const assetId of refs.slice(0, IMPORT_LIMITS.maxAssets)) {
      const entry = embedded.get(assetId);
      if (!entry) {
        external.push(assetId);
        continue;
      }
      let bytes: Buffer | null;
      try {
        bytes = zip.read(entry, IMPORT_LIMITS.maxAssetBytes);
      } catch (error) {
        // Una imagen demasiado grande se descarta; una bomba o un ZIP corrupto invalidan el archivo entero.
        if (error instanceof ArchiveError && error.reason === 'entry_too_large') {
          droppedAssets++;
          continue;
        }
        throw asArchiveError(error);
      }
      try {
        const asset = await storeImportedImage(deps, { ...target, bytes: bytes! });
        remap.set(assetId, asset.id);
      } catch (error) {
        if (!(error instanceof AppError) || (error.code !== 'UNSUPPORTED_FILE' && error.code !== 'PROCESSING_TIMEOUT')) throw error;
        droppedAssets++;
      }
    }

    // Copia local sin assets incrustados: se copian los que quien importa puede ver.
    if (external.length) {
      const visible = await loadVisibleAssets(deps.db, actor.userId, external);
      const copied = await cloneAssets(deps, visible, target);
      for (const [from, to] of copied) remap.set(from, to);
      droppedAssets += external.length - copied.size;
    }

    let built: ReturnType<typeof documentFromJson>;
    try {
      built = documentFromJson(data, { assetIds: remap, userId: actor.userId });
    } catch (error) {
      throw asArchiveError(error);
    }
    const { doc, droppedNodes } = built;
    try {
      const state = Y.encodeStateAsUpdate(doc);
      const stats = documentStats(doc);
      await deps.db.projectDocument.create({
        data: {
          projectId,
          state: new Uint8Array(state),
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          epoch: 1,
          sizeBytes: state.byteLength,
          nodeCount: stats.nodeCount,
          nodeCountByType: stats.nodeCountByType,
          assetRefs: stats.assetRefs,
        },
      });
    } finally {
      doc.destroy();
    }
    return { projectId, droppedNodes, droppedAssets };
  } catch (error) {
    await discardProject(deps, projectId);
    throw error;
  }
}
