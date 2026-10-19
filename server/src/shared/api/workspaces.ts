import { z } from 'zod';
import { ORG_ROLES } from '../permissions.js';
import { AuthIdSchema, EmailSchema, IsoDateSchema, ListQuerySchema, NameSchema, SlugSchema, UuidSchema, pageOf } from './common.js';

export const WorkspaceSchema = z.object({
  id: AuthIdSchema,
  slug: SlugSchema,
  name: z.string(),
  personal: z.boolean(),
  role: z.enum(ORG_ROLES),
  logoAssetId: UuidSchema.nullable(),
  deletedAt: IsoDateSchema.nullable(),
  purgeAt: IsoDateSchema.nullable(),
});

export const WorkspaceListResponseSchema = z.object({ items: z.array(WorkspaceSchema) });

export const WorkspaceDetailSchema = WorkspaceSchema.extend({
  counts: z.object({ members: z.number().int(), projects: z.number().int() }),
});

export const WorkspaceParamsSchema = z.object({ slug: SlugSchema });

export const CreateWorkspaceBodySchema = z.object({ name: NameSchema }).strict();

export const UpdateWorkspaceBodySchema = z
  .object({ name: NameSchema.optional(), logoAssetId: UuidSchema.nullable().optional() })
  .strict();

export const WorkspaceMemberSchema = z.object({
  id: AuthIdSchema,
  userId: AuthIdSchema,
  name: z.string(),
  email: z.string(),
  avatarAssetId: UuidSchema.nullable(),
  role: z.enum(ORG_ROLES),
  createdAt: IsoDateSchema,
});

export const WorkspaceMembersQuerySchema = ListQuerySchema.extend({ cursor: AuthIdSchema.optional() });

export const WorkspaceMembersResponseSchema = pageOf(WorkspaceMemberSchema).extend({
  nextCursor: AuthIdSchema.nullable(),
});

export const WorkspaceMemberParamsSchema = WorkspaceParamsSchema.extend({ memberId: AuthIdSchema });

export const UpdateWorkspaceMemberBodySchema = z.object({ role: z.enum(ORG_ROLES) }).strict();

// Por invitación se entra como admin o member; owner solo se da desde la lista de miembros.
export const WORKSPACE_INVITE_ROLES = ['admin', 'member'] as const;

export const WorkspaceInvitationSchema = z.object({
  id: AuthIdSchema,
  email: z.string(),
  role: z.enum(WORKSPACE_INVITE_ROLES),
  expiresAt: IsoDateSchema,
  createdAt: IsoDateSchema,
  inviter: z.object({ id: AuthIdSchema, name: z.string() }),
});

export const WorkspaceInvitationListResponseSchema = z.object({ items: z.array(WorkspaceInvitationSchema) });

export const CreateWorkspaceInvitationBodySchema = z
  .object({ email: EmailSchema, role: z.enum(WORKSPACE_INVITE_ROLES) })
  .strict();

export const WorkspaceInvitationParamsSchema = WorkspaceParamsSchema.extend({ invitationId: AuthIdSchema });

export const InvitationParamsSchema = z.object({ invitationId: AuthIdSchema });

export const INVITATION_STATUSES = ['pending', 'accepted', 'rejected', 'canceled', 'expired'] as const;

export const ReceivedInvitationSchema = z.object({
  id: AuthIdSchema,
  workspace: z.object({ name: z.string(), slug: SlugSchema }),
  role: z.enum(WORKSPACE_INVITE_ROLES),
  inviter: z.object({ name: z.string() }),
  status: z.enum(INVITATION_STATUSES),
  expiresAt: IsoDateSchema,
});

export const AcceptInvitationResponseSchema = z.object({ slug: SlugSchema });
