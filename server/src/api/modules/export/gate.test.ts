import { describe, expect, it } from 'vitest';
import { AppError } from '../../../core/errors.js';
import { ImportGate } from './gate.js';

function rejection(run: () => unknown): AppError | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof AppError ? error : null;
  }
}

describe('ImportGate', () => {
  it('una importación a la vez por usuario y 503 con Retry-After para la segunda', () => {
    const gate = new ImportGate({ perInstance: 2, perUser: 1, retryAfterSeconds: 30 });
    const release = gate.admit('a');
    const error = rejection(() => gate.admit('a'));
    expect(error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(error?.headers?.['retry-after']).toBe('30');
    release();
    expect(rejection(() => gate.admit('a')())).toBeNull();
  });

  it('rechaza por encima del cupo de la instancia y libera una sola vez', () => {
    const gate = new ImportGate({ perInstance: 2, perUser: 1, retryAfterSeconds: 30 });
    const a = gate.admit('a');
    gate.admit('b');
    expect(rejection(() => gate.admit('c'))?.code).toBe('SERVICE_UNAVAILABLE');
    a();
    a();
    expect(gate.running).toBe(1);
    gate.admit('c');
    expect(rejection(() => gate.admit('d'))).not.toBeNull();
  });
});
