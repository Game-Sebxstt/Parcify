import { z } from 'zod';
import { IsoDateSchema, ListQuerySchema, SlugSchema, UuidSchema, pageOf } from './common.js';

const MiB = 1024 * 1024;

export const UPLOAD_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
] as const;

export const MAX_UPLOAD_BYTES = 20 * MiB;
export const MAX_SMALL_UPLOAD_BYTES = 2 * MiB;

export const ASSET_VARIANTS = ['thumb', 'medium', 'full'] as const;

const fileFields = {
  fileName: z.string().trim().min(1).max(120),
  contentType: z.enum(UPLOAD_CONTENT_TYPES),
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
};

const small = { size: z.number().int().min(1).max(MAX_SMALL_UPLOAD_BYTES) };

export const CreateUploadBodySchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('canvas'), projectId: UuidSchema, ...fileFields }).strict(),
  z.object({ purpose: z.literal('gallery'), projectId: UuidSchema, ...fileFields }).strict(),
  z.object({ purpose: z.literal('chat'), projectId: UuidSchema, ...fileFields }).strict(),
  z.object({ purpose: z.literal('preview'), projectId: UuidSchema, ...fileFields, ...small }).strict(),
  z.object({ purpose: z.literal('avatar'), ...fileFields, ...small }).strict(),
  z.object({ purpose: z.literal('logo'), workspaceSlug: SlugSchema, ...fileFields, ...small }).strict(),
]);

export type CreateUploadBody = z.infer<typeof CreateUploadBodySchema>;

export const CreateUploadResponseSchema = z.object({
  assetId: UuidSchema,
  upload: z.object({ method: z.literal('PUT'), url: z.string(), headers: z.record(z.string(), z.string()) }),
});

export const AssetVariantSchema = z.object({ key: z.string(), w: z.number().int(), h: z.number().int() });

export const AssetSchema = z.object({
  id: UuidSchema,
  source: z.enum(['upload', 'ai', 'import', 'preview', 'avatar', 'logo', 'template']),
  status: z.enum(['pending', 'ready', 'failed']),
  mime: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  name: z.string().nullable(),
  inGallery: z.boolean(),
  variants: z.partialRecord(z.enum(ASSET_VARIANTS), z.object({ w: z.number().int(), h: z.number().int() })),
  createdAt: IsoDateSchema,
});

export type AssetDto = z.infer<typeof AssetSchema>;

export const AssetParamsSchema = z.object({ id: UuidSchema });

export const AssetListQuerySchema = ListQuerySchema.extend({ source: z.enum(['upload', 'ai']).optional() });

export const AssetListResponseSchema = pageOf(AssetSchema);

export const ResolveAssetsBodySchema = z
  .object({ ids: z.array(UuidSchema).min(1).max(200), variant: z.enum(ASSET_VARIANTS) })
  .strict();

export const ResolveAssetsResponseSchema = z.object({
  assets: z.record(UuidSchema, z.object({ url: z.string(), expiresAt: IsoDateSchema })),
});

// URL firmada de la variante full que el navegador descarga como archivo (Content-Disposition: attachment).
export const DownloadAssetResponseSchema = z.object({ url: z.string(), expiresAt: IsoDateSchema });

export const UpdateAssetBodySchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), inGallery: z.boolean().optional() })
  .strict();

export const CopyAssetsBodySchema = z
  .object({ ids: z.array(UuidSchema).min(1).max(50), targetProjectId: UuidSchema })
  .strict();

export const CopyAssetsResponseSchema = z.object({ ids: z.record(UuidSchema, UuidSchema) });

export const SetPreviewBodySchema = z.object({ assetId: UuidSchema }).strict();
