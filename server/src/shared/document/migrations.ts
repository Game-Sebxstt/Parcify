import type * as Y from 'yjs';
import { META_KEYS, ROOT_KEYS, serverOrigin } from './keys.js';
import { DOCUMENT_SCHEMA_VERSION } from './schema.js';

// Cada entrada lleva el documento de la versión N a la N + 1. Debe ser pura, determinista e idempotente.
export type Migration = (doc: Y.Doc) => void;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // La v2 solo añade campos opcionales cuya ausencia equivale a la v1.
  1: () => {},
};

export type MigrationResult = { from: number; to: number; applied: number[] };

export class DocumentTooNewError extends Error {
  constructor(readonly version: number) {
    super(`El documento usa la versión de esquema ${version}, más nueva que la soportada`);
    this.name = 'DocumentTooNewError';
  }
}

export function documentSchemaVersion(doc: Y.Doc): number | null {
  const value = doc.getMap(ROOT_KEYS.meta).get(META_KEYS.schemaVersion);
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

export function migrate(
  doc: Y.Doc,
  options: { migrations?: Readonly<Record<number, Migration>>; target?: number; origin?: unknown } = {},
): MigrationResult {
  const migrations = options.migrations ?? MIGRATIONS;
  const target = options.target ?? DOCUMENT_SCHEMA_VERSION;
  const from = documentSchemaVersion(doc);
  if (from === null) return { from: target, to: target, applied: [] };
  if (from > target) throw new DocumentTooNewError(from);
  if (from === target) return { from, to: target, applied: [] };

  const steps: Array<[number, Migration]> = [];
  for (let version = from; version < target; version++) {
    const step = migrations[version];
    if (!step) throw new Error(`Falta la migración ${version} → ${version + 1}`);
    steps.push([version, step]);
  }

  const applied: number[] = [];
  doc.transact(() => {
    for (const [version, step] of steps) {
      step(doc);
      applied.push(version);
    }
    doc.getMap(ROOT_KEYS.meta).set(META_KEYS.schemaVersion, target);
  }, options.origin ?? serverOrigin('migration'));
  return { from, to: target, applied };
}
