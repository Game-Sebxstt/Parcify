import { requestCompaction } from '../../../core/jobs/compact.js';
import { requireProject } from '../../../core/permissions.js';
import type { Actor } from '../../types.js';
import type { ProjectDeps } from './service.js';

// «Recompactar»: la compactación periódica lo atiende cuando ninguna instancia tiene el documento cargado.
export async function scheduleCompaction(deps: Pick<ProjectDeps, 'db' | 'redis'>, actor: Actor, projectId: string): Promise<void> {
  await requireProject(deps.db, actor.userId, projectId, 'project:manage');
  await requestCompaction(deps.redis, projectId);
}
