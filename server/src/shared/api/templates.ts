import { z } from 'zod';
import { AuthIdSchema, IsoDateSchema, ListQuerySchema, NameSchema, UuidSchema, pageOf } from './common.js';

// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export const TemplateDescriptionSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !CONTROL_EXCEPT_NEWLINE.test(value), { message: 'no puede contener caracteres de control' });

export const PublishTemplateBodySchema = z
  .object({ name: NameSchema, description: TemplateDescriptionSchema.optional() })
  .strict();

export const TemplateSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  // workspace: publicada en el espacio; parcify: plantilla global.
  scope: z.enum(['workspace', 'parcify']),
  createdBy: z.object({ id: AuthIdSchema, name: z.string() }).nullable(),
  previewAssetId: UuidSchema.nullable(),
  likesCount: z.number().int().min(0),
  liked: z.boolean(),
  favorite: z.boolean(),
  createdAt: IsoDateSchema,
});

export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

export const TemplateListQuerySchema = ListQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  filter: z.enum(['all', 'favorites']).default('all'),
});

export type TemplateListQuery = z.infer<typeof TemplateListQuerySchema>;

export const TemplateListResponseSchema = pageOf(TemplateSummarySchema);

export const TemplateParamsSchema = z.object({ id: UuidSchema });

export const TemplateLikeResponseSchema = z.object({ liked: z.boolean(), likesCount: z.number().int().min(0) });

export type TemplateLikeResponse = z.infer<typeof TemplateLikeResponseSchema>;
