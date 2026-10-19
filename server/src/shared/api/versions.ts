import { z } from 'zod';
import { AuthIdSchema, IsoDateSchema, NameSchema, UuidSchema } from './common.js';

export const VERSION_KINDS = ['auto', 'manual', 'restore_point'] as const;

export const VERSION_LIMITS = {
  pageMax: 50,
  keepAuto: 48,
  keepManual: 200,
} as const;

export const VersionSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  kind: z.enum(VERSION_KINDS),
  name: z.string().nullable(),
  // null en las automáticas; name null si la cuenta ya no existe.
  createdBy: z.object({ id: AuthIdSchema, name: z.string().nullable() }).nullable(),
  sizeBytes: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  createdAt: IsoDateSchema,
});

export type VersionDto = z.infer<typeof VersionSchema>;

export const VersionParamsSchema = z.object({ id: UuidSchema });
export const VersionItemParamsSchema = VersionParamsSchema.extend({ vid: UuidSchema });

export const VersionListQuerySchema = z.object({
  cursor: UuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(VERSION_LIMITS.pageMax).default(20),
});

// De la más reciente a la más antigua; nextCursor es el id de la última si quedan más.
export const VersionListResponseSchema = z.object({ items: z.array(VersionSchema), nextCursor: UuidSchema.nullable() });

// Sin nombre: la versión rápida de Ctrl+S.
export const CreateVersionBodySchema = z.object({ name: NameSchema.optional() }).strict();

export const RestoreVersionResponseSchema = z.object({ versionId: UuidSchema, restorePointId: UuidSchema });

export type RestoreVersionResponse = z.infer<typeof RestoreVersionResponseSchema>;
