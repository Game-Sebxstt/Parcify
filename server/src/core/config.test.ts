import { describe, expect, it } from 'vitest';
import { PRODUCTION_OVERRIDES, TEST_SECRET_A, baseEnv } from '../../test/helpers/env.js';
import { ConfigError, parseConfig } from './config.js';

function problemsOf(env: Record<string, string | undefined>, service: 'api' | 'collab' = 'api'): string[] {
  try {
    parseConfig(env, service);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseConfig', () => {
  it('acepta un entorno de desarrollo válido', () => {
    const config = parseConfig(baseEnv(), 'api');
    expect(config.clientOrigins).toEqual(['http://localhost:4321']);
    expect(config.databasePoolMax).toBe(10);
    expect(config.trustProxyHops).toBe(0);
    expect(config.storage.driver).toBe('local');
  });

  it('usa un pool de 5 en collab por defecto y no exige correo ni secreto de Better Auth', () => {
    const config = parseConfig(
      baseEnv({ MAIL_DRIVER: undefined, MAIL_FROM: undefined, BETTER_AUTH_SECRET: undefined }),
      'collab',
    );
    expect(config.databasePoolMax).toBe(5);
    expect(config.mail).toBeNull();
  });

  it('acepta un despliegue de producción con dominio propio compartido', () => {
    const config = parseConfig(baseEnv(PRODUCTION_OVERRIDES), 'api');
    expect(config.isProduction).toBe(true);
    expect(config.apiOrigin).toBe('https://api.parcify.app');
  });

  it('aborta con dominios *.up.railway.app distintos', () => {
    const problems = problemsOf(
      baseEnv({
        ...PRODUCTION_OVERRIDES,
        API_ORIGIN: 'https://api-x.up.railway.app',
        COLLAB_ORIGIN: 'https://collab-x.up.railway.app',
        CLIENT_ORIGINS: 'https://web-x.up.railway.app',
      }),
    );
    expect(problems.join('\n')).toContain('deben compartir dominio registrable');
  });

  it('aborta también fuera de producción si API y cliente no comparten sitio', () => {
    const problems = problemsOf(
      baseEnv({ API_ORIGIN: 'https://api-x.up.railway.app', CLIENT_ORIGINS: 'https://web-x.up.railway.app' }),
    );
    expect(problems.join('\n')).toContain('deben compartir dominio registrable');
  });

  it('solo admite localhost fuera de producción', () => {
    expect(problemsOf(baseEnv())).toEqual([]);
    const problems = problemsOf(baseEnv({ ...PRODUCTION_OVERRIDES, CLIENT_ORIGINS: 'http://localhost:4321' }));
    expect(problems.some((problem) => problem.includes('localhost solo se admite fuera de producción'))).toBe(true);
  });

  it('no trata localhost y 127.0.0.1 como el mismo sitio', () => {
    const problems = problemsOf(baseEnv({ CLIENT_ORIGINS: 'http://127.0.0.1:4321' }));
    expect(problems.join('\n')).toContain('deben compartir dominio registrable');
  });

  it('prohíbe MAIL_DRIVER=console en producción', () => {
    const problems = problemsOf(baseEnv({ ...PRODUCTION_OVERRIDES, MAIL_DRIVER: 'console' }));
    expect(problems).toContain('MAIL_DRIVER: console no se permite en producción');
  });

  it('solo admite MAIL_DRIVER=memory con NODE_ENV=test', () => {
    expect(problemsOf(baseEnv({ NODE_ENV: 'development' }))).toContain(
      'MAIL_DRIVER: memory solo se permite con NODE_ENV=test',
    );
  });

  it('avisa con STORAGE_DRIVER=local en producción', () => {
    const config = parseConfig(baseEnv(PRODUCTION_OVERRIDES), 'api');
    expect(config.warnings.some((warning) => warning.includes('STORAGE_DRIVER=local'))).toBe(true);
  });

  it('aborta si un AI_MODEL_* usa un proveedor sin clave', () => {
    const problems = problemsOf(baseEnv({ AI_MODEL_CHAT: 'openai:gpt-x' }));
    expect(problems).toContain('AI_MODEL_CHAT: el proveedor openai no tiene clave (OPENAI_API_KEY)');
  });

  it('valida la forma proveedor:modelo y el proveedor registrado', () => {
    expect(problemsOf(baseEnv({ AI_MODEL_IMAGE: 'sin-separador' }))).toContain(
      'AI_MODEL_IMAGE: debe tener la forma proveedor:modelo',
    );
    expect(problemsOf(baseEnv({ AI_MODEL_IMAGE: 'otro:modelo' })).join('\n')).toContain('proveedor desconocido');
    const config = parseConfig(baseEnv({ OPENAI_API_KEY: 'sk-test', AI_MODEL_CHAT: 'openai:gpt-x' }), 'api');
    expect(config.ai.models.chat).toEqual({ provider: 'openai', model: 'gpt-x', id: 'openai:gpt-x' });
  });

  it('solo admite el proveedor mock con NODE_ENV=test', () => {
    expect(parseConfig(baseEnv({ AI_MODEL_ASSISTANT: 'mock:assistant' }), 'api').ai.models.assistant?.provider).toBe('mock');
    expect(problemsOf(baseEnv({ NODE_ENV: 'development', MAIL_DRIVER: 'console', AI_MODEL_ASSISTANT: 'mock:assistant' }))).toContain(
      'AI_MODEL_ASSISTANT: el proveedor mock solo se admite con NODE_ENV=test',
    );
    expect(problemsOf(baseEnv({ ...PRODUCTION_OVERRIDES, AI_MODEL_CHAT: 'mock:chat' })).join('\n')).toContain('mock');
  });

  it('AI_IMAGE_DOWNLOAD_HOSTS solo admite nombres de host', () => {
    expect(parseConfig(baseEnv({ AI_IMAGE_DOWNLOAD_HOSTS: ' Img.Example.com , ' }), 'api').ai.imageDownloadHosts).toEqual([
      'img.example.com',
    ]);
    expect(problemsOf(baseEnv({ AI_IMAGE_DOWNLOAD_HOSTS: 'https://img.example.com/x' })).join('\n')).toContain(
      'AI_IMAGE_DOWNLOAD_HOSTS',
    );
  });

  it('aborta con secretos de menos de 32 caracteres', () => {
    expect(problemsOf(baseEnv({ BETTER_AUTH_SECRET: 'corto' })).join('\n')).toContain('BETTER_AUTH_SECRET');
    expect(problemsOf(baseEnv({ COLLAB_TOKEN_SECRET: 'x'.repeat(31) })).join('\n')).toContain('COLLAB_TOKEN_SECRET');
    expect(problemsOf(baseEnv({ STORAGE_URL_SECRET: 'x'.repeat(10) })).join('\n')).toContain('STORAGE_URL_SECRET');
  });

  it('exige que los dos secretos sean distintos', () => {
    expect(problemsOf(baseEnv({ COLLAB_TOKEN_SECRET: TEST_SECRET_A }))).toContain(
      'COLLAB_TOKEN_SECRET: debe ser distinta de BETTER_AUTH_SECRET',
    );
  });

  it('no admite reutilizar un secreto como STORAGE_URL_SECRET', () => {
    expect(problemsOf(baseEnv({ STORAGE_URL_SECRET: TEST_SECRET_A }))).toContain(
      'STORAGE_URL_SECRET: debe ser distinta de BETTER_AUTH_SECRET y de COLLAB_TOKEN_SECRET',
    );
  });

  it('en producción exige los secretos de cada servicio', () => {
    expect(problemsOf(baseEnv({ ...PRODUCTION_OVERRIDES, BETTER_AUTH_SECRET: undefined }))).toContain(
      'BETTER_AUTH_SECRET: es obligatoria en api',
    );
    expect(problemsOf(baseEnv({ ...PRODUCTION_OVERRIDES, COLLAB_TOKEN_SECRET: '' }), 'collab').join('\n')).toContain(
      'COLLAB_TOKEN_SECRET',
    );
    expect(problemsOf(baseEnv({ ...PRODUCTION_OVERRIDES, STORAGE_URL_SECRET: undefined }))).toContain(
      'STORAGE_URL_SECRET: es obligatoria con STORAGE_DRIVER=local',
    );
  });

  it('avisa en producción sin TRUST_PROXY_HOPS', () => {
    const warnings = (env: Record<string, string>) => parseConfig(baseEnv(env), 'api').warnings.join('\n');
    expect(warnings(PRODUCTION_OVERRIDES)).toContain('TRUST_PROXY_HOPS');
    expect(warnings({ ...PRODUCTION_OVERRIDES, TRUST_PROXY_HOPS: '1' })).not.toContain('TRUST_PROXY_HOPS');
  });

  it('exige las variables del driver de storage elegido', () => {
    const problems = problemsOf(baseEnv({ STORAGE_DRIVER: 's3' }));
    expect(problems).toContain('S3_BUCKET: es obligatoria con STORAGE_DRIVER=s3');
  });

  it('trata las variables vacías como ausentes', () => {
    const config = parseConfig(baseEnv({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', TRUST_PROXY_HOPS: '' }), 'api');
    expect(config.google).toBeNull();
    expect(config.trustProxyHops).toBe(0);
  });

  it('rechaza orígenes con ruta', () => {
    expect(problemsOf(baseEnv({ API_ORIGIN: 'http://localhost:3000/api' })).join('\n')).toContain('API_ORIGIN');
  });
});
