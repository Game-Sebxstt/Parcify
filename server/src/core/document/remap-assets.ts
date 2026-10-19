import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';

function imageNodes(doc: Y.Doc): Array<Y.Map<unknown>> {
  const nodes: Array<Y.Map<unknown>> = [];
  doc.getMap(ROOT_KEYS.nodes).forEach((value) => {
    if (value instanceof Y.Map && value.get('type') === 'image') nodes.push(value as Y.Map<unknown>);
  });
  return nodes;
}

export function collectAssetRefs(doc: Y.Doc): string[] {
  const refs = new Set<string>();
  for (const node of imageNodes(doc)) {
    const assetId = node.get('assetId');
    if (typeof assetId === 'string') refs.add(assetId);
  }
  return [...refs];
}

export function remapAssetIds(doc: Y.Doc, remap: ReadonlyMap<string, string>): void {
  doc.transact(() => {
    for (const node of imageNodes(doc)) {
      const assetId = node.get('assetId');
      const next = typeof assetId === 'string' ? remap.get(assetId) : undefined;
      if (next) node.set('assetId', next);
    }
  });
}

// Aplica el estado en un Y.Doc temporal, cambia los assetId según el mapa y devuelve el estado nuevo.
export function remapDocumentAssets(
  state: Uint8Array,
  remap: ReadonlyMap<string, string>,
): { state: Uint8Array; assetRefs: string[] } {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    remapAssetIds(doc, remap);
    return { state: Y.encodeStateAsUpdate(doc), assetRefs: collectAssetRefs(doc) };
  } finally {
    doc.destroy();
  }
}
