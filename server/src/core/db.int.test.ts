import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../test/helpers/env.js';
import { createDb, pingDb } from './db.js';
import { isUuidV7 } from './ids.js';

const db = createDb(testConfig());
const orgId = `org_${randomUUID()}`;

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.$disconnect();
});

describe('db', () => {
  it('responde a SELECT 1', async () => {
    await expect(pingDb(db)).resolves.toBeUndefined();
  });

  it('genera ids uuid v7 en Postgres para las tablas propias', async () => {
    await db.organization.create({ data: { id: orgId, name: 'Pruebas', slug: `pruebas-${orgId.slice(-8)}` } });
    const first = await db.project.create({ data: { organizationId: orgId, name: 'Uno', createdById: 'u1' } });
    const second = await db.project.create({ data: { organizationId: orgId, name: 'Dos', createdById: 'u1' } });

    expect(isUuidV7(first.id)).toBe(true);
    expect(first.id[14]).toBe('7');
    expect(first.orgAccess).toBe('editor');
    expect(second.id > first.id).toBe(true);
  });

  it('borra en cascada los proyectos al borrar el espacio', async () => {
    const otherOrg = `org_${randomUUID()}`;
    await db.organization.create({ data: { id: otherOrg, name: 'Temporal', slug: `tmp-${otherOrg.slice(-8)}` } });
    const project = await db.project.create({ data: { organizationId: otherOrg, name: 'X', createdById: 'u1' } });
    await db.organization.delete({ where: { id: otherOrg } });
    expect(await db.project.findUnique({ where: { id: project.id } })).toBeNull();
  });
});
