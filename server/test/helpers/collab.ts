import { randomBytes, randomUUID } from 'node:crypto';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { createCollabServer, type CollabServerOptions } from '../../src/collab/server.js';
import { signCollabToken } from '../../src/core/collab-token.js';
import { createDb, type Db } from '../../src/core/db.js';
import { createLogger } from '../../src/core/logger.js';
import { createRedis } from '../../src/core/redis.js';
import { newNodeId } from '../../src/shared/document/ids.js';
import { documentNameFor, ROOT_KEYS } from '../../src/shared/document/keys.js';
import { DOCUMENT_SCHEMA_VERSION } from '../../src/shared/document/schema.js';
import type { ProjectRole } from '../../src/shared/permissions.js';
import { TEST_SECRET_B, testConfig } from './env.js';

export async function startCollab(
  options: { instanceId?: string; env?: Record<string, string>; server?: CollabServerOptions } = {},
) {
  const instanceId = options.instanceId ?? `collab-test-${randomUUID().slice(0, 8)}`;
  const config = testConfig({ INSTANCE_ID: instanceId, PORT: '3001', ...options.env }, 'collab');
  const db = createDb(config);
  const redis = createRedis(config.redisUrl, { name: `test-${instanceId}` });
  const logger = createLogger(config);
  const collab = createCollabServer(
    { config, db, redis, logger },
    { port: 0, address: '127.0.0.1', stopOnSignals: false, debounce: 150, maxDebounce: 1_000, ...options.server },
  );
  const port = await collab.listen();
  return {
    ...collab,
    instanceId,
    db,
    redis,
    url: `ws://127.0.0.1:${port}`,
    httpUrl: `http://127.0.0.1:${port}`,
    document(projectId: string) {
      return collab.server.hocuspocus.documents.get(documentNameFor(projectId));
    },
    async stop() {
      await collab.server.destroy();
      await db.$disconnect();
      redis.disconnect();
    },
  };
}

export type TestCollab = Awaited<ReturnType<typeof startCollab>>;

export interface SeedUser {
  id: string;
  name: string;
  sessionId: string;
}

export async function seedUser(db: Db, name = 'Ana Pruebas'): Promise<SeedUser> {
  const id = randomBytes(12).toString('base64url');
  await db.user.create({ data: { id, name, email: `${id.toLowerCase()}@example.com`, emailVerified: true } });
  const sessionId = randomBytes(16).toString('base64url');
  await db.session.create({
    data: { id: sessionId, userId: id, token: randomBytes(24).toString('base64url'), expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return { id, name, sessionId };
}

export async function seedWorkspace(db: Db, owner: SeedUser) {
  const organization = await db.organization.create({
    data: { id: randomBytes(12).toString('base64url'), name: 'Estudio', slug: `ws-${randomUUID().slice(0, 12)}` },
  });
  await addOrgMember(db, organization.id, owner, 'owner');
  return organization;
}

export function addOrgMember(db: Db, organizationId: string, user: SeedUser, role: 'owner' | 'admin' | 'member') {
  return db.member.create({ data: { id: randomBytes(12).toString('base64url'), organizationId, userId: user.id, role } });
}

export function seedProject(db: Db, organizationId: string, owner: SeedUser, orgAccess: 'none' | 'viewer' | 'editor' = 'editor') {
  return db.project.create({ data: { organizationId, createdById: owner.id, name: 'Lienzo', orgAccess } });
}

export function addProjectMember(db: Db, projectId: string, user: SeedUser, role: ProjectRole) {
  return db.projectMember.create({ data: { projectId, userId: user.id, role } });
}

export function tokenFor(
  user: SeedUser,
  projectId: string,
  options: { ep?: number; role?: ProjectRole; nowSeconds?: number; secret?: string } = {},
): Promise<string> {
  return signCollabToken(
    options.secret ?? TEST_SECRET_B,
    { sub: user.id, pid: projectId, role: options.role ?? 'editor', sid: user.sessionId, ep: options.ep ?? 1 },
    options.nowSeconds,
  );
}

export async function waitFor<T>(check: () => T | undefined | null | false | Promise<T | undefined | null | false>, label: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado esperando: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export interface TestClient {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  scopes: string[];
  failures: string[];
  closes: number[];
  stateless: Array<Record<string, unknown>>;
  authenticated(timeoutMs?: number): Promise<string>;
  failed(timeoutMs?: number): Promise<string>;
  closed(code: number, timeoutMs?: number): Promise<number>;
  synced(): Promise<void>;
  destroy(): void;
}

export function connect(
  url: string,
  projectId: string,
  token: () => Promise<string>,
  options: { schemaVersion?: string | null } = {},
): TestClient {
  const doc = new Y.Doc();
  const query = options.schemaVersion === null ? '' : `?schemaVersion=${options.schemaVersion ?? DOCUMENT_SCHEMA_VERSION}`;
  const scopes: string[] = [];
  const failures: string[] = [];
  const closes: number[] = [];
  const stateless: Array<Record<string, unknown>> = [];
  let destroyed = false;
  const socket = new HocuspocusProviderWebsocket({
    url: `${url}/${query}`,
    delay: 100,
    minDelay: 100,
    maxDelay: 400,
    factor: 1.5,
    jitter: false,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: documentNameFor(projectId),
    document: doc,
    token,
    onAuthenticated: ({ scope }) => void scopes.push(scope),
    onAuthenticationFailed: ({ reason }) => void failures.push(reason),
    onClose: ({ event }) => void closes.push(event.code),
    onStateless: ({ payload }) => void stateless.push(JSON.parse(payload) as Record<string, unknown>),
  });
  provider.attach();
  return {
    provider,
    doc,
    scopes,
    failures,
    closes,
    stateless,
    authenticated: (timeoutMs) => waitFor(() => scopes.at(-1), 'autenticación', timeoutMs),
    failed: (timeoutMs) => waitFor(() => failures.at(-1), 'rechazo', timeoutMs),
    closed: (code, timeoutMs) => waitFor(() => (closes.includes(code) ? code : null), `cierre ${code}`, timeoutMs),
    synced: async () => {
      await waitFor(() => provider.isSynced, 'sincronización');
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      provider.destroy();
      socket.destroy();
    },
  };
}

export function firstPageId(doc: Y.Doc): string {
  const id = [...doc.getMap(ROOT_KEYS.pages).keys()][0];
  if (!id) throw new Error('El documento no tiene páginas');
  return id;
}

export function rectProps(pageId: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'rect',
    pageId,
    parentId: null,
    index: 'a0',
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy,
    fill: '#FF6B4AFF',
    stroke: null,
    strokeWidth: 1,
    strokeDash: 'solid',
    shadow: null,
    cornerRadius: 4,
    ...overrides,
  };
}

export function addNode(doc: Y.Doc, props: Record<string, unknown>, id = newNodeId()): string {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({ id, ...props })) map.set(key, value);
    doc.getMap(ROOT_KEYS.nodes).set(id, map);
  });
  return id;
}

export function nodesOf(doc: Y.Doc | undefined): Record<string, Record<string, unknown>> {
  return (doc?.getMap(ROOT_KEYS.nodes).toJSON() ?? {}) as Record<string, Record<string, unknown>>;
}
