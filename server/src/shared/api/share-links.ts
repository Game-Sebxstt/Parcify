import { z } from 'zod';
import { PROJECT_ROLES } from '../permissions.js';
import { AuthIdSchema, EmailSchema, IsoDateSchema, UuidSchema } from './common.js';
import { ProjectMemberSchema, ProjectParamsSchema } from './projects.js';

// Un enlace nunca concede admin.
export const SHARE_LINK_ROLES = ['editor', 'viewer'] as const;
export const SHARE_LINK_MAX_DAYS = 30;
export const SHARE_LINK_MAX_USES = 500;
// Caducidad del enlace que se envía al invitar por email a alguien de fuera del espacio.
export const PROJECT_INVITATION_DAYS = 7;

export const ShareLinkRoleSchema = z.enum(SHARE_LINK_ROLES);

export const ShareLinkSchema = z.object({
  id: UuidSchema,
  role: ShareLinkRoleSchema,
  email: z.string().nullable(),
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  expiresAt: IsoDateSchema,
  createdById: AuthIdSchema,
  createdAt: IsoDateSchema,
});

export type ShareLink = z.infer<typeof ShareLinkSchema>;

export const ShareLinkListResponseSchema = z.object({ items: z.array(ShareLinkSchema) });

export const CreateShareLinkBodySchema = z
  .object({
    role: ShareLinkRoleSchema,
    expiresInDays: z.number().int().min(1).max(SHARE_LINK_MAX_DAYS),
    maxUses: z.number().int().min(1).max(SHARE_LINK_MAX_USES).optional(),
    email: EmailSchema.optional(),
  })
  .strict();

// La URL lleva el token y solo se devuelve aquí.
export const CreatedShareLinkSchema = ShareLinkSchema.extend({ url: z.string() });

export const ShareLinkParamsSchema = ProjectParamsSchema.extend({ linkId: UuidSchema });

// Sin formato estricto: un token mal formado responde igual que uno inexistente.
export const ShareTokenBodySchema = z.object({ token: z.string().min(1).max(256) }).strict();

export const ShareLinkInspectSchema = z.object({
  project: z.object({ id: UuidSchema, name: z.string() }),
  workspace: z.object({ name: z.string() }),
  role: ShareLinkRoleSchema,
  inviter: z.object({ name: z.string() }).nullable(),
  expiresAt: IsoDateSchema,
  // Rol que ya tiene quien inspecciona; si alcanza al del enlace, aceptar no cambia nada.
  currentRole: z.enum(PROJECT_ROLES).nullable(),
});

export const ShareLinkAcceptResponseSchema = z.object({ projectId: UuidSchema, role: z.enum(PROJECT_ROLES) });

export const ProjectInvitationBodySchema = z.object({ email: EmailSchema, role: ShareLinkRoleSchema }).strict();

// direct: ya era miembro del espacio y recibe acceso; link: se le envió un enlace de un solo uso.
export const ProjectInvitationResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct'), member: ProjectMemberSchema }),
  z.object({ kind: z.literal('link'), link: ShareLinkSchema }),
]);

export type ProjectInvitationResponse = z.infer<typeof ProjectInvitationResponseSchema>;
