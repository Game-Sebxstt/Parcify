import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { newNodeId } from './ids.js';
import { META_KEYS, ROOT_KEYS, serverOrigin } from './keys.js';
import { DOCUMENT_SCHEMA_VERSION } from './schema.js';

export const DEFAULT_PAGE_NAME = 'Página 1';
export const DEFAULT_BACKGROUND = '#141416FF';

export function isDocumentInitialized(doc: Y.Doc): boolean {
  return doc.getMap(ROOT_KEYS.meta).has(META_KEYS.schemaVersion);
}

export function initDocument(
  doc: Y.Doc,
  options: { now?: number; pageId?: string; origin?: unknown } = {},
): { initialized: boolean; pageId: string | null } {
  if (isDocumentInitialized(doc)) return { initialized: false, pageId: null };
  const pageId = options.pageId ?? newNodeId();
  doc.transact(() => {
    const meta = doc.getMap(ROOT_KEYS.meta);
    meta.set(META_KEYS.schemaVersion, DOCUMENT_SCHEMA_VERSION);
    meta.set(META_KEYS.createdAt, options.now ?? Date.now());
    meta.set(META_KEYS.background, DEFAULT_BACKGROUND);

    const page = new Y.Map<unknown>();
    page.set('name', DEFAULT_PAGE_NAME);
    page.set('index', generateKeyBetween(null, null));
    doc.getMap(ROOT_KEYS.pages).set(pageId, page);
  }, options.origin ?? serverOrigin('init'));
  return { initialized: true, pageId };
}
