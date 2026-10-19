import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import type { RpcClient } from '../rpc.js';

// La instancia de collab con el documento abierto lo guarda ya; sin ninguna, lo guardado es lo último.
export async function flushLiveDocument(rpc: RpcClient, userId: string, projectId: string): Promise<void> {
  const reply = await rpc.call(
    { type: 'document.flush', requestId: randomUUID(), projectId, userId },
    { fallback: async () => ({ ok: true, flushed: true }) },
  );
  if (!reply) throw new AppError('COLLAB_UNAVAILABLE');
  if (!reply.ok) throw new AppError(reply.error === 'epoch_changed' ? 'DOCUMENT_RELOADED' : 'COLLAB_UNAVAILABLE');
}
