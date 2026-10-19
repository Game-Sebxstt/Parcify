import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../../test/helpers/app.js';
import { registerVerified, type TestUser } from '../../../../test/helpers/auth.js';
import { addOrgMember, addProjectMember, api, createProjectRow, createWorkspaceFor } from '../../../../test/helpers/seed.js';
import { createTestStorage, type TestStorage } from '../../../../test/helpers/storage.js';
import {
  can,
  effectiveProjectRole,
  type OrgRole,
  type ProjectCapability,
  type ProjectRole,
} from '../../../shared/permissions.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Persona {
  name: string;
  orgRole: OrgRole | null;
  directRole: ProjectRole | null;
  user?: TestUser;
}

// El proyecto da 'viewer' a los member del espacio: así cada persona cae en un rol distinto.
const ORG_ACCESS = 'viewer' as const;

const personas: Persona[] = [
  { name: 'owner del espacio', orgRole: 'owner', directRole: null },
  { name: 'admin del espacio', orgRole: 'admin', directRole: null },
  { name: 'member del espacio', orgRole: 'member', directRole: null },
  { name: 'member con editor directo', orgRole: 'member', directRole: 'editor' },
  { name: 'invitado externo editor', orgRole: null, directRole: 'editor' },
  { name: 'invitado externo lector', orgRole: null, directRole: 'viewer' },
  { name: 'sin acceso', orgRole: null, directRole: null },
];

function roleOf(persona: Persona, flags: { projectDeleted?: boolean; workspaceDeleted?: boolean } = {}) {
  return effectiveProjectRole({
    orgRole: persona.orgRole,
    orgAccess: ORG_ACCESS,
    directRole: persona.directRole,
    projectDeleted: flags.projectDeleted ?? false,
    workspaceDeleted: flags.workspaceDeleted ?? false,
  });
}

function expected(role: ProjectRole | null, capability: ProjectCapability, success: number): number {
  if (role === null) return 404;
  return can(role, capability) ? success : 403;
}

let app: App;
let testStorage: TestStorage;
let owner: TestUser;
let workspace: { id: string; slug: string };

async function projectWithPersonas(options: { deletedAt?: Date } = {}) {
  const project = await createProjectRow(app, workspace.id, owner.id, { orgAccess: ORG_ACCESS, ...options });
  for (const persona of personas) {
    if (persona.directRole) await addProjectMember(app, project.id, persona.user!.id, persona.directRole);
  }
  return project;
}

beforeAll(async () => {
  testStorage = await createTestStorage('local');
  app = await buildTestApp({}, { storage: testStorage.storage });
  for (const persona of personas) persona.user = await registerVerified(app, { name: persona.name });
  owner = personas[0]!.user!;
  workspace = await createWorkspaceFor(app, owner, 'Permisos');
  for (const persona of personas.slice(1)) {
    if (persona.orgRole) await addOrgMember(app, workspace.id, persona.user!, persona.orgRole);
  }
});

afterAll(async () => {
  await app.close();
  await testStorage.cleanup();
});

interface EndpointCase {
  name: string;
  capability: ProjectCapability;
  success: number;
  request: (projectId: string, persona: Persona) => [Method, string, unknown?];
}

const endpoints: EndpointCase[] = [
  { name: 'GET /projects/:id', capability: 'project:view', success: 200, request: (id) => ['GET', `/v1/projects/${id}`] },
  {
    name: 'PATCH /projects/:id { name }',
    capability: 'project:edit',
    success: 200,
    request: (id) => ['PATCH', `/v1/projects/${id}`, { name: 'Renombrado' }],
  },
  {
    name: 'PATCH /projects/:id { orgAccess }',
    capability: 'project:manage',
    success: 200,
    request: (id) => ['PATCH', `/v1/projects/${id}`, { orgAccess: ORG_ACCESS }],
  },
  { name: 'GET /projects/:id/members', capability: 'project:view', success: 200, request: (id) => ['GET', `/v1/projects/${id}/members`] },
  {
    name: 'PUT /projects/:id/members/:userId',
    capability: 'project:members',
    success: 200,
    request: (id) => ['PUT', `/v1/projects/${id}/members/${personas[5]!.user!.id}`, { role: 'viewer' }],
  },
  { name: 'GET /projects/:id/assets', capability: 'project:view', success: 200, request: (id) => ['GET', `/v1/projects/${id}/assets`] },
  {
    name: 'POST /projects/:id/collab-token',
    capability: 'project:view',
    success: 200,
    request: (id) => ['POST', `/v1/projects/${id}/collab-token`],
  },
  { name: 'PUT /favorites/project/:id', capability: 'project:view', success: 204, request: (id) => ['PUT', `/v1/favorites/project/${id}`] },
  {
    name: 'POST /assets/uploads (canvas)',
    capability: 'asset:upload',
    success: 201,
    request: (id) => [
      'POST',
      '/v1/assets/uploads',
      { purpose: 'canvas', projectId: id, fileName: 'a.png', contentType: 'image/png', size: 100 },
    ],
  },
  {
    name: 'POST /projects/:id/compact',
    capability: 'project:manage',
    success: 202,
    request: (id) => ['POST', `/v1/projects/${id}/compact`],
  },
  {
    name: 'POST /projects/:id/duplicate',
    capability: 'project:view',
    success: 201,
    request: (id) => ['POST', `/v1/projects/${id}/duplicate`, {}],
  },
];

describe('tabla de permisos generada desde la matriz', () => {
  for (const persona of personas) {
    const role = roleOf(persona);
    describe(`${persona.name} (rol efectivo ${role ?? 'ninguno'})`, () => {
      let projectId: string;
      beforeAll(async () => {
        projectId = (await projectWithPersonas()).id;
      });

      for (const endpoint of endpoints) {
        const status = expected(role, endpoint.capability, endpoint.success);
        it(`${endpoint.name} → ${status}`, async () => {
          const [method, url, body] = endpoint.request(projectId, persona);
          const response = await api(app, persona.user!, method, url, body);
          expect(response.statusCode, response.body).toBe(status);
          if (status === 404) expect(response.json().error.code).toBe('PROJECT_NOT_FOUND');
          if (status === 403) expect(response.json().error.code).toBe('FORBIDDEN');
        });
      }

      const deleteStatus = expected(role, 'project:manage', 204);
      it(`DELETE /projects/:id → ${deleteStatus}`, async () => {
        const project = await projectWithPersonas();
        const response = await api(app, persona.user!, 'DELETE', `/v1/projects/${project.id}`);
        expect(response.statusCode, response.body).toBe(deleteStatus);
        const stored = await app.db.project.findUniqueOrThrow({ where: { id: project.id } });
        expect(stored.deletedAt !== null).toBe(deleteStatus === 204);
      });

      const trashedRole = roleOf(persona, { projectDeleted: true });
      const restoreStatus = expected(trashedRole, 'project:manage', 200);
      const viewTrashed = expected(trashedRole, 'project:view', 200);
      it(`proyecto en papelera: GET → ${viewTrashed}, restore → ${restoreStatus}`, async () => {
        const project = await projectWithPersonas({ deletedAt: new Date() });
        const read = await api(app, persona.user!, 'GET', `/v1/projects/${project.id}`);
        expect(read.statusCode).toBe(viewTrashed);
        const response = await api(app, persona.user!, 'POST', `/v1/projects/${project.id}/restore`);
        expect(response.statusCode, response.body).toBe(restoreStatus);
        const stored = await app.db.project.findUniqueOrThrow({ where: { id: project.id } });
        expect(stored.deletedAt === null).toBe(restoreStatus === 200);
      });
    });
  }
});

describe('espacio en papelera (filas de la tabla)', () => {
  it('solo el owner abre los proyectos como admin; el resto recibe 404', async () => {
    const project = await projectWithPersonas();
    const trashed = await createWorkspaceFor(app, owner, 'Espacio a la papelera');
    const local: Persona[] = personas.map((persona) => ({ ...persona }));
    for (const persona of local.slice(1)) {
      if (persona.orgRole) await addOrgMember(app, trashed.id, persona.user!, persona.orgRole);
    }
    await app.db.project.update({ where: { id: project.id }, data: { organizationId: trashed.id } });
    await app.db.organization.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });

    for (const persona of local) {
      const role = roleOf(persona, { workspaceDeleted: true });
      const read = await api(app, persona.user!, 'GET', `/v1/projects/${project.id}`);
      expect(read.statusCode, persona.name).toBe(role ? 200 : 404);
      if (role) expect(read.json().role).toBe('admin');
      const token = await api(app, persona.user!, 'POST', `/v1/projects/${project.id}/collab-token`);
      expect(token.statusCode, persona.name).toBe(role ? 200 : 404);
      const ws = await api(app, persona.user!, 'GET', `/v1/workspaces/${trashed.slug}`);
      expect(ws.statusCode, persona.name).toBe(persona.orgRole === 'owner' ? 200 : 404);
    }
  });
});
