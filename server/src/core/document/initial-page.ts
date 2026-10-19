import { createHash } from 'node:crypto';

// Página inicial con id derivado del proyecto: si dos instancias inicializan a la vez, escriben la misma clave.
export function initialPageId(projectId: string): string {
  return createHash('sha256').update(`page:${projectId}`).digest('base64url').slice(0, 21);
}
