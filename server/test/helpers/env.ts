import { parseConfig, type Config, type Service } from '../../src/core/config.js';

export const TEST_SECRET_A = 'test-secret-a-0123456789abcdef-0123456789';
export const TEST_SECRET_B = 'test-secret-b-0123456789abcdef-0123456789';
export const TEST_SECRET_C = 'test-secret-c-0123456789abcdef-0123456789';

export function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_ORIGIN: 'http://localhost:3000',
    COLLAB_ORIGIN: 'http://localhost:3001',
    CLIENT_ORIGINS: 'http://localhost:4321',
    PORT: '3000',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://parcify:parcify_test@127.0.0.1:55433/parcify_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://:parcify_test@127.0.0.1:56380/0',
    BETTER_AUTH_SECRET: TEST_SECRET_A,
    COLLAB_TOKEN_SECRET: TEST_SECRET_B,
    MAIL_DRIVER: 'memory',
    MAIL_FROM: 'Parcify <no-reply@example.com>',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_PATH: '/tmp/parcify-test-storage',
    STORAGE_URL_SECRET: TEST_SECRET_C,
    METRICS_TOKEN: 'metrics-token-0123456789',
    ...overrides,
  };
}

export const PRODUCTION_OVERRIDES: Record<string, string> = {
  NODE_ENV: 'production',
  API_ORIGIN: 'https://api.parcify.app',
  COLLAB_ORIGIN: 'https://collab.parcify.app',
  CLIENT_ORIGINS: 'https://parcify.app',
  MAIL_DRIVER: 'resend',
  RESEND_API_KEY: 're_test_key',
};

export function testConfig(overrides: Record<string, string | undefined> = {}, service: Service = 'api'): Config {
  return parseConfig(baseEnv(overrides), service);
}
