import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../shared/api/errors.js';
import { AppError, ERROR_CATALOG } from './errors.js';

describe('errors', () => {
  it('tiene estado y mensaje en español para cada código compartido', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it('AppError toma el estado y el mensaje del catálogo', () => {
    const error = new AppError('WORKSPACE_IN_TRASH', { details: { slug: 'x' } });
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe(ERROR_CATALOG.WORKSPACE_IN_TRASH.message);
    expect(error.details).toEqual({ slug: 'x' });
  });
});
