import * as Y from 'yjs';
import type { Prisma } from '../generated/prisma/client.js';
import { initDocument } from '../shared/document/init.js';
import { ROOT_KEYS } from '../shared/document/keys.js';
import { documentSchemaVersion } from '../shared/document/migrations.js';
import { DOCUMENT_SCHEMA_VERSION } from '../shared/document/schema.js';
import { VERSION_LIMITS } from '../shared/api/versions.js';
import { incrementDaily, recordActivity } from './activity.js';
import type { Db } from './db.js';
import { initialPageId } from './document/initial-page.js';

export interface VersionContent {
  state: Uint8Array;
  schemaVersion: number;
  nodeCount: number;
}

export function contentOf(document: Y.Doc, state = Y.encodeStateAsUpdate(document)): VersionContent {
  let nodeCount = 0;
  document.getMap(ROOT_KEYS.nodes).forEach((value) => {
    if (value instanceof Y.Map) nodeCount++;
  });
  return { state, schemaVersion: documentSchemaVersion(document) ?? DOCUMENT_SCHEMA_VERSION, nodeCount };
}

function bytesOf(state: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(state);
}

// Conserva las `keep` más recientes de ese tipo.
async function prune(tx: Prisma.TransactionClient, projectId: string, kind: 'auto' | 'manual', keep: number): Promise<void> {
  const stale = await tx.projectVersion.findMany({
    where: { projectId, kind },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: keep,
    select: { id: true },
  });
  if (stale.length) await tx.projectVersion.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
}

export async function createManualVersion(
  db: Db,
  input: { projectId: string; userId: string; name: string | null; content: VersionContent },
): Promise<string> {
  const { projectId, userId, content } = input;
  return db.$transaction(async (tx) => {
    const version = await tx.projectVersion.create({
      data: {
        projectId,
        kind: 'manual',
        name: input.name,
        state: bytesOf(content.state),
        schemaVersion: content.schemaVersion,
        sizeBytes: content.state.byteLength,
        nodeCount: content.nodeCount,
        createdById: userId,
      },
      select: { id: true, createdAt: true },
    });
    await prune(tx, projectId, 'manual', VERSION_LIMITS.keepManual);
    await incrementDaily(tx, { projectId, userId, counter: 'versionsCreated', at: version.createdAt });
    await recordActivity(tx, { type: 'version.created', actorId: userId, projectId, data: { versionId: version.id } });
    return version.id;
  });
}

export async function createAutoVersion(db: Db, projectId: string, content: VersionContent): Promise<string> {
  return db.$transaction(async (tx) => {
    const version = await tx.projectVersion.create({
      data: {
        projectId,
        kind: 'auto',
        state: bytesOf(content.state),
        schemaVersion: content.schemaVersion,
        sizeBytes: content.state.byteLength,
        nodeCount: content.nodeCount,
      },
      select: { id: true },
    });
    await prune(tx, projectId, 'auto', VERSION_LIMITS.keepAuto);
    return version.id;
  });
}

export async function createRestorePoint(
  db: Pick<Db, 'projectVersion'> | Prisma.TransactionClient,
  input: { projectId: string; userId: string | null; content: VersionContent },
): Promise<string> {
  const { content } = input;
  const version = await db.projectVersion.create({
    data: {
      projectId: input.projectId,
      kind: 'restore_point',
      state: bytesOf(content.state),
      schemaVersion: content.schemaVersion,
      sizeBytes: content.state.byteLength,
      nodeCount: content.nodeCount,
      createdById: input.userId,
    },
    select: { id: true },
  });
  return version.id;
}

// Sin ninguna instancia con el documento: se copia lo guardado (o el contenido inicial si nunca se abrió).
export async function storedContent(db: Db, projectId: string): Promise<VersionContent> {
  const row = await db.projectDocument.findUnique({
    where: { projectId },
    select: { state: true, schemaVersion: true, nodeCount: true },
  });
  if (row) return { state: new Uint8Array(row.state), schemaVersion: row.schemaVersion, nodeCount: row.nodeCount };
  const document = new Y.Doc();
  try {
    initDocument(document, { pageId: initialPageId(projectId) });
    return contentOf(document);
  } finally {
    document.destroy();
  }
}
