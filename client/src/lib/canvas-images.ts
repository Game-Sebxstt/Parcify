import {
  CopyAssetsResponseSchema,
  DownloadAssetResponseSchema,
  MAX_UPLOAD_BYTES,
  ResolveAssetsResponseSchema,
  UPLOAD_CONTENT_TYPES,
  type AssetDto,
} from '../shared/api/assets.js';
import { AssetResolver } from '../engine/assets/AssetResolver.ts';
import { ApiError, apiFetch } from './api.ts';
import { checkUpload, uploadAsset } from './assets.ts';

export const CANVAS_IMAGE_ACCEPT = UPLOAD_CONTENT_TYPES.join(',');

// URLs firmadas de las imágenes del lienzo, en lotes de 200 cada 16 ms.
// Sin red, con 429 o con un error del servidor, el lote se repite; el resto deja las imágenes como rotas.
export const canvasAssets = new AssetResolver(
  async (ids, variant) => {
    const { assets } = await apiFetch('/v1/assets/resolve', {
      method: 'POST',
      body: { ids, variant },
      schema: ResolveAssetsResponseSchema,
      redirectOn401: false,
    });
    return assets;
  },
  { isTransient: (error) => error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500) },
);

// Imagen para el lienzo: hasta 20 MiB, SVG incluido (el servidor lo rasteriza).
export async function uploadCanvasImage(file: File, projectId: string): Promise<AssetDto> {
  checkUpload(file, MAX_UPLOAD_BYTES, true);
  return uploadAsset(file, { purpose: 'canvas', projectId });
}

// Lo mismo, pero el asset queda en la galería del proyecto.
export async function uploadGalleryImage(file: File, projectId: string): Promise<AssetDto> {
  checkUpload(file, MAX_UPLOAD_BYTES, true);
  return uploadAsset(file, { purpose: 'gallery', projectId });
}

// Imágenes de otro espacio pegadas aquí: el servidor las copia al proyecto y devuelve los ids nuevos.
export async function copyAssetsTo(projectId: string, ids: string[]): Promise<Record<string, string>> {
  const { ids: copied } = await apiFetch('/v1/assets/copy', {
    method: 'POST',
    body: { ids, targetProjectId: projectId },
    schema: CopyAssetsResponseSchema,
  });
  return copied;
}

// Abre la descarga de la variante full; el servidor la sirve como archivo adjunto.
export async function downloadAsset(assetId: string): Promise<void> {
  const { url } = await apiFetch(`/v1/assets/${assetId}/download`, { method: 'POST', schema: DownloadAssetResponseSchema });
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}