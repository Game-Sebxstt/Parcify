import {
  can,
  effectiveProjectRole,
  ORG_ROLES,
  PROJECT_ROLES,
  type EffectiveRole,
  type OrgAccess,
  type OrgRole,
  type ProjectCapability,
  type ProjectRole,
} from '../shared/permissions.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';

export const TRASH_RETENTION_DAYS = 30;

const ORG_RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

export function isOrgRole(role: string): role is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(role);
}

export function isProjectRole(role: string): role is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role);
}

export function orgRoleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ORG_RANK[role] >= ORG_RANK[minimum];
}

export function purgeAtOf(deletedAt: Date | null): Date | null {
  return deletedAt ? new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 86_400_000) : null;
}

export interface WorkspaceAccess {
  workspace: {
    id: string;
    slug: string;
    name: string;
    personal: boolean;
    logoAssetId: string | null;
    deletedAt: Date | null;
  };
  role: OrgRole;
  memberId: string;
}

// Un espacio en papelera solo existe para su owner.
export async function loadWorkspaceAccess(db: Db, userId: string, slug: string): Promise<WorkspaceAccess | null> {
  const member = await db.member.findFirst({
    where: { userId, organization: { slug } },
    select: {
      id: true,
      role: true,
      organization: {
        select: { id: true, slug: true, name: true, personal: true, logoAssetId: true, deletedAt: true },
      },
    },
  });
  if (!member || !isOrgRole(member.role)) return null;
  if (member.organization.deletedAt && member.role !== 'owner') return null;
  return { workspace: member.organization, role: member.role, memberId: member.id };
}

export interface RequireWorkspaceOptions {
  minRole?: OrgRole;
  // Solo GET del espacio y restore se admiten con el espacio en papelera.
  allowTrash?: boolean;
}

export async function requireWorkspace(
  db: Db,
  userId: string,
  slug: string,
  options: RequireWorkspaceOptions = {},
): Promise<WorkspaceAccess> {
  const access = await loadWorkspaceAccess(db, userId, slug);
  if (!access) throw new AppError('WORKSPACE_NOT_FOUND');
  if (access.workspace.deletedAt && !options.allowTrash) throw new AppError('WORKSPACE_IN_TRASH');
  if (options.minRole && !orgRoleAtLeast(access.role, options.minRole)) throw new AppError('FORBIDDEN');
  return access;
}

const projectAccessSelect = (userId: string) =>
  ({
    id: true,
    name: true,
    organizationId: true,
    createdById: true,
    orgAccess: true,
    previewAssetId: true,
    lastEditedAt: true,
    lastEditedById: true,
    createdAt: true,
    deletedAt: true,
    organization: {
      select: { slug: true, deletedAt: true, members: { where: { userId }, select: { role: true }, take: 1 } },
    },
    members: { where: { userId }, select: { role: true }, take: 1 },
  }) as const;

export interface ProjectAccess {
  project: {
    id: string;
    name: string;
    organizationId: string;
    createdById: string;
    orgAccess: OrgAccess;
    previewAssetId: string | null;
    lastEditedAt: Date;
    lastEditedById: string | null;
    createdAt: Date;
    deletedAt: Date | null;
    workspaceSlug: string;
    workspaceDeleted: boolean;
  };
  role: ProjectRole;
  orgRole: OrgRole | null;
  directRole: ProjectRole | null;
}

export function projectRoleFrom(input: {
  orgRole: string | null | undefined;
  orgAccess: OrgAccess;
  directRole: ProjectRole | null | undefined;
  projectDeleted: boolean;
  workspaceDeleted: boolean;
}): EffectiveRole {
  const orgRole = input.orgRole && isOrgRole(input.orgRole) ? input.orgRole : null;
  return effectiveProjectRole({
    orgRole,
    orgAccess: input.orgAccess,
    directRole: input.directRole ?? null,
    projectDeleted: input.projectDeleted,
    workspaceDeleted: input.workspaceDeleted,
  });
}

// Una sola lectura: proyecto, papelera del espacio, Member y ProjectMember del usuario.
export async function loadProjectAccess(db: Db, userId: string, projectId: string): Promise<ProjectAccess | null> {
  const row = await db.project.findUnique({ where: { id: projectId }, select: projectAccessSelect(userId) });
  if (!row) return null;
  const orgRoleRaw = row.organization.members[0]?.role ?? null;
  const orgRole = orgRoleRaw && isOrgRole(orgRoleRaw) ? orgRoleRaw : null;
  const directRole = row.members[0]?.role ?? null;
  const workspaceDeleted = row.organization.deletedAt !== null;
  const role = effectiveProjectRole({
    orgRole,
    orgAccess: row.orgAccess,
    directRole,
    projectDeleted: row.deletedAt !== null,
    workspaceDeleted,
  });
  if (role === null) return null;
  const { organization, members: _members, ...project } = row;
  return {
    project: { ...project, workspaceSlug: organization.slug, workspaceDeleted },
    role,
    orgRole,
    directRole,
  };
}

export async function requireProject(
  db: Db,
  userId: string,
  projectId: string,
  capability: ProjectCapability = 'project:view',
): Promise<ProjectAccess> {
  const access = await loadProjectAccess(db, userId, projectId);
  if (!access) throw new AppError('PROJECT_NOT_FOUND');
  if (!can(access.role, capability)) throw new AppError('FORBIDDEN');
  return access;
}
