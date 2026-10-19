import { randomUUID } from 'node:crypto';
import { createRedis } from '../../src/core/redis.js';
import type { buildTestApp } from './app.js';
import { CLIENT_ORIGIN, type TestUser } from './auth.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function api(app: App, user: TestUser | null, method: Method, url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      ...(user ? { cookie: user.jar.header(), origin: CLIENT_ORIGIN } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

export async function createWorkspaceFor(app: App, owner: TestUser, name = 'Estudio de pruebas') {
  return app.auth.api.createOrganization({
    body: { name, slug: `ws-${randomUUID().slice(0, 12)}`, userId: owner.id },
  });
}

export async function addOrgMember(app: App, organizationId: string, user: TestUser, role: 'owner' | 'admin' | 'member') {
  return app.auth.api.addMember({ body: { userId: user.id, role, organizationId } });
}

export async function createProjectRow(
  app: App,
  organizationId: string,
  createdById: string,
  overrides: { name?: string; orgAccess?: 'none' | 'viewer' | 'editor'; deletedAt?: Date | null } = {},
) {
  return app.db.project.create({
    data: {
      organizationId,
      createdById,
      name: overrides.name ?? `Proyecto ${randomUUID().slice(0, 6)}`,
      orgAccess: overrides.orgAccess ?? 'editor',
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

export async function addProjectMember(app: App, projectId: string, userId: string, role: 'admin' | 'editor' | 'viewer') {
  return app.db.projectMember.create({ data: { projectId, userId, role } });
}

// Suscriptor de Redis para comprobar eventos publicados.
export async function subscribe(channels: string[]) {
  const subscriber = createRedis(process.env.TEST_REDIS_URL!, { name: 'test-sub' });
  const messages: Array<{ channel: string; event: Record<string, unknown> }> = [];
  subscriber.on('message', (channel: string, message: string) => messages.push({ channel, event: JSON.parse(message) }));
  await subscriber.subscribe(...channels);
  return {
    messages,
    async waitFor(predicate: (message: { channel: string; event: Record<string, unknown> }) => boolean, timeoutMs = 1_500) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return undefined;
    },
    close: () => subscriber.disconnect(),
  };
}
