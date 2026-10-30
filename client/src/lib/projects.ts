import {
  BatchProjectsResponseSchema,
  ImportProjectResponseSchema,
  ProjectDetailSchema,
  ProjectListResponseSchema,
  ProjectSummarySchema,
  type ProjectSummary,
} from '../shared/api/projects.js';
import { apiBlob, apiFetch } from './api.ts';
import { uploadAsset } from './assets.ts';

export type ProjectListParams = {
  q?: string;
  filter?: 'all' | 'mine' | 'shared' | 'favorites' | 'trash';
  sort?: 'name' | 'edited' | 'created';
  dir?: 'asc' | 'desc';
  cursor?: string | null;
  limit?: number;
};

export function listWorkspaceProjects(slug: string, params: ProjectListParams = {}, signal?: AbortSignal) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.filter) search.set('filter', params.filter);
  if (params.sort) search.set('sort', params.sort);
  if (params.dir) search.set('dir', params.dir);
  if (params.cursor) search.set('cursor', params.cursor);
  search.set('limit', String(params.limit ?? 24));
  return apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/projects?${search}`, {
    schema: ProjectListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export function listSharedProjects(limit = 12, signal?: AbortSignal) {
  return apiFetch(`/v1/projects/shared?limit=${limit}`, { schema: ProjectListResponseSchema, ...(signal ? { signal } : {}) });
}

// Con templateId, el proyecto nace con el contenido y las imágenes de la plantilla.
export function createProject(slug: string, name: string, templateId?: string) {
  return apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/projects`, {
    method: 'POST',
    body: templateId ? { name, templateId } : { name },
    schema: ProjectSummarySchema,
  });
}

export function renameProject(id: string, name: string) {
  return apiFetch(`/v1/projects/${id}`, { method: 'PATCH', body: { name }, schema: ProjectDetailSchema });
}

// Lo escucha la barra lateral, que es otra isla, para refrescar su lista de favoritos.
export const FAVORITES_CHANGED = 'parcify:favorites-changed';

export async function setFavorite(id: string, favorite: boolean) {
  await apiFetch(`/v1/favorites/project/${id}`, { method: favorite ? 'PUT' : 'DELETE' });
  window.dispatchEvent(new CustomEvent(FAVORITES_CHANGED));
}

export function duplicateProject(id: string) {
  return apiFetch(`/v1/projects/${id}/duplicate`, { method: 'POST', body: {}, schema: ProjectSummarySchema });
}

export function trashProject(id: string) {
  return apiFetch(`/v1/projects/${id}`, { method: 'DELETE' });
}

export function restoreProject(id: string) {
  return apiFetch(`/v1/projects/${id}/restore`, { method: 'POST', schema: ProjectSummarySchema });
}

const BATCH_LIMIT = 50;

export async function batchProjects(action: 'delete' | 'duplicate' | 'restore', ids: string[]) {
  const results: Record<string, { ok: boolean }> = {};
  for (let start = 0; start < ids.length; start += BATCH_LIMIT) {
    const response = await apiFetch('/v1/projects/batch', {
      method: 'POST',
      body: { action, ids: ids.slice(start, start + BATCH_LIMIT) },
      schema: BatchProjectsResponseSchema,
    });
    Object.assign(results, response.results);
  }
  const ok = ids.filter((id) => results[id]?.ok);
  return { ok, failed: ids.length - ok.length };
}

// Orden por defecto de cada criterio: el nombre de la A a la Z y las fechas de la más reciente a la más antigua.
export function sortDirection(sort: 'name' | 'edited' | 'created'): 'asc' | 'desc' {
  return sort === 'name' ? 'asc' : 'desc';
}

export function byLastEdited(a: ProjectSummary, b: ProjectSummary) {
  return Date.parse(b.lastEditedAt) - Date.parse(a.lastEditedAt);
}

// El proyecto entero como .parcify (ZIP con document.json y las imágenes que quien exporta puede ver).
export function exportProjectArchive(id: string, signal?: AbortSignal): Promise<Blob> {
  return apiBlob(`/v1/projects/${id}/export.parcify`, signal ? { signal } : {});
}

// Crea un proyecto nuevo en el espacio a partir de un .parcify (exportado o copia local).
export function importProjectArchive(slug: string, file: File) {
  const body = new FormData();
  body.append('file', file, file.name || 'proyecto.parcify');
  return apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/import`, { method: 'POST', body, schema: ImportProjectResponseSchema });
}

// Vista previa del proyecto: se sube como asset 'preview' y se fija en el proyecto.
export async function uploadProjectPreview(projectId: string, blob: Blob): Promise<void> {
  const file = new File([blob], 'vista-previa.jpg', { type: blob.type || 'image/jpeg' });
  const asset = await uploadAsset(file, { purpose: 'preview', projectId });
  await apiFetch(`/v1/projects/${projectId}/preview`, { method: 'POST', body: { assetId: asset.id } });
}
