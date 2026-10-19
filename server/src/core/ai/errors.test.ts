import { APICallError, NoObjectGeneratedError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';
import { AiRefusedError, translateAiError } from './errors.js';

function apiError(statusCode: number, responseBody = '') {
  return new APICallError({ message: 'fallo', url: 'https://api.example.com', requestBodyValues: {}, statusCode, responseBody });
}

const meta = {
  response: { id: 'r', timestamp: new Date(0), modelId: 'm' },
  usage: {
    inputTokens: undefined,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    outputTokens: undefined,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: undefined,
  },
};

describe('translateAiError', () => {
  it('traduce los errores del proveedor a 504, 503, 422 y 502', () => {
    expect(translateAiError(new Error('x'), true).code).toBe('AI_TIMEOUT');
    expect(translateAiError(apiError(429), false).code).toBe('AI_PROVIDER_BUSY');
    expect(
      translateAiError(new RetryError({ message: 'r', reason: 'maxRetriesExceeded', errors: [apiError(429)] }), false).code,
    ).toBe('AI_PROVIDER_BUSY');
    expect(translateAiError(apiError(400, '{"error":{"code":"content_policy_violation"}}'), false).code).toBe('AI_REFUSED');
    expect(translateAiError(new AiRefusedError(), false).statusCode).toBe(422);
    expect(translateAiError(apiError(500), false).code).toBe('AI_PROVIDER_ERROR');
    expect(translateAiError(apiError(400, 'bad request'), false).code).toBe('AI_PROVIDER_ERROR');
  });

  it('una salida que no cumple el esquema es AI_BAD_OUTPUT, salvo si la bloqueó el filtro', () => {
    const invalid = new NoObjectGeneratedError({ ...meta, finishReason: 'stop', text: '{"x":1}' } as never);
    expect(translateAiError(invalid, false).code).toBe('AI_BAD_OUTPUT');
    const filtered = new NoObjectGeneratedError({ ...meta, finishReason: 'content-filter' } as never);
    expect(translateAiError(filtered, false).code).toBe('AI_REFUSED');
  });
});
