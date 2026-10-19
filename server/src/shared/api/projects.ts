import { z } from 'zod';
import { ORG_ACCESS_LEVELS, PROJECT_ROLES } from '../permissions.js';
import { AuthIdSchema, IsoDateSchema, ListQuerySchema, NameSchema, SlugSchema, UuidSchema, pageOf } from './common.js';

export const ProjectSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  workspaceSlug: SlugSchema,
  role: z.enum(PROJECT_ROLES),
  previewAssetId: UuidSchema.nullable(),
  favorite: z.boolean(),
  createdById: AuthIdSchema,
  lastEditedAt: IsoDateSchema,
  // Quien hizo el último cambio guardado del documento; nulo si nadie lo ha editado o ya no existe.
  lastEditedBy: z.object({ id: AuthIdSchema, name: z.string() }).nullable(),
  createdAt: IsoDateSchema,
  deletedAt: IsoDateSchema.nullable(),
});

export const ProjectListQuerySchema = ListQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['name', 'edited', 'created']).default('edited'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  // trash: proyectos en la papelera que el usuario puede restaurar (admin efectivo).
  filter: z.enum(['all', 'mine', 'shared', 'favorites', 'trash']).default('all'),
});

export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectListResponseSchema = pageOf(ProjectSummarySchema);

export const ProjectParamsSchema = z.object({ id: UuidSchema });

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  orgAccess: z.enum(ORG_ACCESS_LEVELS),
  members: z.array(
    z.object({ userId: AuthIdSchema, name: z.string(), avatarAssetId: UuidSchema.nullable(), role: z.enum(PROJECT_ROLES) }),
  ),
});

export const CreateProjectBodySchema = z.object({ name: NameSchema, templateId: UuidSchema.optional() }).strict();

export const UpdateProjectBodySchema = z
  .object({ name: NameSchema.optional(), orgAccess: z.enum(ORG_ACCESS_LEVELS).optional() })
  .strict();

export const DuplicateProjectBodySchema = z.object({ targetWorkspaceSlug: SlugSchema.optional() }).strict();

export const BatchProjectsBodySchema = z
  .object({ action: z.enum(['delete', 'duplicate', 'restore']), ids: z.array(UuidSchema).min(1).max(50) })
  .strict();

export const BatchProjectsResponseSchema = z.object({
  results: z.record(
    UuidSchema,
    z.union([z.object({ ok: z.literal(true), id: UuidSchema.optional() }), z.object({ ok: z.literal(false), code: z.string() })]),
  ),
});

export const ProjectMemberSchema = z.object({
  userId: AuthIdSchema,
  name: z.string(),
  avatarAssetId: UuidSchema.nullable(),
  role: z.enum(PROJECT_ROLES),
  origin: z.enum(['workspace', 'direct']),
});

export const ProjectMembersResponseSchema = z.object({ items: z.array(ProjectMemberSchema) });

export const ProjectMemberParamsSchema = ProjectParamsSchema.extend({ userId: AuthIdSchema });

export const PutProjectMemberBodySchema = z.object({ role: z.enum(PROJECT_ROLES) }).strict();

export const FavoriteParamsSchema = z.object({ type: z.enum(['project', 'template']), id: UuidSchema });

export const CollabTokenResponseSchema = z.object({
  token: z.string(),
  url: z.string(),
  documentName: z.string(),
  role: z.enum(PROJECT_ROLES),
  user: z.object({ id: AuthIdSchema, name: z.string(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  epoch: z.number().int().min(1),
});

// POST /v1/workspaces/:slug/import (multipart con un .parcify).
export const ImportProjectResponseSchema = z.object({
  projectId: UuidSchema,
  droppedNodes: z.number().int().min(0),
  droppedAssets: z.number().int().min(0),
});

export type ImportProjectResponse = z.infer<typeof ImportProjectResponseSchema>;
