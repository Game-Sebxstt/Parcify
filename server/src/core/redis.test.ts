import { describe, expect, it } from 'vitest';
import { REDIS_MAX_BACKOFF_MS, createRedis, redisRetryDelay } from './redis.js';

describe('redis', () => {
  it('limita el backoff a 2 s', () => {
    expect(redisRetryDelay(1)).toBe(200);
    expect(redisRetryDelay(100)).toBe(REDIS_MAX_BACKOFF_MS);
  });

  it('resuelve IPv4 e IPv6 (family 0), también en las conexiones duplicadas', () => {
    const client = createRedis('redis://127.0.0.1:1/0', { name: 'family' });
    client.on('error', () => {});
    const duplicate = client.duplicate();
    duplicate.on('error', () => {});
    try {
      expect(client.options.family).toBe(0);
      expect(duplicate.options.family).toBe(0);
    } finally {
      client.disconnect();
      duplicate.disconnect();
    }
  });
});
