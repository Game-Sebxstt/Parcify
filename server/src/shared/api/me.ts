import { z } from 'zod';
import { ORG_ROLES } from '../permissions.js';
import { AuthIdSchema, IsoDateSchema, ListQuerySchema, NameSchema, SlugSchema, UuidSchema, pageOf } from './common.js';

export const LocaleSchema = z.enum(['es', 'en']);

export const MeWorkspaceSchema = z.object({
  id: AuthIdSchema,
  slug: SlugSchema,
  name: z.string(),
  personal: z.boolean(),
  role: z.enum(ORG_ROLES),
  logoAssetId: UuidSchema.nullable(),
});

export const MeResponseSchema = z.object({
  user: z.object({
    id: AuthIdSchema,
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    avatarAssetId: UuidSchema.nullable(),
    bio: z.string().nullable(),
    locale: LocaleSchema,
    createdAt: IsoDateSchema,
  }),
  workspaces: z.array(MeWorkspaceSchema),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateMeBodySchema = z
  .object({
    name: NameSchema.optional(),
    bio: z.string().trim().max(280).nullable().optional(),
    locale: LocaleSchema.optional(),
    avatarAssetId: UuidSchema.nullable().optional(),
  })
  .strict();

export const SECURITY_EVENT_TYPES = [
  'security.session_created',
  'security.session_revoked',
  'security.email_changed',
  'security.password_changed',
  'security.account_linked',
] as const;

// Solo los datos que ayudan a reconocer un acceso; nunca ids de sesión, tokens ni códigos.
export const SecurityEventSchema = z.object({
  id: UuidSchema,
  type: z.enum(SECURITY_EVENT_TYPES),
  createdAt: IsoDateSchema,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  provider: z.string().nullable(),
});
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;

export const SecurityEventsQuerySchema = ListQuerySchema;

export const SecurityEventsResponseSchema = pageOf(SecurityEventSchema);

export const SetPasswordBodySchema = z.object({ newPassword: z.string().min(10).max(128) }).strict();

export const DeleteMeConflictDetailsSchema = z.object({
  workspaces: z.array(z.object({ slug: SlugSchema, name: z.string() })),
});
