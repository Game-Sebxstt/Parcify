export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export const PROJECT_ROLES = ['admin', 'editor', 'viewer'] as const;
export const ORG_ACCESS_LEVELS = ['none', 'viewer', 'editor'] as const;

export type OrgRole = (typeof ORG_ROLES)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export type OrgAccess = (typeof ORG_ACCESS_LEVELS)[number];
export type EffectiveRole = ProjectRole | null;

const RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function maxRole(a: EffectiveRole, b: EffectiveRole): EffectiveRole {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export function roleAtLeast(role: EffectiveRole, minimum: ProjectRole): boolean {
  return role !== null && RANK[role] >= RANK[minimum];
}

export interface ProjectAccessInput {
  orgRole: OrgRole | null;
  orgAccess: OrgAccess;
  directRole: ProjectRole | null;
  projectDeleted: boolean;
  workspaceDeleted: boolean;
}

export function effectiveProjectRole(input: ProjectAccessInput): EffectiveRole {
  const { orgRole, orgAccess, directRole, projectDeleted, workspaceDeleted } = input;

  if (workspaceDeleted) return orgRole === 'owner' ? 'admin' : null;

  let base: EffectiveRole;
  if (orgRole === 'owner' || orgRole === 'admin') base = 'admin';
  else if (orgRole === 'member') base = maxRole(orgAccess === 'none' ? null : orgAccess, directRole);
  else base = directRole;

  if (projectDeleted) return base === 'admin' ? 'admin' : null;
  return base;
}

export const PROJECT_CAPABILITIES = [
  'project:view',
  'project:export',
  'chat:write',
  'project:edit',
  'version:create',
  'version:restore',
  'asset:upload',
  'asset:edit',
  'ai:use',
  'project:manage',
  'project:members',
  'project:share',
  'chat:moderate',
  'template:publish',
] as const;

export type ProjectCapability = (typeof PROJECT_CAPABILITIES)[number];

const VIEWER: readonly ProjectCapability[] = ['project:view', 'project:export', 'chat:write'];
const EDITOR: readonly ProjectCapability[] = [
  ...VIEWER,
  'project:edit',
  'version:create',
  'version:restore',
  'asset:upload',
  'asset:edit',
  'ai:use',
];
const ADMIN: readonly ProjectCapability[] = [
  ...EDITOR,
  'project:manage',
  'project:members',
  'project:share',
  'chat:moderate',
  'template:publish',
];

export const CAPABILITY_MATRIX: Readonly<Record<ProjectRole, ReadonlySet<ProjectCapability>>> = {
  viewer: new Set(VIEWER),
  editor: new Set(EDITOR),
  admin: new Set(ADMIN),
};

export function can(role: EffectiveRole, capability: ProjectCapability): boolean {
  return role !== null && CAPABILITY_MATRIX[role].has(capability);
}
