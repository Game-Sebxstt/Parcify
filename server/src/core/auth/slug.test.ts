import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { SLUG_FALLBACK, SLUG_PATTERN, randomSlugSuffix, slugify, withUniqueSlug } from './slug.js';

describe('slugify', () => {
  it('quita acentos y pasa a minúsculas', () => {
    expect(slugify('Espacio de José Ñúñez')).toBe('espacio-de-jose-nunez');
    expect(slugify('ÁRBOL Çedilla über')).toBe('arbol-cedilla-uber');
  });

  it('sustituye cada tramo no alfanumérico por un guion y recorta los extremos', () => {
    expect(slugify('  --Hola,   mundo!!  ')).toBe('hola-mundo');
    expect(slugify('a_b.c/d')).toBe('a-b-c-d');
  });

  it('usa «espacio» si no queda nada', () => {
    expect(slugify('')).toBe(SLUG_FALLBACK);
    expect(slugify('   ')).toBe(SLUG_FALLBACK);
    expect(slugify('!!!')).toBe(SLUG_FALLBACK);
    expect(slugify('日本語')).toBe(SLUG_FALLBACK);
    expect(slugify('🎨🎨')).toBe(SLUG_FALLBACK);
  });

  it('corta a 40 caracteres sin dejar un guion al final', () => {
    const slug = slugify(`${'a'.repeat(39)} bcd`);
    expect(slug).toBe('a'.repeat(39));
    expect(slugify('x'.repeat(100))).toHaveLength(40);
  });

  it('siempre cumple la regex de los parámetros :slug', () => {
    const inputs = ['Espacio de Ana', '', 'Ñ', 'a'.repeat(300), 'Ünïcödé — test', '123', '-', 'x--y', 'Espacio de 🎨'];
    for (const input of inputs) expect(slugify(input)).toMatch(SLUG_PATTERN);
  });
});

describe('withUniqueSlug', () => {
  it('usa el slug base si está libre', async () => {
    const tried: string[] = [];
    const result = await withUniqueSlug('Mi Espacio', async (slug) => {
      tried.push(slug);
      return slug;
    });
    expect(result).toBe('mi-espacio');
    expect(tried).toEqual(['mi-espacio']);
  });

  it('añade un sufijo de 4 caracteres si el base está ocupado', async () => {
    const taken = new Set(['mi-espacio']);
    const result = await withUniqueSlug('Mi Espacio', async (slug) => (taken.has(slug) ? null : slug));
    expect(result).toMatch(/^mi-espacio-[a-z0-9]{4}$/);
    expect(result).toMatch(SLUG_PATTERN);
  });

  it('con un nombre de 40 caracteres el slug con sufijo sigue cumpliendo la regex', async () => {
    const result = await withUniqueSlug('z'.repeat(80), async (slug) => (slug === 'z'.repeat(40) ? null : slug));
    expect(result).toHaveLength(45);
    expect(result).toMatch(SLUG_PATTERN);
  });

  it('responde 409 CONFLICT tras cinco sufijos ocupados', async () => {
    let attempts = 0;
    const promise = withUniqueSlug('ocupado', async () => {
      attempts++;
      return null;
    });
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(attempts).toBe(6);
  });

  it('el sufijo aleatorio solo usa [a-z0-9]', () => {
    for (let i = 0; i < 50; i++) expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{4}$/);
  });
});
