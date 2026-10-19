import {
  APICallError,
  JSONParseError,
  NoContentGeneratedError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from 'ai';
import { AppError } from '../errors.js';

export const AI_TEXT_TIMEOUT_MS = 60_000;
export const AI_IMAGE_TIMEOUT_MS = 120_000;

// Lo lanza quien llama al modelo si la respuesta termina con finishReason 'content-filter'.
export class AiRefusedError extends Error {
  constructor() {
    super('El proveedor bloqueó el contenido');
    this.name = 'AiRefusedError';
  }
}

const CONTENT_POLICY = /content[_ -]?(policy|filter|management)|safety|moderation|responsible ?ai/i;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function isRefusal(error: APICallError): boolean {
  if (error.statusCode !== 400 && error.statusCode !== 403) return false;
  return CONTENT_POLICY.test(`${error.message} ${error.responseBody ?? ''}`);
}

export function translateAiError(error: unknown, timedOut: boolean): AppError {
  if (error instanceof AppError) return error;
  if (timedOut) return new AppError('AI_TIMEOUT', { cause: error });
  const root = RetryError.isInstance(error) ? (error.lastError ?? error) : error;
  if (root instanceof AiRefusedError) return new AppError('AI_REFUSED', { cause: root });
  if (NoObjectGeneratedError.isInstance(root)) {
    return new AppError(root.finishReason === 'content-filter' ? 'AI_REFUSED' : 'AI_BAD_OUTPUT', { cause: root });
  }
  if (TypeValidationError.isInstance(root) || JSONParseError.isInstance(root) || NoContentGeneratedError.isInstance(root)) {
    return new AppError('AI_BAD_OUTPUT', { cause: root });
  }
  if (APICallError.isInstance(root)) {
    if (root.statusCode === 429) return new AppError('AI_PROVIDER_BUSY', { cause: root });
    if (isRefusal(root)) return new AppError('AI_REFUSED', { cause: root });
  }
  if (isTimeout(root)) return new AppError('AI_TIMEOUT', { cause: root });
  return new AppError('AI_PROVIDER_ERROR', { cause: root });
}
