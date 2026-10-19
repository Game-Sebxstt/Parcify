import { WorkspaceListResponseSchema } from '../shared/api/workspaces.js';
import type { z } from 'zod';
import { ApiError, apiFetch, cached, invalidateCache } from './api.ts';

export type Workspace = z.infer<typeof WorkspaceListResponseSchema>['items'][number];

// Lista compartida entre la barra lateral y el contenido de la página.
export const workspaces = $state<{ status: 'idle' | 'loading' | 'ready' | 'error'; items: Workspace[]; error: ApiError | null }>({
  status: 'idle',
  items: [],
  error: null,
});

export async function loadWorkspaces(options: { force?: boolean } = {}): Promise<Workspace[]> {
  if (options.force) invalidateCache('workspaces');
  if (workspaces.status === 'idle') workspaces.status = 'loading';
  try {
    const { items } = await cached('workspaces', () => apiFetch('/v1/workspaces', { schema: WorkspaceListResponseSchema }));
    workspaces.items = items;
    workspaces.status = 'ready';
    workspaces.error = null;
    return items;
  } catch (error) {
    workspaces.error = error instanceof ApiError ? error : new ApiError({ code: 'INTERNAL', status: 0 });
    if (workspaces.status !== 'ready') workspaces.status = 'error';
    return workspaces.items;
  }
}

export const activeWorkspaces = () => workspaces.items.filter((workspace) => workspace.deletedAt === null);

export const trashedWorkspaces = () => workspaces.items.filter((workspace) => workspace.deletedAt !== null);
