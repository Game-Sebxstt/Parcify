import Fastify, { LogController } from 'fastify';
import type { DestinationStream } from 'pino';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AiModels } from '../core/ai/registry.js';
import type { Config } from '../core/config.js';
import type { Db } from '../core/db.js';
import { loggerOptions, requestIdFrom } from '../core/logger.js';
import type { Mailer } from '../core/mailer/index.js';
import type { Redis } from '../core/redis.js';
import type { StorageDriver } from '../core/storage/index.js';
import { aiAssistantRoutes } from './modules/ai/assistant.js';
import { aiAnimationRoutes } from './modules/ai/animation.js';
import { aiChatRoutes } from './modules/ai/chat.js';
import { aiImageRoutes } from './modules/ai/images.js';
import { aiUsageRoutes } from './modules/ai/usage.js';
import { activityRoutes } from './modules/activity/routes.js';
import { assetRoutes } from './modules/assets/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { collabTokenRoutes } from './modules/collab-token/routes.js';
import { exportRoutes } from './modules/export/routes.js';
import { favoriteRoutes } from './modules/favorites/routes.js';
import { fileRoutes } from './modules/files/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { meRoutes } from './modules/me/routes.js';
import { memberRoutes } from './modules/members/routes.js';
import { metaRoutes } from './modules/meta/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { shareLinkRoutes } from './modules/share-links/routes.js';
import { templateRoutes } from './modules/templates/routes.js';
import { testMailEnabled, testMailRoutes } from './modules/test-mail/routes.js';
import { versionRoutes } from './modules/versions/routes.js';
import { workspaceInvitationRoutes } from './modules/workspaces/invitations.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { aiPlugin } from './plugins/ai.js';
import { authPlugin } from './plugins/auth.js';
import { configPlugin } from './plugins/config.js';
import { errorsPlugin } from './plugins/errors.js';
import { mailerPlugin } from './plugins/mailer.js';
import { metricsPlugin } from './plugins/metrics.js';
import { prismaPlugin } from './plugins/prisma.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { redisPlugin } from './plugins/redis.js';
import { requestIdPlugin } from './plugins/request-id.js';
import { securityPlugin } from './plugins/security.js';
import { storagePlugin } from './plugins/storage.js';
import { underPressurePlugin } from './plugins/under-pressure.js';
import './types.js';

export const BODY_LIMIT_BYTES = 256 * 1024;

export interface BuildAppOptions {
  db?: Db;
  redis?: Redis;
  mailer?: Mailer;
  storage?: StorageDriver;
  logger?: boolean;
  // Destino de los logs en lugar de stdout (las pruebas lo leen).
  logStream?: DestinationStream;
  globalRateLimit?: number;
  aiModels?: AiModels;
}

export async function buildApp(config: Config, options: BuildAppOptions = {}) {
  const hops = config.trustProxyHops;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : options.logStream
          ? { ...loggerOptions(config), stream: options.logStream }
          : loggerOptions(config),
    // Confía solo en los saltos del proxy propio; lo que el cliente añada delante de X-Forwarded-For se ignora.
    trustProxy: hops > 0 ? (_address: string, hop: number) => hop < hops : false,
    bodyLimit: BODY_LIMIT_BYTES,
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    genReqId: requestIdFrom,
    routerOptions: { ignoreTrailingSlash: true },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('actor', null);

  await app.register(configPlugin, { config });
  await app.register(errorsPlugin);
  await app.register(requestIdPlugin);
  await app.register(prismaPlugin, { db: options.db });
  await app.register(redisPlugin, { redis: options.redis });
  await app.register(mailerPlugin, { mailer: options.mailer });
  await app.register(storagePlugin, { storage: options.storage });
  await app.register(aiPlugin, { models: options.aiModels });
  await app.register(securityPlugin);
  await app.register(underPressurePlugin);
  await app.register(rateLimitPlugin, { max: options.globalRateLimit });
  await app.register(metricsPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(metaRoutes, { prefix: '/v1' });
  await app.register(meRoutes, { prefix: '/v1' });
  await app.register(workspaceRoutes, { prefix: '/v1' });
  await app.register(workspaceInvitationRoutes, { prefix: '/v1' });
  await app.register(projectRoutes, { prefix: '/v1' });
  await app.register(memberRoutes, { prefix: '/v1' });
  await app.register(shareLinkRoutes, { prefix: '/v1' });
  await app.register(favoriteRoutes, { prefix: '/v1' });
  await app.register(collabTokenRoutes, { prefix: '/v1' });
  await app.register(assetRoutes, { prefix: '/v1' });
  await app.register(fileRoutes, { prefix: '/v1' });
  await app.register(chatRoutes, { prefix: '/v1' });
  await app.register(versionRoutes, { prefix: '/v1' });
  await app.register(exportRoutes, { prefix: '/v1' });
  await app.register(templateRoutes, { prefix: '/v1' });
  await app.register(activityRoutes, { prefix: '/v1' });
  await app.register(aiUsageRoutes, { prefix: '/v1' });
  await app.register(aiAssistantRoutes, { prefix: '/v1' });
  await app.register(aiChatRoutes, { prefix: '/v1' });
  await app.register(aiImageRoutes, { prefix: '/v1' });
  await app.register(aiAnimationRoutes, { prefix: '/v1' });
  if (testMailEnabled(config, app.mailer)) await app.register(testMailRoutes, { prefix: '/v1' });

  return app;
}
