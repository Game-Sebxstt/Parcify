import {
  RestoreVersionResponseSchema,
  VersionListResponseSchema,
  VersionSchema,
} from '../shared/api/versions.js';
import { API_ORIGIN, ApiError, apiFetch, queryString } from './api.ts';

export const VERSIONS_PAGE = 20;

export function listVersions(projectId: string, cursor?: string | null) {
  return apiFetch(`/v1/projects/${projectId}/versions?${queryString({ cursor: cursor ?? null, limit: String(VERSIONS_PAGE) })}`, {
    schema: VersionListResponseSchema,
  });
}

// Sin nombre: la versión rápida de Ctrl+S.
export function createVersion(projectId: string, name?: string) {
  return apiFetch(`/v1/projects/${projectId}/versions`, {
    method: 'POST',
    body: name ? { name } : {},
    schema: VersionSchema,
  });
}

export function restoreVersion(projectId: string, versionId: string) {
  return apiFetch(`/v1/projects/${projectId}/versions/${versionId}/restore`, {
    method: 'POST',
    schema: RestoreVersionResponseSchema,
  });
}

// Estado Yjs binario de la versión, para la vista previa.
export async function fetchVersionState(projectId: string, versionId: string, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/v1/projects/${projectId}/versions/${versionId}/state`, {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({ code: 'NETWORK', status: 0 });
  }
  if (!response.ok) {
    throw new ApiError({ code: response.status === 404 ? 'NOT_FOUND' : response.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL', status: response.status });
  }
  return new Uint8Array(await response.arrayBuffer());
}
