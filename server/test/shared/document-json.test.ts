import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { documentFromJson, InvalidDocumentError, readDocumentJson, referencedAssets } from '../../src/shared/document/from-json.js';
import { ROOT_KEYS } from '../../src/shared/document/keys.js';
import { documentToJson } from '../../src/shared/document/to-json.js';
import { documentJson, documentState, frameNode, imageNode, nodeId, PAGE_ID, rectNode, textNode } from '../fixtures/document.js';

const ASSET = '01890a5d-ac96-774b-bcce-b302099a8057';
const NEW_ASSET = '01890a5d-ac96-774b-bcce-b302099a8058';
const USER = 'importador';

function build(data: ReturnType<typeof documentJson>, assets: Record<string, string> = {}, limits?: { maxNodes?: number; maxPages?: number }) {
  return documentFromJson(readDocumentJson(JSON.parse(JSON.stringify(data))), {
    assetIds: new Map(Object.entries(assets)),
    userId: USER,
    now: 5,
    ...(limits ? { limits } : {}),
  });
}

function nodes(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(ROOT_KEYS.nodes) as Y.Map<Y.Map<unknown>>;
}

describe('document.json', () => {
  it('ida y vuelta: el mismo número de nodos, textos y referencias, con los assets remapeados', () => {
    const data = documentJson([rectNode(), textNode(), frameNode(), imageNode('img', ASSET)], {
      [nodeId('text')]: 'Hola',
      [nodeId('rect')]: 'Etiqueta',
    });
    const source = new Y.Doc();
    Y.applyUpdate(source, documentState(data));
    const json = documentToJson(source);
    expect(Object.keys(json.nodes)).toHaveLength(4);
    expect(json.texts[nodeId('text')]).toBe('Hola');
    expect(referencedAssets(json)).toEqual([ASSET]);

    const { doc, droppedNodes } = build(json, { [ASSET]: NEW_ASSET });
    expect(droppedNodes).toBe(0);
    expect(nodes(doc).size).toBe(4);
    expect(nodes(doc).get(nodeId('img'))!.get('assetId')).toBe(NEW_ASSET);
    expect(nodes(doc).get(nodeId('rect'))!.get('createdBy')).toBe(USER);
    expect((doc.getMap(ROOT_KEYS.texts).get(nodeId('text')) as Y.Text).toString()).toBe('Hola');
    expect(doc.getMap(ROOT_KEYS.meta).get('schemaVersion')).toBe(2);
  });

  it('al migrar un v1 conserva el fondo del documento', () => {
    const data = documentJson([rectNode()]);
    data.meta.background = '#FFFFFFFF';
    const { doc } = build(data);
    expect(doc.getMap(ROOT_KEYS.meta).get('background')).toBe('#FFFFFFFF');
    expect(doc.getMap(ROOT_KEYS.meta).get('schemaVersion')).toBe(2);
  });

  it('descarta y cuenta los nodos inválidos, de otra página o con un asset que no se importó', () => {
    const data = documentJson([
      rectNode('ok'),
      rectNode('bad', { fill: 'rojo' }),
      rectNode('otra', { pageId: nodeId('nopage') }),
      { ...rectNode('tipo'), type: 'script' },
      imageNode('img', ASSET),
    ]);
    data.nodes['corto'] = rectNode('corto');
    data.nodes[nodeId('nulo')] = null;
    const { doc, droppedNodes } = build(data);
    expect([...nodes(doc).keys()]).toEqual([nodeId('ok')]);
    expect(droppedNodes).toBe(6);
  });

  it('respeta el límite de nodos y de páginas', () => {
    const data = documentJson([rectNode('a'), rectNode('b'), rectNode('c')]);
    data.pages[nodeId('page2')] = { name: 'Dos', index: 'a1' };
    data.nodes[nodeId('d')] = rectNode('d', { pageId: nodeId('page2') });
    const { doc, droppedNodes } = build(data, {}, { maxNodes: 2, maxPages: 1 });
    expect(nodes(doc).size).toBeLessThanOrEqual(2);
    expect(doc.getMap(ROOT_KEYS.pages).size).toBe(1);
    expect(droppedNodes).toBe(4 - nodes(doc).size);
  });

  it('repara padres y conectores que apuntan a nodos descartados', () => {
    const connector = {
      ...rectNode('conn'),
      type: 'connector',
      from: { nodeId: nodeId('gone'), anchor: 'center' },
      to: { x: 5, y: 5 },
      route: 'straight',
      startCap: 'none',
      endCap: 'arrow',
    };
    delete (connector as Record<string, unknown>).cornerRadius;
    const data = documentJson([rectNode('hijo', { parentId: nodeId('gone') }), connector, rectNode('gone', { fill: 'x' })]);
    const { doc, droppedNodes } = build(data);
    expect(droppedNodes).toBe(1);
    expect(nodes(doc).get(nodeId('hijo'))!.get('parentId')).toBeNull();
    expect(nodes(doc).get(nodeId('conn'))!.get('from')).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('los textos huérfanos, los de nodos sin texto y las claves especiales no pasan', () => {
    const data = documentJson([frameNode('f'), rectNode('r')], { [nodeId('f')]: 'x', [nodeId('nada')]: 'y', [nodeId('r')]: 'z' });
    const raw = JSON.parse(JSON.stringify(data)) as Record<string, Record<string, unknown>>;
    raw.nodes = JSON.parse(`{"__proto__": {"polluted": true}, ${JSON.stringify(raw.nodes).slice(1)}`);
    const { doc } = documentFromJson(readDocumentJson(raw), { assetIds: new Map(), userId: USER });
    expect([...doc.getMap(ROOT_KEYS.texts).keys()]).toEqual([nodeId('r')]);
    expect(nodes(doc).size).toBe(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('sin páginas válidas crea una página por defecto', () => {
    const data = documentJson([rectNode()]);
    data.pages = { [PAGE_ID]: { name: '', index: 'a0' } };
    const { doc, droppedNodes } = build(data);
    expect(doc.getMap(ROOT_KEYS.pages).size).toBe(1);
    expect(droppedNodes).toBe(1);
  });

  it('rechaza una forma general inválida o una versión de esquema más nueva', () => {
    expect(() => readDocumentJson([])).toThrow(InvalidDocumentError);
    expect(() => readDocumentJson({ meta: { schemaVersion: 1 }, pages: {} })).toThrow(InvalidDocumentError);
    expect(() => readDocumentJson({ meta: { schemaVersion: 99 }, pages: {}, nodes: {} })).toThrow(/schema_too_new/);
    expect(() => readDocumentJson({ meta: { schemaVersion: 0 }, pages: {}, nodes: {} })).toThrow(/schemaVersion/);
  });
});
