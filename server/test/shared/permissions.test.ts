import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_MATRIX,
  ORG_ACCESS_LEVELS,
  PROJECT_CAPABILITIES,
  PROJECT_ROLES,
  can,
  effectiveProjectRole,
  maxRole,
  type EffectiveRole,
  type OrgAccess,
  type OrgRole,
  type ProjectRole,
} from '../../src/shared/permissions.js';

const ORG_ROLES_OR_GUEST: Array<OrgRole | null> = ['owner', 'admin', 'member', null];
const DIRECT_ROLES: Array<ProjectRole | null> = [null, ...PROJECT_ROLES];

// Modelo de referencia escrito a partir de las reglas, independiente de la implementación.
function expected(
  orgRole: OrgRole | null,
  orgAccess: OrgAccess,
  directRole: ProjectRole | null,
  projectDeleted: boolean,
  workspaceDeleted: boolean,
): EffectiveRole {
  if (workspaceDeleted) return orgRole === 'owner' ? 'admin' : null;
  let base: EffectiveRole;
  if (orgRole === 'owner' || orgRole === 'admin') base = 'admin';
  else if (orgRole === 'member') {
    const fromOrg: EffectiveRole = orgAccess === 'none' ? null : orgAccess;
    const rank = { viewer: 1, editor: 2, admin: 3 } as const;
    if (fromOrg === null) base = directRole;
    else if (directRole === null) base = fromOrg;
    else base = rank[fromOrg] >= rank[directRole] ? fromOrg : directRole;
  } else base = directRole;
  if (projectDeleted) return base === 'admin' ? 'admin' : null;
  return base;
}

const cases: Array<[OrgRole | null, OrgAccess, ProjectRole | null, boolean, boolean]> = [];
for (const orgRole of ORG_ROLES_OR_GUEST)
  for (const orgAccess of ORG_ACCESS_LEVELS)
    for (const directRole of DIRECT_ROLES)
      for (const projectDeleted of [false, true])
        for (const workspaceDeleted of [false, true]) cases.push([orgRole, orgAccess, directRole, projectDeleted, workspaceDeleted]);

describe('effectiveProjectRole', () => {
  it('cubre la matriz completa (4 × 3 × 4 × 2 × 2)', () => {
    expect(cases).toHaveLength(192);
  });

  it.each(cases)(
    'orgRole=%s orgAccess=%s directRole=%s projectDeleted=%s workspaceDeleted=%s',
    (orgRole, orgAccess, directRole, projectDeleted, workspaceDeleted) => {
      expect(effectiveProjectRole({ orgRole, orgAccess, directRole, projectDeleted, workspaceDeleted })).toBe(
        expected(orgRole, orgAccess, directRole, projectDeleted, workspaceDeleted),
      );
    },
  );

  it('con el espacio en papelera solo el owner conserva acceso, como admin', () => {
    const common = { orgAccess: 'editor' as const, directRole: 'admin' as const, projectDeleted: false, workspaceDeleted: true };
    expect(effectiveProjectRole({ ...common, orgRole: 'owner' })).toBe('admin');
    expect(effectiveProjectRole({ ...common, orgRole: 'admin' })).toBeNull();
    expect(effectiveProjectRole({ ...common, orgRole: 'member' })).toBeNull();
    expect(effectiveProjectRole({ ...common, orgRole: null })).toBeNull();
  });

  it('con el proyecto en papelera solo el admin efectivo conserva acceso', () => {
    const common = { orgAccess: 'editor' as const, projectDeleted: true, workspaceDeleted: false };
    expect(effectiveProjectRole({ ...common, orgRole: 'admin', directRole: null })).toBe('admin');
    expect(effectiveProjectRole({ ...common, orgRole: 'member', directRole: 'admin' })).toBe('admin');
    expect(effectiveProjectRole({ ...common, orgRole: 'member', directRole: null })).toBeNull();
    expect(effectiveProjectRole({ ...common, orgRole: null, directRole: 'editor' })).toBeNull();
  });

  it('un member con orgAccess none depende de su rol directo', () => {
    const common = { orgRole: 'member' as const, orgAccess: 'none' as const, projectDeleted: false, workspaceDeleted: false };
    expect(effectiveProjectRole({ ...common, directRole: null })).toBeNull();
    expect(effectiveProjectRole({ ...common, directRole: 'viewer' })).toBe('viewer');
  });
});

describe('matriz de capacidades', () => {
  it('cada rol incluye las capacidades del inferior', () => {
    for (const capability of CAPABILITY_MATRIX.viewer) expect(CAPABILITY_MATRIX.editor.has(capability)).toBe(true);
    for (const capability of CAPABILITY_MATRIX.editor) expect(CAPABILITY_MATRIX.admin.has(capability)).toBe(true);
    expect(CAPABILITY_MATRIX.admin.size).toBe(PROJECT_CAPABILITIES.length);
  });

  it('separa ver, editar y administrar', () => {
    expect(can('viewer', 'project:view')).toBe(true);
    expect(can('viewer', 'chat:write')).toBe(true);
    expect(can('viewer', 'project:edit')).toBe(false);
    expect(can('editor', 'project:edit')).toBe(true);
    expect(can('editor', 'project:manage')).toBe(false);
    expect(can('admin', 'project:members')).toBe(true);
    expect(can(null, 'project:view')).toBe(false);
  });

  it('maxRole devuelve el rol más alto', () => {
    expect(maxRole('viewer', 'editor')).toBe('editor');
    expect(maxRole(null, 'viewer')).toBe('viewer');
    expect(maxRole(null, null)).toBeNull();
  });
});
