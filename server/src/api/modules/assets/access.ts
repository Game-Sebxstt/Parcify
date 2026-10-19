import type { Db } from '../../../core/db.js';
import { isProjectRole, projectRoleFrom } from '../../../core/permissions.js';
import type { OrgAccess } from '../../../shared/permissions.js';

export interface AssetRow {
  id: string;
  source: 'upload' | 'ai' | 'import' | 'preview' | 'avatar' | 'logo' | 'template';
  storageKey: string;
  variants: unknown;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  name: string | null;
  inGallery: boolean;
  projectId: string | null;
  organizationId: string | null;
  ownerId: string;
  createdAt: Date;
}

interface AccessRow extends AssetRow {
  orgAccess: OrgAccess | null;
  projectDeleted: boolean;
  workspaceDeleted: boolean;
  orgRole: string | null;
  directRole: string | null;
  avatarVisible: boolean;
  logoVisible: boolean;
  templateVisible: boolean;
}

// Quién puede ver a un usuario en un proyecto: owner/admin del espacio, member con orgAccess o ProjectMember.
// Va en SQL para resolver todo el lote en una sola consulta.
export async function loadVisibleAssets(db: Db, userId: string, ids: string[]): Promise<AssetRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.$queryRaw<AccessRow[]>`
    SELECT a.id, a.source::text AS source, a."storageKey", a.variants, a.mime, a."sizeBytes", a.width, a.height,
      a.sha256, a.name, a."inGallery", a."projectId", a."organizationId", a."ownerId", a."createdAt",
      p."orgAccess"::text AS "orgAccess",
      (p."deletedAt" IS NOT NULL) AS "projectDeleted",
      (po."deletedAt" IS NOT NULL) AS "workspaceDeleted",
      om.role AS "orgRole",
      pm.role::text AS "directRole",
      CASE WHEN a.source = 'avatar' THEN (
        a."ownerId" = ${userId}
        OR EXISTS (
          SELECT 1 FROM member m1
          JOIN member m2 ON m2."organizationId" = m1."organizationId" AND m2."userId" = a."ownerId"
          JOIN organization o ON o.id = m1."organizationId" AND o."deletedAt" IS NULL
          WHERE m1."userId" = ${userId})
        OR EXISTS (
          SELECT 1 FROM "ProjectMember" x
          JOIN "Project" y ON y.id = x."projectId" AND y."deletedAt" IS NULL
          JOIN organization yo ON yo.id = y."organizationId" AND yo."deletedAt" IS NULL
          WHERE x."userId" IN (${userId}, a."ownerId")
            AND (
              EXISTS (SELECT 1 FROM "ProjectMember" q WHERE q."projectId" = y.id AND q."userId" = ${userId})
              OR EXISTS (SELECT 1 FROM member q WHERE q."organizationId" = y."organizationId" AND q."userId" = ${userId}
                AND (q.role IN ('owner', 'admin') OR y."orgAccess" <> 'none')))
            AND (
              EXISTS (SELECT 1 FROM "ProjectMember" q WHERE q."projectId" = y.id AND q."userId" = a."ownerId")
              OR EXISTS (SELECT 1 FROM member q WHERE q."organizationId" = y."organizationId" AND q."userId" = a."ownerId"
                AND (q.role IN ('owner', 'admin') OR y."orgAccess" <> 'none'))))
      ) ELSE false END AS "avatarVisible",
      CASE WHEN a.source = 'logo' THEN (
        EXISTS (
          SELECT 1 FROM member m JOIN organization o ON o.id = m."organizationId"
          WHERE m."organizationId" = a."organizationId" AND m."userId" = ${userId}
            AND (o."deletedAt" IS NULL OR m.role = 'owner'))
        OR EXISTS (
          SELECT 1 FROM "ProjectMember" x
          JOIN "Project" y ON y.id = x."projectId" AND y."deletedAt" IS NULL
          JOIN organization yo ON yo.id = y."organizationId" AND yo."deletedAt" IS NULL
          WHERE x."userId" = ${userId} AND y."organizationId" = a."organizationId")
      ) ELSE false END AS "logoVisible",
      CASE WHEN a.source = 'template' THEN (
        t.id IS NOT NULL AND (
          t."organizationId" IS NULL
          OR EXISTS (
            SELECT 1 FROM member m JOIN organization o ON o.id = m."organizationId" AND o."deletedAt" IS NULL
            WHERE m."organizationId" = t."organizationId" AND m."userId" = ${userId}))
      ) ELSE false END AS "templateVisible"
    FROM "Asset" a
    LEFT JOIN "Project" p ON p.id = a."projectId"
    LEFT JOIN organization po ON po.id = p."organizationId"
    LEFT JOIN member om ON om."organizationId" = p."organizationId" AND om."userId" = ${userId}
    LEFT JOIN "ProjectMember" pm ON pm."projectId" = p.id AND pm."userId" = ${userId}
    LEFT JOIN "Template" t ON t.id = a."templateId"
    WHERE a.id = ANY(${ids}::uuid[]) AND a.status = 'ready' AND a."deletedAt" IS NULL`;

  return rows.filter(isVisible).map(stripAccess);
}

function isVisible(row: AccessRow): boolean {
  switch (row.source) {
    case 'avatar':
      return row.avatarVisible;
    case 'logo':
      return row.logoVisible;
    case 'template':
      return row.templateVisible;
    default: {
      if (!row.projectId || !row.orgAccess) return false;
      const directRole = row.directRole && isProjectRole(row.directRole) ? row.directRole : null;
      return (
        projectRoleFrom({
          orgRole: row.orgRole,
          orgAccess: row.orgAccess,
          directRole,
          projectDeleted: row.projectDeleted,
          workspaceDeleted: row.workspaceDeleted,
        }) !== null
      );
    }
  }
}

function stripAccess(row: AccessRow): AssetRow {
  return {
    id: row.id,
    source: row.source,
    storageKey: row.storageKey,
    variants: row.variants,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    name: row.name,
    inGallery: row.inGallery,
    projectId: row.projectId,
    organizationId: row.organizationId,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
  };
}
