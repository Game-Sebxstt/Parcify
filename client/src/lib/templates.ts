import {
  TemplateLikeResponseSchema,
  TemplateListResponseSchema,
  TemplateSummarySchema,
  type TemplateListQuery,
} from '../shared/api/templates.js';
import { apiFetch, queryString } from './api.ts';

export type TemplateListParams = {
  q?: string;
  filter?: TemplateListQuery['filter'];
  cursor?: string | null;
  limit?: number;
};

export function listTemplates(slug: string, params: TemplateListParams = {}, signal?: AbortSignal) {
  const search = queryString({
    q: params.q,
    filter: params.filter === 'favorites' ? 'favorites' : null,
    cursor: params.cursor,
    limit: String(params.limit ?? 24),
  });
  return apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/templates?${search}`, {
    schema: TemplateListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export function setTemplateLike(id: string, liked: boolean) {
  return apiFetch(`/v1/templates/${id}/like`, { method: liked ? 'PUT' : 'DELETE', schema: TemplateLikeResponseSchema });
}

export function setTemplateFavorite(id: string, favorite: boolean) {
  return apiFetch(`/v1/favorites/template/${id}`, { method: favorite ? 'PUT' : 'DELETE' });
}

// Copia el estado actual del proyecto y sus imágenes a una plantilla nueva del espacio.
export function publishTemplate(projectId: string, body: { name: string; description?: string }) {
  return apiFetch(`/v1/projects/${projectId}/template`, { method: 'POST', body, schema: TemplateSummarySchema });
}
