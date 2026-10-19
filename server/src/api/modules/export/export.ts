import { Readable } from 'node:stream';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import * as Y from 'yjs';
import type { Db } from '../../../core/db.js';
import { flushLiveDocument } from '../../../core/document/live-state.js';
import { collectAssetRefs } from '../../../core/document/remap-assets.js';
import { isUuid } from '../../../core/ids.js';
import type { LogSink } from '../../../core/logger.js';
import { requireProject } from '../../../core/permissions.js';
import type { RpcClient } from '../../../core/rpc.js';
import { parseKey, type StorageDriver } from '../../../core/storage/index.js';
import { storedContent } from '../../../core/versions.js';
import {
  ARCHIVE_PATHS,
  assetArchivePath,
  buildManifest,
  documentToJson,
  type DocumentJson,
} from '../../../shared/document/to-json.js';
import type { Actor } from '../../types.js';
import { loadVisibleAssets } from '../assets/access.js';
import { storedVariants } from '../assets/service.js';

export interface ExportDeps {
  db: Db;
  storage: StorageDriver;
  rpc: RpcClient;
  logger: LogSink;
}

type ArchiveFile = { kind: 'json'; path: string; value: unknown } | { kind: 'object'; path: string; key: string };

// Va sacando los trozos del ZIP a medida que se leen los objetos del storage, sin tenerlo entero en memoria.
async function* zipChunks(storage: StorageDriver, files: ArchiveFile[]): AsyncGenerator<Uint8Array> {
  const ready: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else ready.push(chunk);
  });
  const drain = function* () {
    if (failure) throw failure;
    while (ready.length) yield ready.shift()!;
  };
  for (const file of files) {
    if (file.kind === 'json') {
      const entry = new ZipDeflate(file.path, { level: 6 });
      zip.add(entry);
      entry.push(Buffer.from(JSON.stringify(file.value)), true);
    } else {
      // Las imágenes ya van comprimidas: se guardan tal cual.
      const entry = new ZipPassThrough(file.path);
      zip.add(entry);
      for await (const chunk of await storage.getStream(file.key)) {
        entry.push(chunk as Uint8Array);
        yield* drain();
      }
      entry.push(new Uint8Array(0), true);
    }
    yield* drain();
  }
  zip.end();
  yield* drain();
}

const UNSAFE_NAME = /["\\/:*?<>|]+/g;

export function archiveFileName(name: string): string {
  const base = [...name]
    .map((char) => (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? ' ' : char))
    .join('')
    .replace(UNSAFE_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${base || 'proyecto'}.parcify`;
}

export async function exportProject(
  deps: ExportDeps,
  actor: Actor,
  projectId: string,
): Promise<{ fileName: string; stream: Readable }> {
  const access = await requireProject(deps.db, actor.userId, projectId, 'project:export');
  await flushLiveDocument(deps.rpc, actor.userId, projectId);
  const content = await storedContent(deps.db, projectId);

  const doc = new Y.Doc();
  let data: DocumentJson;
  let refs: string[];
  try {
    Y.applyUpdate(doc, content.state);
    data = documentToJson(doc);
    refs = collectAssetRefs(doc).filter(isUuid);
  } finally {
    doc.destroy();
  }

  // Solo se incrustan las imágenes que quien exporta puede ver; las demás quedan como referencia.
  const assets = await loadVisibleAssets(deps.db, actor.userId, refs);
  const files: ArchiveFile[] = [
    { kind: 'json', path: ARCHIVE_PATHS.manifest, value: buildManifest({ name: access.project.name, schemaVersion: content.schemaVersion }) },
    { kind: 'json', path: ARCHIVE_PATHS.document, value: data },
  ];
  for (const asset of assets) {
    const variants = storedVariants(asset.variants);
    const variant = variants.full ?? variants.medium ?? variants.thumb;
    if (variant) files.push({ kind: 'object', path: assetArchivePath(asset.id, parseKey(variant.key).ext), key: variant.key });
  }
  const stream = Readable.from(zipChunks(deps.storage, files), { objectMode: false });
  stream.on('error', (error) => deps.logger.error({ err: { message: error.message }, projectId }, 'Falló la exportación .parcify'));
  return { fileName: archiveFileName(access.project.name), stream };
}
