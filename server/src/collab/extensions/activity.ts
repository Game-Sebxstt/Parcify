import type {
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
  connectedPayload,
  Extension,
  onAwarenessUpdatePayload,
  onChangePayload,
  onDisconnectPayload,
} from '@hocuspocus/server';
import { isTransactionOrigin } from '@hocuspocus/server';
import type { Logger } from 'pino';
import type * as Y from 'yjs';
import { addEditCounters, utcDay } from '../../core/activity.js';
import type { Db } from '../../core/db.js';
import type { Redis } from '../../core/redis.js';
import { projectIdFromDocumentName, ROOT_KEYS } from '../../shared/document/keys.js';
import type { CollabConnection, CollabContext } from '../state.js';

export const ACTIVITY_FLUSH_MS = 60_000;
export const ACTIVE_MINUTES_TTL_SECONDS = 2 * 86_400;
export const SESSION_MIN_MS = 60_000;
export const RECONNECT_WINDOW_MS = 10 * 60_000;
const SESSION_END_TTL_MS = 86_400_000;

export function activeMinutesKey(projectId: string, userId: string, day: string): string {
  return `parcify:act:${projectId}:${userId}:${day.replaceAll('-', '')}`;
}

export function sessionEndKey(projectId: string, userId: string): string {
  return `parcify:act:sess:${projectId}:${userId}`;
}

interface Bucket {
  projectId: string;
  userId: string;
  day: string;
  editOps: number;
  nodesCreated: number;
  nodesDeleted: number;
  sessions: number;
  // Minutos del día (0-1439) aún sin deduplicar en Redis.
  minutes: Set<number>;
  // Minutos ya confirmados como nuevos por SADD y pendientes de volcar.
  newMinutes: number;
}

interface OpenConnection {
  projectId: string;
  userId: string;
  startedAt: number;
}

function minuteOfDay(at: number): number {
  return Math.floor((at % 86_400_000) / 60_000);
}

function isEmpty(bucket: Bucket): boolean {
  return (
    bucket.editOps === 0 &&
    bucket.nodesCreated === 0 &&
    bucket.nodesDeleted === 0 &&
    bucket.sessions === 0 &&
    bucket.minutes.size === 0 &&
    bucket.newMinutes === 0
  );
}

function localConnection(origin: unknown): CollabConnection | null {
  if (!isTransactionOrigin(origin) || origin.source !== 'connection') return null;
  const connection = origin.connection as CollabConnection;
  return connection.context?.userId && connection.context.projectId ? connection : null;
}

// Contadores de actividad por proyecto, usuario y día; solo cuenta lo que llega por conexiones de esta instancia.
export class ActivityExtension implements Extension {
  extensionName = 'activity';
  priority = 550;

  private readonly buckets = new Map<string, Bucket>();
  private readonly open = new Map<string, OpenConnection>();
  private readonly cursors = new Map<string, Map<number, string>>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly deps: { db: Db; redis: Redis; logger: Logger; flushMs?: number; now?: () => number },
  ) {
    this.timer = setInterval(() => void this.flush(), deps.flushMs ?? ACTIVITY_FLUSH_MS);
    this.timer.unref();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private bucket(projectId: string, userId: string, at: number): Bucket {
    const day = utcDay(new Date(at));
    const key = `${projectId}|${userId}|${day}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { projectId, userId, day, editOps: 0, nodesCreated: 0, nodesDeleted: 0, sessions: 0, minutes: new Set(), newMinutes: 0 };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private markMinute(context: CollabContext, at: number): Bucket {
    const bucket = this.bucket(context.projectId, context.userId, at);
    bucket.minutes.add(minuteOfDay(at));
    return bucket;
  }

  async afterLoadDocument({ document }: afterLoadDocumentPayload): Promise<void> {
    const nodes = document.getMap(ROOT_KEYS.nodes) as Y.Map<unknown>;
    nodes.observe((event, transaction) => {
      const connection = localConnection(transaction.origin);
      if (!connection) return;
      let created = 0;
      let deleted = 0;
      for (const change of event.changes.keys.values()) {
        if (change.action === 'add') created++;
        else if (change.action === 'delete') deleted++;
      }
      if (created === 0 && deleted === 0) return;
      const bucket = this.bucket(connection.context.projectId, connection.context.userId, this.now());
      bucket.nodesCreated += created;
      bucket.nodesDeleted += deleted;
    });
  }

  async onChange({ transactionOrigin }: onChangePayload<CollabContext>): Promise<void> {
    const connection = localConnection(transactionOrigin);
    if (!connection) return;
    this.markMinute(connection.context, this.now()).editOps++;
  }

  async onAwarenessUpdate({
    documentName,
    transactionOrigin,
    added,
    updated,
    removed,
    awareness,
  }: onAwarenessUpdatePayload<CollabContext>): Promise<void> {
    let cursors = this.cursors.get(documentName);
    for (const clientId of removed) cursors?.delete(clientId);
    const connection = localConnection(transactionOrigin);
    if (!connection) return;
    const states = awareness.getStates();
    for (const clientId of [...added, ...updated]) {
      const cursor = (states.get(clientId) as { cursor?: unknown } | undefined)?.cursor;
      if (!cursor) continue;
      const serialized = JSON.stringify(cursor);
      if (!cursors) {
        cursors = new Map();
        this.cursors.set(documentName, cursors);
      }
      if (cursors.get(clientId) === serialized) continue;
      cursors.set(clientId, serialized);
      this.markMinute(connection.context, this.now());
    }
  }

  async connected({ connection, socketId }: connectedPayload<CollabContext>): Promise<void> {
    const context = connection.context;
    if (!context?.userId || !context.projectId) return;
    this.open.set(socketId, { projectId: context.projectId, userId: context.userId, startedAt: this.now() });
  }

  async onDisconnect({ socketId }: onDisconnectPayload): Promise<void> {
    const entry = this.open.get(socketId);
    if (!entry) return;
    this.open.delete(socketId);
    const endedAt = this.now();
    if (endedAt - entry.startedAt <= SESSION_MIN_MS) return;
    try {
      // Fin de la última sesión larga del usuario en el proyecto, compartido entre instancias.
      const previous = await this.deps.redis.set(
        sessionEndKey(entry.projectId, entry.userId),
        String(endedAt),
        'PX',
        SESSION_END_TTL_MS,
        'GET',
      );
      const previousEnd = previous ? Number(previous) : null;
      if (previousEnd !== null && entry.startedAt - previousEnd <= RECONNECT_WINDOW_MS) return;
      this.bucket(entry.projectId, entry.userId, endedAt).sessions++;
    } catch (error) {
      this.deps.logger.warn({ err: error, projectId: entry.projectId }, 'No se pudo registrar la sesión');
    }
  }

  private restore(bucket: Bucket) {
    const key = `${bucket.projectId}|${bucket.userId}|${bucket.day}`;
    const current = this.buckets.get(key);
    if (!current) {
      this.buckets.set(key, bucket);
      return;
    }
    current.editOps += bucket.editOps;
    current.nodesCreated += bucket.nodesCreated;
    current.nodesDeleted += bucket.nodesDeleted;
    current.sessions += bucket.sessions;
    current.newMinutes += bucket.newMinutes;
    for (const minute of bucket.minutes) current.minutes.add(minute);
  }

  private async flushBucket(bucket: Bucket): Promise<void> {
    if (bucket.minutes.size > 0) {
      const key = activeMinutesKey(bucket.projectId, bucket.userId, bucket.day);
      const result = await this.deps.redis
        .multi()
        .sadd(key, ...[...bucket.minutes].map(String))
        .expire(key, ACTIVE_MINUTES_TTL_SECONDS)
        .exec();
      const added = result?.[0];
      if (!added || added[0]) throw added?.[0] ?? new Error('SADD sin respuesta');
      bucket.newMinutes += Number(added[1]);
      bucket.minutes.clear();
    }
    if (isEmpty(bucket)) return;
    await addEditCounters(this.deps.db, {
      projectId: bucket.projectId,
      userId: bucket.userId,
      day: bucket.day,
      counters: {
        editOps: bucket.editOps,
        nodesCreated: bucket.nodesCreated,
        nodesDeleted: bucket.nodesDeleted,
        activeMinutes: bucket.newMinutes,
        sessions: bucket.sessions,
      },
    });
  }

  // Vuelca lo acumulado; si falla, lo devuelve a memoria para el siguiente intento.
  async flush(projectId?: string): Promise<void> {
    const taken: Bucket[] = [];
    for (const [key, bucket] of this.buckets) {
      if (projectId && bucket.projectId !== projectId) continue;
      this.buckets.delete(key);
      taken.push(bucket);
    }
    await Promise.all(
      taken.map(async (bucket) => {
        try {
          await this.flushBucket(bucket);
        } catch (error) {
          this.deps.logger.error({ err: error, projectId: bucket.projectId }, 'No se pudo volcar la actividad');
          this.restore(bucket);
        }
      }),
    );
  }

  async afterUnloadDocument({ documentName, instance }: afterUnloadDocumentPayload): Promise<void> {
    if (instance.documents.has(documentName)) return;
    this.cursors.delete(documentName);
    const projectId = projectIdFromDocumentName(documentName);
    if (projectId) await this.flush(projectId);
  }

  async onDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
