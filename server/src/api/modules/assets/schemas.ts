import { z } from 'zod';

export {
  AssetListQuerySchema,
  AssetListResponseSchema,
  AssetParamsSchema,
  AssetSchema,
  CopyAssetsBodySchema,
  CopyAssetsResponseSchema,
  CreateUploadBodySchema,
  CreateUploadResponseSchema,
  DownloadAssetResponseSchema,
  ResolveAssetsBodySchema,
  ResolveAssetsResponseSchema,
  SetPreviewBodySchema,
  UpdateAssetBodySchema,
} from '../../../shared/api/assets.js';

export const SignedQuerySchema = z.object({
  exp: z.string().regex(/^\d{1,12}$/).optional(),
  sig: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  name: z.string().max(200).optional(),
});
