import { readFileSync } from 'node:fs';

let cached: string | null = null;

export function sharedHash(): string {
  cached ??= readFileSync(new URL('../shared/SHARED_HASH', import.meta.url), 'utf8').trim();
  return cached;
}
