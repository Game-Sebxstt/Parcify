import { hostname } from 'node:os';
import { pino } from 'pino';
import { getDomain } from 'tldts';
import { z } from 'zod';

export type Service = 'api' | 'collab';

export const AI_PROVIDERS = {
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const;

// Proveedor simulado con salidas fijas; solo existe con NODE_ENV=test.
export const MOCK_AI_PROVIDER = 'mock';
export const MOCK_AI_MODELS = ['assistant', 'animation', 'chat', 'image', 'vision'] as const;

export type AiProvider = keyof typeof AI_PROVIDERS | typeof MOCK_AI_PROVIDER;

const AI_MODEL_VARS = {
  assistant: 'AI_MODEL_ASSISTANT',
  animation: 'AI_MODEL_ANIMATION',
  chat: 'AI_MODEL_CHAT',
  image: 'AI_MODEL_IMAGE',
  vision: 'AI_MODEL_VISION',
} as const;

export type AiFeature = keyof typeof AI_MODEL_VARS;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());
const secret = z.preprocess(blankToUndefined, z.string().min(32, 'debe tener al menos 32 caracteres'));
const optionalSecret = z.preprocess(
  blankToUndefined,
  z.string().min(32, 'debe tener al menos 32 caracteres').optional(),
);
const optionalInt = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());
const origin = z.preprocess(
  blankToUndefined,
  z.url({ protocol: /^https?$/ }).transform((value, ctx) => {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search || url.hash) {
      ctx.addIssue({ code: 'custom', message: 'debe ser un origen sin ruta (p. ej. https://api.parcify.app)' });
      return z.NEVER;
    }
    return url.origin;
  }),
);
const booleanFlag = z.preprocess(
  blankToUndefined,
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => value === 'true' || value === '1'),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.preprocess(
    blankToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  API_ORIGIN: origin,
  COLLAB_ORIGIN: origin,
  CLIENT_ORIGINS: z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    z.array(origin).min(1, 'debe tener al menos un origen'),
  ),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535)),
  INSTANCE_ID: optionalString,
  RAILWAY_REPLICA_ID: optionalString,
  TRUST_PROXY_HOPS: optionalInt(0, 10),
  DATABASE_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^postgres(ql)?$/ })),
  DATABASE_POOL_MAX: optionalInt(1, 200),
  REDIS_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^rediss?$/ })),
  BETTER_AUTH_SECRET: optionalSecret,
  COLLAB_TOKEN_SECRET: secret,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  MAIL_DRIVER: z.preprocess(blankToUndefined, z.enum(['smtp', 'resend', 'console', 'memory']).optional()),
  MAIL_FROM: optionalString,
  SMTP_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^smtps?$/ }).optional()),
  RESEND_API_KEY: optionalString,
  STORAGE_DRIVER: z.preprocess(blankToUndefined, z.enum(['s3', 'local'])),
  STORAGE_LOCAL_PATH: optionalString,
  STORAGE_URL_SECRET: optionalSecret,
  S3_ENDPOINT: z.preprocess(blankToUndefined, z.url({ protocol: /^https?$/ }).optional()),
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: booleanFlag,
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^https?$/ }).optional()),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL_ASSISTANT: optionalString,
  AI_MODEL_ANIMATION: optionalString,
  AI_MODEL_CHAT: optionalString,
  AI_MODEL_IMAGE: optionalString,
  AI_MODEL_VISION: optionalString,
  AI_QUOTA_WORKSPACE_MONTHLY_UNITS: optionalInt(0, 100_000_000),
  AI_QUOTA_USER_DAILY_UNITS: optionalInt(0, 10_000_000),
  AI_IMAGE_DOWNLOAD_HOSTS: optionalString,
  COLLAB_MAX_CONN_PER_DOC: optionalInt(1, 10_000),
  METRICS_TOKEN: z.preprocess(blankToUndefined, z.string().min(16, 'debe tener al menos 16 caracteres').optional()),
  SENTRY_DSN: z.preprocess(blankToUndefined, z.url().optional()),
});

type Env = z.infer<typeof envSchema>;

export type MailConfig =
  | { driver: 'smtp'; from: string; smtpUrl: string }
  | { driver: 'resend'; from: string; resendApiKey: string }
  | { driver: 'console'; from: string }
  | { driver: 'memory'; from: string };

export type StorageConfig =
  | { driver: 'local'; localPath: string; urlSecret: string }
  | {
      driver: 's3';
      endpoint: string | undefined;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    };

export type AiModelRef = { provider: AiProvider; model: string; id: string };

export interface Config {
  service: Service;
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  apiOrigin: string;
  collabOrigin: string;
  clientOrigins: string[];
  port: number;
  instanceId: string;
  trustProxyHops: number;
  databaseUrl: string;
  databasePoolMax: number;
  redisUrl: string;
  betterAuthSecret: string | undefined;
  collabTokenSecret: string;
  google: { clientId: string; clientSecret: string } | null;
  mail: MailConfig | null;
  storage: StorageConfig;
  ai: {
    keys: Partial<Record<keyof typeof AI_PROVIDERS, string>>;
    openaiBaseUrl: string | undefined;
    models: Partial<Record<AiFeature, AiModelRef>>;
    quotaWorkspaceMonthlyUnits: number | undefined;
    quotaUserDailyUnits: number | undefined;
    imageDownloadHosts: string[];
  };
  collabMaxConnPerDoc: number;
  metricsToken: string | undefined;
  sentryDsn: string | undefined;
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuración inválida:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

function siteOf(originValue: string, isProduction: boolean, variable: string, problems: string[]): string | null {
  const host = new URL(originValue).hostname;
  if (LOCAL_HOSTS.has(host)) {
    if (isProduction) {
      problems.push(`${variable}: ${host} solo se admite fuera de producción`);
      return null;
    }
    return host;
  }
  const domain = getDomain(host, { allowPrivateDomains: true });
  if (!domain) {
    problems.push(`${variable}: no se pudo calcular el dominio registrable de ${host}`);
    return null;
  }
  return domain;
}

function checkSameSite(env: Env, isProduction: boolean, problems: string[]) {
  const sites = new Set<string>();
  const entries: Array<[string, string]> = [
    ['API_ORIGIN', env.API_ORIGIN],
    ['COLLAB_ORIGIN', env.COLLAB_ORIGIN],
    ...env.CLIENT_ORIGINS.map((value): [string, string] => ['CLIENT_ORIGINS', value]),
  ];
  let failed = false;
  for (const [variable, value] of entries) {
    const site = siteOf(value, isProduction, variable, problems);
    if (site === null) failed = true;
    else sites.add(site);
    if (isProduction && new URL(value).protocol !== 'https:') {
      problems.push(`${variable}: en producción debe usar https`);
    }
  }
  if (!failed && sites.size > 1) {
    problems.push(
      'CLIENT_ORIGINS y API_ORIGIN deben compartir dominio registrable (p. ej. parcify.app y api.parcify.app); los dominios *.up.railway.app no sirven',
    );
  }
}

function parseModel(
  feature: AiFeature,
  value: string | undefined,
  keys: Config['ai']['keys'],
  nodeEnv: Env['NODE_ENV'],
  problems: string[],
) {
  if (!value) return undefined;
  const variable = AI_MODEL_VARS[feature];
  const separator = value.indexOf(':');
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (separator <= 0 || !model) {
    problems.push(`${variable}: debe tener la forma proveedor:modelo`);
    return undefined;
  }
  if (provider === MOCK_AI_PROVIDER) {
    if (nodeEnv !== 'test') {
      problems.push(`${variable}: el proveedor mock solo se admite con NODE_ENV=test`);
      return undefined;
    }
    if (!(MOCK_AI_MODELS as readonly string[]).includes(model)) {
      problems.push(`${variable}: modelo mock desconocido «${model}» (${MOCK_AI_MODELS.join(', ')})`);
      return undefined;
    }
    return { provider: MOCK_AI_PROVIDER, model, id: value } satisfies AiModelRef;
  }
  if (!(provider in AI_PROVIDERS)) {
    problems.push(`${variable}: proveedor desconocido «${provider}» (${Object.keys(AI_PROVIDERS).join(', ')})`);
    return undefined;
  }
  const typed = provider as keyof typeof AI_PROVIDERS;
  if (!keys[typed]) {
    problems.push(`${variable}: el proveedor ${provider} no tiene clave (${AI_PROVIDERS[typed]})`);
    return undefined;
  }
  return { provider: typed, model, id: value } satisfies AiModelRef;
}

function buildMail(env: Env, service: Service, isProduction: boolean, problems: string[]): MailConfig | null {
  if (!env.MAIL_DRIVER) {
    if (service === 'api') problems.push('MAIL_DRIVER: es obligatoria en api');
    return null;
  }
  if (!env.MAIL_FROM) {
    problems.push('MAIL_FROM: es obligatoria');
    return null;
  }
  const from = env.MAIL_FROM;
  switch (env.MAIL_DRIVER) {
    case 'console':
      if (isProduction) problems.push('MAIL_DRIVER: console no se permite en producción');
      return { driver: 'console', from };
    case 'memory':
      if (env.NODE_ENV !== 'test') problems.push('MAIL_DRIVER: memory solo se permite con NODE_ENV=test');
      return { driver: 'memory', from };
    case 'smtp':
      if (!env.SMTP_URL) {
        problems.push('SMTP_URL: es obligatoria con MAIL_DRIVER=smtp');
        return null;
      }
      return { driver: 'smtp', from, smtpUrl: env.SMTP_URL };
    case 'resend':
      if (!env.RESEND_API_KEY) {
        problems.push('RESEND_API_KEY: es obligatoria con MAIL_DRIVER=resend');
        return null;
      }
      return { driver: 'resend', from, resendApiKey: env.RESEND_API_KEY };
  }
}

function buildStorage(env: Env, isProduction: boolean, problems: string[], warnings: string[]): StorageConfig | null {
  if (env.STORAGE_DRIVER === 'local') {
    if (!env.STORAGE_LOCAL_PATH) problems.push('STORAGE_LOCAL_PATH: es obligatoria con STORAGE_DRIVER=local');
    if (!env.STORAGE_URL_SECRET) problems.push('STORAGE_URL_SECRET: es obligatoria con STORAGE_DRIVER=local');
    if (isProduction) {
      warnings.push('STORAGE_DRIVER=local en producción: la API debe tener una sola réplica con volumen persistente');
    }
    if (!env.STORAGE_LOCAL_PATH || !env.STORAGE_URL_SECRET) return null;
    return { driver: 'local', localPath: env.STORAGE_LOCAL_PATH, urlSecret: env.STORAGE_URL_SECRET };
  }
  const missing = (['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter(
    (name) => !env[name],
  );
  for (const name of missing) problems.push(`${name}: es obligatoria con STORAGE_DRIVER=s3`);
  if (missing.length > 0) return null;
  return {
    driver: 's3',
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION!,
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  };
}

export function parseConfig(source: Record<string, string | undefined>, service: Service): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'entorno'}: ${issue.message}`),
    );
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  const problems: string[] = [];
  const warnings: string[] = [];

  checkSameSite(env, isProduction, problems);

  if (service === 'api' && !env.BETTER_AUTH_SECRET) problems.push('BETTER_AUTH_SECRET: es obligatoria en api');
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET === env.COLLAB_TOKEN_SECRET) {
    problems.push('COLLAB_TOKEN_SECRET: debe ser distinta de BETTER_AUTH_SECRET');
  }

  if (
    env.STORAGE_URL_SECRET &&
    (env.STORAGE_URL_SECRET === env.BETTER_AUTH_SECRET || env.STORAGE_URL_SECRET === env.COLLAB_TOKEN_SECRET)
  ) {
    problems.push('STORAGE_URL_SECRET: debe ser distinta de BETTER_AUTH_SECRET y de COLLAB_TOKEN_SECRET');
  }

  if (isProduction && !env.TRUST_PROXY_HOPS) {
    warnings.push('TRUST_PROXY_HOPS=0 en producción: detrás del proxy de Railway todas las peticiones tendrán su IP (usa 1)');
  }

  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    problems.push('GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET: se configuran las dos o ninguna');
  }

  const mail = buildMail(env, service, isProduction, problems);
  const storage = buildStorage(env, isProduction, problems, warnings);

  const keys: Config['ai']['keys'] = {};
  if (env.OPENAI_API_KEY) keys.openai = env.OPENAI_API_KEY;
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) keys.google = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (env.ANTHROPIC_API_KEY) keys.anthropic = env.ANTHROPIC_API_KEY;
  const models: Config['ai']['models'] = {};
  for (const feature of Object.keys(AI_MODEL_VARS) as AiFeature[]) {
    const ref = parseModel(feature, env[AI_MODEL_VARS[feature]], keys, env.NODE_ENV, problems);
    if (ref) models[feature] = ref;
  }

  const imageDownloadHosts = (env.AI_IMAGE_DOWNLOAD_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const host of imageDownloadHosts) {
    if (!HOSTNAME.test(host)) {
      problems.push(`AI_IMAGE_DOWNLOAD_HOSTS: «${host}» debe ser un nombre de host sin esquema, puerto ni ruta`);
    }
  }

  if (problems.length > 0 || !storage) throw new ConfigError(problems);

  return {
    service,
    nodeEnv: env.NODE_ENV,
    isProduction,
    logLevel: env.LOG_LEVEL,
    apiOrigin: env.API_ORIGIN,
    collabOrigin: env.COLLAB_ORIGIN,
    clientOrigins: [...new Set(env.CLIENT_ORIGINS)],
    port: env.PORT,
    instanceId: env.INSTANCE_ID ?? env.RAILWAY_REPLICA_ID ?? hostname(),
    trustProxyHops: env.TRUST_PROXY_HOPS ?? 0,
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX ?? (service === 'api' ? 10 : 5),
    redisUrl: env.REDIS_URL,
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    collabTokenSecret: env.COLLAB_TOKEN_SECRET,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    mail,
    storage,
    ai: {
      keys,
      openaiBaseUrl: env.OPENAI_BASE_URL,
      models,
      quotaWorkspaceMonthlyUnits: env.AI_QUOTA_WORKSPACE_MONTHLY_UNITS,
      quotaUserDailyUnits: env.AI_QUOTA_USER_DAILY_UNITS,
      imageDownloadHosts,
    },
    collabMaxConnPerDoc: env.COLLAB_MAX_CONN_PER_DOC ?? 100,
    metricsToken: env.METRICS_TOKEN,
    sentryDsn: env.SENTRY_DSN,
    warnings,
  };
}

export function loadConfig(service: Service): Config {
  return parseConfig(process.env, service);
}

export function loadConfigOrExit(service: Service): Config {
  try {
    return loadConfig(service);
  } catch (error) {
    const level = process.env.LOG_LEVEL === 'silent' ? 'silent' : 'fatal';
    const logger = pino({ level, base: { service } });
    if (error instanceof ConfigError) logger.fatal({ problems: error.problems }, 'Configuración inválida');
    else logger.fatal({ err: error }, 'No se pudo cargar la configuración');
    process.exit(1);
  }
}
