import type { connectedPayload, Extension, onAuthenticatePayload } from '@hocuspocus/server';
import type { Logger } from 'pino';
import { CollabTokenError, verifyCollabToken } from '../../core/collab-token.js';
import type { Db } from '../../core/db.js';
import { loadProjectAccess } from '../../core/permissions.js';
import type { Redis } from '../../core/redis.js';
import { pickCollabColor } from '../../shared/collab-colors.js';
import { documentNameFor, projectIdFromDocumentName } from '../../shared/document/keys.js';
import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import { MIN_CLIENT_SCHEMA_VERSION } from '../../shared/document/schema.js';
import type { CollabMetrics } from '../metrics.js';
import { pendingMember, registerPending, unregister, waitForCompaction } from '../registry.js';
import { Rejection, type CollabContext, type CollabRuntime } from '../state.js';
import type { GuardExtension } from './guard.js';

const SESSION_CACHE_SECONDS = 30;

export function sessionCacheKey(sessionId: string): string {
  return `parcify:sess:${sessionId}`;
}

// onAuthenticate: token, documento, versión del cliente, acceso y sesión, límites, registro provisional,
// espera a la compactación y epoch. El registro provisional se borra en `connected` o al rechazar.
export class AuthExtension implements Extension {
  extensionName = 'auth';
  priority = 900;

  constructor(
    private readonly deps: {
      db: Db;
      redis: Redis;
      logger: Logger;
      metrics: CollabMetrics;
      runtime: CollabRuntime;
      guard: GuardExtension;
      collabTokenSecret: string;
    },
  ) {}

  private async sessionAlive(sessionId: string, userId: string): Promise<boolean> {
    const key = sessionCacheKey(sessionId);
    if ((await this.deps.redis.get(key)) === userId) return true;
    const rows = await this.deps.db.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok FROM "session" WHERE "id" = ${sessionId} AND "userId" = ${userId} AND "expiresAt" > now()`;
    if (rows.length === 0) return false;
    await this.deps.redis.set(key, userId, 'EX', SESSION_CACHE_SECONDS);
    return true;
  }

  async onAuthenticate(payload: onAuthenticatePayload<CollabContext>): Promise<CollabContext> {
    const { token, documentName, requestParameters, socketId, connectionConfig } = payload;
    const log = this.deps.logger.child({ documentName, socketId });
    let pendingProject: string | null = null;
    try {
      let claims;
      try {
        claims = await verifyCollabToken(this.deps.collabTokenSecret, token);
      } catch (error) {
        log.info({ reason: error instanceof CollabTokenError ? error.reason : 'malformed' }, 'Token de colaboración rechazado');
        throw new Rejection('invalid_token');
      }
      const userLog = log.child({ userId: claims.sub });

      if (documentName !== documentNameFor(claims.pid) || projectIdFromDocumentName(documentName) !== claims.pid) {
        userLog.warn({ projectId: claims.pid }, 'Token válido usado para otro documento');
        throw new Rejection('no_access');
      }

      const schemaVersion = Number(requestParameters.get('schemaVersion'));
      if (!Number.isInteger(schemaVersion) || schemaVersion < MIN_CLIENT_SCHEMA_VERSION) {
        userLog.info({ schemaVersion: requestParameters.get('schemaVersion') }, 'Cliente desactualizado');
        throw new Rejection('client_outdated');
      }

      const authorizedAt = Date.now();
      const access = await loadProjectAccess(this.deps.db, claims.sub, claims.pid);
      if (!access) {
        userLog.info({ reason: 'no_access' }, 'Conexión rechazada');
        throw new Rejection('no_access');
      }
      // Un proyecto en la papelera se puede restaurar desde la API, pero no editar.
      if (access.project.deletedAt) {
        userLog.info({ reason: 'not_found' }, 'Conexión rechazada');
        throw new Rejection('not_found');
      }
      // Un documento descartado (borrado o con epoch nuevo) espera a descargarse; el cliente reintenta.
      if (this.deps.runtime.docs.get(documentName)?.discarded) throw new Rejection('unavailable');
      if (!(await this.sessionAlive(claims.sid, claims.sub))) {
        userLog.info({ reason: 'session_revoked' }, 'Conexión rechazada');
        throw new Rejection('session_revoked');
      }

      this.deps.guard.admit(documentName, socketId, claims.sub);

      const [user, color] = await Promise.all([
        this.deps.db.user.findUnique({ where: { id: claims.sub }, select: { name: true } }),
        this.deps.db.projectColor.findUnique({
          where: { projectId_userId: { projectId: claims.pid, userId: claims.sub } },
          select: { color: true },
        }),
      ]);
      if (!user) throw new Rejection('no_access');

      await registerPending(this.deps.redis, claims.pid, socketId);
      pendingProject = claims.pid;

      if (!(await waitForCompaction(this.deps.redis, claims.pid))) {
        userLog.info({ reason: 'compacting' }, 'Conexión rechazada');
        throw new Rejection('compacting');
      }

      const stored = await this.deps.db.projectDocument.findUnique({
        where: { projectId: claims.pid },
        select: { epoch: true, sizeBytes: true },
      });
      const epoch = stored?.epoch ?? 1;
      if (epoch !== claims.ep) {
        userLog.info({ tokenEpoch: claims.ep, epoch }, 'Epoch distinto al del token');
        throw new Rejection('epoch_changed');
      }

      const loaded = this.deps.runtime.docs.get(documentName);
      const tooBig = loaded?.readOnlyBySize === true || (stored?.sizeBytes ?? 0) > DOCUMENT_LIMITS.sizeReadOnlyBytes;
      connectionConfig.readOnly = access.role === 'viewer' || tooBig;

      const context: CollabContext = {
        userId: claims.sub,
        name: user.name,
        color: color?.color ?? pickCollabColor(claims.sub, []),
        role: access.role,
        sessionId: claims.sid,
        socketId,
        epoch,
        projectId: claims.pid,
        organizationId: access.project.organizationId,
        authorizedAt,
      };
      // Las extensiones siguientes reciben el mismo objeto de contexto, no el que devuelve este hook.
      Object.assign(payload.context, context);
      return context;
    } catch (error) {
      this.deps.guard.release(socketId);
      if (pendingProject) {
        await unregister(this.deps.redis, pendingProject, pendingMember(socketId)).catch((cause: unknown) =>
          log.warn({ err: cause }, 'No se pudo borrar el registro provisional'),
        );
      }
      const rejection = error instanceof Rejection ? error : new Rejection('unavailable');
      if (!(error instanceof Rejection)) log.error({ err: error }, 'Error al autenticar la conexión');
      this.deps.metrics.rejections.inc({ reason: rejection.reason });
      throw rejection;
    }
  }

  async connected({ documentName, socketId }: connectedPayload<CollabContext>): Promise<void> {
    const projectId = projectIdFromDocumentName(documentName);
    if (!projectId) return;
    await unregister(this.deps.redis, projectId, pendingMember(socketId)).catch((error: unknown) =>
      this.deps.logger.warn({ err: error, documentName, socketId }, 'No se pudo borrar el registro provisional'),
    );
  }
}
