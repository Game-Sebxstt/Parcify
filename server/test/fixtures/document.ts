import * as Y from 'yjs';
import { ROOT_KEYS } from '../../src/shared/document/keys.js';
import type { DocumentJson } from '../../src/shared/document/to-json.js';

// Ids de nodo de 21 caracteres legibles en las pruebas.
export function nodeId(label: string): string {
  return `${label}${'_'.repeat(21)}`.slice(0, 21);
}

export const PAGE_ID = nodeId('page');

const style = { fill: '#FF7A59FF', stroke: null, strokeWidth: 0, strokeDash: 'solid', shadow: null };

export function baseNode(label: string, type: string, extra: Record<string, unknown> = {}) {
  return {
    id: nodeId(label),
    pageId: PAGE_ID,
    parentId: null,
    index: 'a0',
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy: 'autor-original',
    type,
    ...extra,
  };
}

export const rectNode = (label = 'rect', extra: Record<string, unknown> = {}) =>
  baseNode(label, 'rect', { ...style, cornerRadius: 4, ...extra });

export const textNode = (label = 'text') =>
  baseNode(label, 'text', {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    italic: false,
    underline: false,
    strike: false,
    color: '#0B1220FF',
    align: 'left',
    lineHeight: 1.2,
    autoWidth: true,
  });

export const imageNode = (label: string, assetId: string) =>
  baseNode(label, 'image', { assetId, fit: 'cover', cornerRadius: 0, alt: 'Una foto' });

export const frameNode = (label = 'frame') => baseNode(label, 'frame', { fill: null, clip: true });

export function documentJson(nodes: Array<Record<string, unknown>>, texts: Record<string, string> = {}): DocumentJson {
  return {
    meta: { schemaVersion: 1, createdAt: 1, background: '#141416FF' },
    pages: { [PAGE_ID]: { name: 'Página 1', index: 'a0' } },
    nodes: Object.fromEntries(nodes.map((node) => [node.id as string, node])),
    texts,
    animations: {},
  };
}

// Estado Yjs con la misma estructura que escribe el cliente.
export function documentState(data: DocumentJson): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [key, value] of Object.entries(data.meta)) doc.getMap(ROOT_KEYS.meta).set(key, value);
    for (const [root, entries] of [
      [ROOT_KEYS.pages, data.pages],
      [ROOT_KEYS.nodes, data.nodes],
    ] as const) {
      for (const [id, value] of Object.entries(entries)) {
        const map = new Y.Map<unknown>();
        doc.getMap(root).set(id, map);
        for (const [key, field] of Object.entries(value as Record<string, unknown>)) map.set(key, field);
      }
    }
    for (const [id, value] of Object.entries(data.texts)) doc.getMap(ROOT_KEYS.texts).set(id, new Y.Text(value));
  });
  const state = new Uint8Array(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
