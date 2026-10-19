import * as Y from 'yjs';
import { z } from 'zod';
import { IsoDateSchema, NameSchema } from '../api/common.js';
import { ROOT_KEYS } from './keys.js';
import { documentSchemaVersion } from './migrations.js';
import { DOCUMENT_SCHEMA_VERSION } from './schema.js';

// Formato .parcify: un ZIP con manifest.json, document.json y assets/{assetId}.{ext}.
export const PARCIFY_FORMAT = 'parcify';
export const PARCIFY_FORMAT_VERSION = 1;

export const ARCHIVE_PATHS = {
  manifest: 'manifest.json',
  document: 'document.json',
  assetsDir: 'assets/',
} as const;

export function assetArchivePath(assetId: string, ext: string): string {
  return `${ARCHIVE_PATHS.assetsDir}${assetId}.${ext}`;
}

export const ManifestSchema = z.object({
  format: z.literal(PARCIFY_FORMAT),
  formatVersion: z.literal(PARCIFY_FORMAT_VERSION),
  schemaVersion: z.number().int().min(1),
  exportedAt: IsoDateSchema,
  name: NameSchema,
});

export type Manifest = z.infer<typeof ManifestSchema>;

export function buildManifest(input: { name: string; schemaVersion: number; exportedAt?: Date }): Manifest {
  return {
    format: PARCIFY_FORMAT,
    formatVersion: PARCIFY_FORMAT_VERSION,
    schemaVersion: input.schemaVersion,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    name: input.name,
  };
}

// Páginas, nodos, textos y animaciones como JSON plano, indexados por id.
export interface DocumentJson {
  meta: { schemaVersion: number } & Record<string, unknown>;
  pages: Record<string, unknown>;
  nodes: Record<string, unknown>;
  texts: Record<string, string>;
  animations: Record<string, unknown>;
}

function plainEntries(map: Y.Map<unknown>): Record<string, unknown> {
  // Object.fromEntries define propiedades propias: una clave «__proto__» no cambia el prototipo.
  return Object.fromEntries([...map.entries()].map(([key, value]) => [key, value instanceof Y.AbstractType ? value.toJSON() : value]));
}

export function documentToJson(doc: Y.Doc): DocumentJson {
  const texts: Array<[string, string]> = [];
  doc.getMap(ROOT_KEYS.texts).forEach((value, key) => {
    if (value instanceof Y.Text) texts.push([key, value.toString()]);
  });
  return {
    meta: { ...plainEntries(doc.getMap(ROOT_KEYS.meta)), schemaVersion: documentSchemaVersion(doc) ?? DOCUMENT_SCHEMA_VERSION },
    pages: plainEntries(doc.getMap(ROOT_KEYS.pages)),
    nodes: plainEntries(doc.getMap(ROOT_KEYS.nodes)),
    texts: Object.fromEntries(texts),
    animations: plainEntries(doc.getMap(ROOT_KEYS.animations)),
  };
}
