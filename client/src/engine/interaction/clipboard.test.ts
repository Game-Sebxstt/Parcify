import { describe, expect, it, vi } from 'vitest';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { connectorNode, group, makeCore, newDoc, nodeId, PAGE_ID, putNode, rect } from '../test-utils.ts';
import type { NodeRecord } from '../types.ts';
import {
  assetIdsOf,
  CLIPBOARD_PREFIX,
  CLIPBOARD_SUFFIX,
  ClipboardController,
  looksLikeSvg,
  parseClipboard,
  plainTextOf,
  readTransfer,
  remapAssets,
  serializeClipboard,
} from './clipboard.ts';

const ASSET_A = '0199a1b2-0000-7000-8000-00000000000a';
const ASSET_B = '0199a1b2-0000-7000-8000-00000000000b';

function image(assetId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: nodeId(),
    type: 'image',
    pageId: PAGE_ID,
    parentId: null,
    index: 'a3',
    x: 10,
    y: 20,
    w: 200,
    h: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy: 'user-a',
    assetId,
    fit: 'fill',
    cornerRadius: 0,
    ...overrides,
  };
}

function text(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: nodeId(),
    type: 'text',
    pageId: PAGE_ID,
    parentId: null,
    index: 'a4',
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy: 'user-a',
    fontFamily: 'Manrope',
    fontSize: 24,
    fontWeight: 400,
    italic: false,
    underline: false,
    strike: false,
    color: '#EEF2F6FF',
    align: 'left',
    lineHeight: 1.25,
    autoWidth: true,
    ...overrides,
  };
}

const transfer = (data: Record<string, string>, files: File[] = []) => ({ getData: (type: string) => data[type] ?? '', files });

describe('formato del portapapeles', () => {
  it('serializa y vuelve a leer nodos, textos y origen', () => {
    const node = text() as unknown as NodeRecord;
    const html = serializeClipboard({ source: { projectId: 'p1', workspace: 'ana' }, nodes: [node], texts: { [node.id]: 'Hola' } });
    expect(html.startsWith(CLIPBOARD_PREFIX) && html.endsWith(CLIPBOARD_SUFFIX)).toBe(true);
    expect(parseClipboard(`<meta charset="utf-8">${html}<b>ruido</b>`)).toEqual({
      source: { projectId: 'p1', workspace: 'ana' },
      nodes: [node],
      texts: { [node.id]: 'Hola' },
    });
  });

  it('escapa lo que cerraría el comentario o abriría marcado, y el contenido vuelve intacto', () => {
    const node = text() as unknown as NodeRecord;
    const evil = '--><img src=x onerror="alert(1)"><!-- & </script>';
    const html = serializeClipboard({ source: null, nodes: [node], texts: { [node.id]: evil } });
    const body = html.slice(CLIPBOARD_PREFIX.length, -CLIPBOARD_SUFFIX.length);
    expect(body).not.toMatch(/[<>&]/);
    expect(html.indexOf(CLIPBOARD_SUFFIX)).toBe(html.length - CLIPBOARD_SUFFIX.length);
    expect(parseClipboard(html)?.texts[node.id]).toBe(evil);
  });

  it('descarta nodos que no validan, textos huérfanos y orígenes raros; sin bloque devuelve null', () => {
    const good = rect() as unknown as NodeRecord;
    const raw = JSON.stringify({
      v: 1,
      source: { projectId: '<script>', workspace: 'x' },
      nodes: [good, { id: 'mal', type: 'rect' }],
      texts: { [good.id]: 7, otro: 'suelto' },
    });
    expect(parseClipboard(`${CLIPBOARD_PREFIX}${raw}${CLIPBOARD_SUFFIX}`)).toEqual({ source: null, nodes: [good], texts: {} });
    expect(parseClipboard('<p>hola</p>')).toBeNull();
    expect(parseClipboard(`${CLIPBOARD_PREFIX}{roto${CLIPBOARD_SUFFIX}`)).toBeNull();
    expect(parseClipboard(`${CLIPBOARD_PREFIX}${JSON.stringify({ v: 2, nodes: [] })}${CLIPBOARD_SUFFIX}`)).toBeNull();
  });

  it('text/plain lleva el texto de los nodos y los assets se remapean', () => {
    const a = text() as unknown as NodeRecord;
    const b = rect() as unknown as NodeRecord;
    const c = image(ASSET_A) as unknown as NodeRecord;
    const d = image(ASSET_A) as unknown as NodeRecord;
    expect(plainTextOf({ nodes: [a, b, c], texts: { [a.id]: 'uno', [b.id]: 'dos' } })).toBe('uno\ndos');
    expect(assetIdsOf([a, c, d])).toEqual([ASSET_A]);
    const remapped = remapAssets([c, b], { [ASSET_A]: ASSET_B });
    expect(remapped[0]).toMatchObject({ assetId: ASSET_B });
    expect(remapped[1]).toBe(b);
  });

  it('clasifica lo pegado: bloque, imágenes, SVG en texto y texto plano', () => {
    const node = rect() as unknown as NodeRecord;
    const html = serializeClipboard({ source: null, nodes: [node], texts: {} });
    expect(readTransfer(transfer({ 'text/html': html, 'text/plain': 'x' }))?.kind).toBe('nodes');
    const png = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    expect(readTransfer(transfer({ 'text/html': '<img src="a.png">' }, [png]))).toEqual({ kind: 'images', files: [png] });
    const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
    expect(looksLikeSvg(svg)).toBe(true);
    const pastedSvg = readTransfer(transfer({ 'text/plain': svg }));
    expect(pastedSvg?.kind).toBe('svg');
    expect(pastedSvg?.kind === 'svg' && pastedSvg.file.type).toBe('image/svg+xml');
    expect(readTransfer(transfer({ 'text/html': '<b onclick="x()">hola</b>', 'text/plain': 'hola\r\nadiós' }))).toEqual({ kind: 'text', text: 'hola\nadiós' });
    expect(looksLikeSvg('mira <svg> esto')).toBe(false);
    expect(looksLikeSvg('<!-- a --><!DOCTYPE svg>\n<svg></svg>')).toBe(true);
    expect(looksLikeSvg('<svgx></svg>')).toBe(false);
    expect(readTransfer(transfer({ 'text/plain': '   ' }))).toBeNull();
  });

  it('detecta un SVG en tiempo lineal aunque el texto repita comentarios', () => {
    const hostile = '<!--a-->'.repeat(50_000) + 'x</svg>';
    const started = performance.now();
    expect(looksLikeSvg(hostile)).toBe(false);
    expect(looksLikeSvg(`${'<!--a-->'.repeat(50_000)}<svg></svg>`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('pegar en el lienzo', () => {
  it('ids nuevos con las referencias internas remapeadas (grupo, hijos y conector)', () => {
    const doc = newDoc();
    const g = putNode(doc, group({ x: 100, y: 100 }));
    const a = putNode(doc, rect({ parentId: g, x: 0, y: 0 }));
    const b = putNode(doc, rect({ parentId: g, x: 200, y: 0, index: 'a1' }));
    const c = putNode(doc, connectorNode({ nodeId: a, anchor: 'right' }, { nodeId: b, anchor: 'left' }, { parentId: g }));
    const source = makeCore(doc);
    source.core.setSelection([g]);
    const html = source.core.commands.copySelection()!;

    const target = makeCore(newDoc());
    expect(target.core.commands.paste(html)).toBe(true);
    target.tick();
    const nodes = [...target.core.store.all()];
    expect(nodes).toHaveLength(4);
    const ids = new Set(nodes.map((node) => node.id));
    for (const old of [g, a, b, c]) expect(ids.has(old)).toBe(false);
    const pastedGroup = nodes.find((node) => node.type === 'group')!;
    const children = nodes.filter((node) => node.parentId === pastedGroup.id);
    expect(children).toHaveLength(3);
    const connector = nodes.find((node) => node.type === 'connector')!;
    expect(connector.type === 'connector' && [connector.from, connector.to].map((end) => ('nodeId' in end ? ids.has(end.nodeId) : false))).toEqual([true, true]);
    // De otro documento y a la vista: en el mismo sitio.
    expect(pastedGroup).toMatchObject({ x: 100, y: 100, parentId: null });
    expect(target.core.selection.get()).toEqual([pastedGroup.id]);
  });

  it('desde otro documento y fuera de la vista, lo pegado va al centro de la vista', () => {
    const node = rect({ x: 50_000, y: 50_000, w: 100, h: 50 }) as unknown as NodeRecord;
    const ctx = makeCore(newDoc());
    expect(ctx.core.commands.pasteNodes([node], {})).toBe(true);
    ctx.tick();
    const [pasted] = [...ctx.core.store.all()];
    const center = ctx.core.viewCenter();
    expect(pasted!.x + pasted!.w / 2).toBeCloseTo(center.x, 3);
    expect(pasted!.y + pasted!.h / 2).toBeCloseTo(center.y, 3);
  });

  it('el texto plano crea un nodo de texto con ese contenido, sin interpretarlo', () => {
    const ctx = makeCore(newDoc());
    const content = '<img src=x onerror="alert(1)">';
    const id = ctx.core.commands.pasteText(content, { x: 300, y: 200 })!;
    ctx.tick();
    expect(ctx.core.store.get(id)).toMatchObject({ type: 'text', autoWidth: true });
    expect(ctx.core.store.text(id)).toBe(content);
    const long = ctx.core.commands.pasteText('x'.repeat(200), { x: 0, y: 0 })!;
    ctx.tick();
    expect(ctx.core.store.get(long)).toMatchObject({ type: 'text', autoWidth: false, w: 480 });
  });

  it('copia las imágenes de otro proyecto con POST /v1/assets/copy y pega con los ids nuevos', async () => {
    const ctx = makeCore(newDoc());
    const copyAssets = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, ASSET_B])));
    const insertFiles = vi.fn();
    const controller = new ClipboardController(ctx.core, { source: { projectId: 'p2', workspace: 'bea' }, copyAssets, insertFiles });
    const node = image(ASSET_A) as unknown as NodeRecord;

    await controller.paste({ kind: 'nodes', payload: { source: { projectId: 'p1', workspace: 'ana' }, nodes: [node], texts: {} } });
    ctx.tick();
    expect(copyAssets).toHaveBeenCalledWith([ASSET_A]);
    expect([...ctx.core.store.all()].map((record) => record.type === 'image' && record.assetId)).toEqual([ASSET_B]);

    // Otro proyecto del mismo espacio también se copia: el asset solo lo ve quien ve su proyecto.
    await controller.paste({ kind: 'nodes', payload: { source: { projectId: 'p3', workspace: 'bea' }, nodes: [node], texts: {} } });
    expect(copyAssets).toHaveBeenCalledTimes(2);

    // Dentro del mismo proyecto no hace falta copiar.
    await controller.paste({ kind: 'nodes', payload: { source: { projectId: 'p2', workspace: 'bea' }, nodes: [node], texts: {} } });
    expect(copyAssets).toHaveBeenCalledTimes(2);

    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    await controller.paste({ kind: 'images', files: [file] }, { x: 5, y: 6 });
    expect(insertFiles).toHaveBeenCalledWith([file], { x: 5, y: 6 });
  });

  it('cortar con un vértice marcado borra la línea entera, por el menú y por Ctrl+X', async () => {
    const { cornerRadius: _r, ...base } = rect();
    const line = { ...base, type: 'line', fill: null, stroke: '#EEF2F6FF', strokeWidth: 2, x: 0, y: 0, w: 0, h: 0, startCap: 'none', endCap: 'none' };
    const points = [
      [100, 100],
      [200, 150],
      [300, 100],
    ];
    const doc = newDoc();
    const viaMenu = putNode(doc, { ...line, points });
    const viaKeys = putNode(doc, { ...line, id: nodeId(), index: 'a5', points });
    const ctx = makeCore(doc);
    const controller = new ClipboardController(ctx.core, { source: null });

    ctx.core.setSelection([viaMenu]);
    ctx.core.setActiveVertex({ id: viaMenu, index: 1 });
    expect(await controller.cut()).toBe(true);
    ctx.tick();
    expect(ctx.core.record(viaMenu)).toBeUndefined();

    ctx.core.setSelection([viaKeys]);
    ctx.core.setActiveVertex({ id: viaKeys, index: 1 });
    const data: Record<string, string> = {};
    expect(controller.cutTo({ setData: (type: string, value: string) => void (data[type] = value) } as unknown as DataTransfer)).toBe(true);
    ctx.tick();
    expect(ctx.core.record(viaKeys)).toBeUndefined();
    expect(parseClipboard(data['text/html']!)?.nodes.map((node) => node.id)).toEqual([viaKeys]);
    expect(ctx.core.activeVertex.get()).toBeNull();
  });

  it('en solo lectura no pega nada', async () => {
    const ctx = makeCore(newDoc(), { readOnly: true });
    const controller = new ClipboardController(ctx.core, { source: null });
    expect(await controller.paste({ kind: 'text', text: 'hola' })).toBe(false);
    expect(ctx.doc.getMap(ROOT_KEYS.nodes).size).toBe(0);
  });
});
