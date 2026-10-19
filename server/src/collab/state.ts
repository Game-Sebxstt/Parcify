import type { Connection, Document } from '@hocuspocus/server';
import type { ProjectRole } from '../shared/permissions.js';

export interface CollabContext {
  userId: string;
  name: string;
  color: string;
  role: ProjectRole;
  sessionId: string;
  socketId: string;
  epoch: number;
  projectId: string;
  organizationId: string;
  // Momento en que se leyó el acceso; un evento posterior obliga a revisarlo.
  authorizedAt: number;
}

export type CollabConnection = Connection<CollabContext>;

// Motivos que recibe el cliente en `authenticationFailed`.
export type RejectionReason =
  | 'invalid_token'
  | 'client_outdated'
  | 'no_access'
  | 'session_revoked'
  | 'compacting'
  | 'epoch_changed'
  | 'document_full'
  | 'too_many_tabs'
  | 'not_found'
  | 'unavailable';

// Sin mensaje a propósito: Hocuspocus escribe en consola los errores con `message`.
export class Rejection extends Error {
  constructor(readonly reason: RejectionReason) {
    super();
    this.name = 'Rejection';
  }
}

export const CLOSE = {
  invalidData: { code: 4400, reason: 'invalid_data' },
  accessChanged: { code: 4401, reason: 'access_changed' },
  epochChanged: { code: 4409, reason: 'epoch_changed' },
  projectDeleted: { code: 4410, reason: 'project_deleted' },
  workspaceDeleted: { code: 4410, reason: 'workspace_deleted' },
  rateLimited: { code: 4429, reason: 'rate_limited' },
  messageTooBig: { code: 1009, reason: 'message_too_big' },
} as const;

export type CloseInfo = (typeof CLOSE)[keyof typeof CLOSE];

// El mensaje CLOSE de Hocuspocus no lleva código, así que se cierra también el socket con el código propio.
export function closeConnection(connection: Connection, info: CloseInfo): void {
  connection.readOnly = true;
  connection.close({ code: info.code, reason: info.reason });
  try {
    connection.webSocket.close(info.code, info.reason);
  } catch {
    // El socket ya estaba cerrado.
  }
}

export function connectionsOf(document: Document, filter?: (connection: CollabConnection) => boolean): CollabConnection[] {
  const all = document.getConnections() as CollabConnection[];
  return filter ? all.filter(filter) : all;
}

export function sendStateless(connection: Connection, payload: Record<string, unknown>): void {
  connection.sendStateless(JSON.stringify(payload));
}

export interface LoadedDocument {
  name: string;
  projectId: string;
  organizationId: string;
  epoch: number;
  // Se descarta sin guardar: proyecto borrado o epoch cambiado por una compactación.
  discarded: boolean;
  discardedWith: CloseInfo | null;
  readOnlyBySize: boolean;
  sizeWarned: boolean;
  lastSizeBytes: number;
  heartbeat: NodeJS.Timeout | null;
}

export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly capacity: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.updatedAt) / 1000) * this.ratePerSecond);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class StrikeCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  // Devuelve true si la conexión llega al límite dentro de la ventana.
  add(socketId: string, count = 1, now = Date.now()): boolean {
    const recent = (this.hits.get(socketId) ?? []).filter((at) => now - at < this.windowMs);
    for (let i = 0; i < count; i++) recent.push(now);
    this.hits.set(socketId, recent);
    return recent.length >= this.limit;
  }

  count(socketId: string, now = Date.now()): number {
    return (this.hits.get(socketId) ?? []).filter((at) => now - at < this.windowMs).length;
  }

  forget(socketId: string): void {
    this.hits.delete(socketId);
  }
}

export class CollabRuntime {
  readonly docs = new Map<string, LoadedDocument>();

  constructor(readonly strikes: StrikeCounter) {}
}
