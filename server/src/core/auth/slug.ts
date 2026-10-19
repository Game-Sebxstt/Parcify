import { randomInt } from 'node:crypto';
import { AppError } from '../errors.js';

export const SLUG_PATTERN = /^[a-z0-9-]{1,48}$/;
export const SLUG_FALLBACK = 'espacio';

const MAX_BASE_LENGTH = 40;
const SUFFIX_LENGTH = 4;
const SUFFIX_ATTEMPTS = 5;
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, '');
  return base || SLUG_FALLBACK;
}

export function randomSlugSuffix(): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  return suffix;
}

// `attempt` devuelve null si el slug ya está ocupado; tras agotar los sufijos responde 409.
export async function withUniqueSlug<T>(
  name: string,
  attempt: (slug: string) => Promise<T | null>,
  suffix: () => string = randomSlugSuffix,
): Promise<T> {
  const base = slugify(name);
  const first = await attempt(base);
  if (first !== null) return first;
  for (let i = 0; i < SUFFIX_ATTEMPTS; i++) {
    const result = await attempt(`${base}-${suffix()}`);
    if (result !== null) return result;
  }
  throw new AppError('CONFLICT');
}
