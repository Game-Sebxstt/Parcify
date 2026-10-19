import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { collectAssetRefs, remapDocumentAssets } from './remap-assets.js';

function node(doc: Y.Doc, id: string, props: Record<string, unknown>) {
  const map = new Y.Map<unknown>();
  doc.getMap(ROOT_KEYS.nodes).set(id, map);
  for (const [key, value] of Object.entries(props)) map.set(key, value);
}

describe('remapDocumentAssets', () => {
  it('cambia los assetId de las imágenes y deja el resto igual', () => {
    const a = randomUUID();
    const b = randomUUID();
    const unknown = randomUUID();
    const doc = new Y.Doc();
    node(doc, 'img1', { type: 'image', assetId: a, x: 10 });
    node(doc, 'img2', { type: 'image', assetId: b });
    node(doc, 'img3', { type: 'image', assetId: unknown });
    node(doc, 'rect', { type: 'rect', assetId: a });

    const a2 = randomUUID();
    const b2 = randomUUID();
    const result = remapDocumentAssets(Y.encodeStateAsUpdate(doc), new Map([[a, a2], [b, b2]]));

    const copy = new Y.Doc();
    Y.applyUpdate(copy, result.state);
    const nodes = copy.getMap(ROOT_KEYS.nodes);
    expect((nodes.get('img1') as Y.Map<unknown>).toJSON()).toEqual({ type: 'image', assetId: a2, x: 10 });
    expect((nodes.get('img2') as Y.Map<unknown>).get('assetId')).toBe(b2);
    expect((nodes.get('img3') as Y.Map<unknown>).get('assetId')).toBe(unknown);
    expect((nodes.get('rect') as Y.Map<unknown>).get('assetId')).toBe(a);
    expect(result.assetRefs.sort()).toEqual([a2, b2, unknown].sort());
    expect(collectAssetRefs(copy).sort()).toEqual(result.assetRefs.sort());
  });
});
