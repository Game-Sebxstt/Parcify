import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { connectorNode, newDoc, PAGE_ID, putNode, rect } from '../test-utils.ts';
import type { ConnectorRecord } from '../types.ts';
import { THUMB_HEIGHT, THUMB_WIDTH, thumbnailFrame, versionScene } from './thumbnail.ts';

describe('versionScene', () => {
  it('trae los recorridos de los conectores sin ejecutar ningún frame', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ x: 0, y: 0, w: 100, h: 50 }));
    const b = putNode(doc, rect({ x: 300, y: 200, w: 100, h: 50, index: 'a1' }));
    const c = putNode(doc, connectorNode({ nodeId: a, anchor: 'right' }, { nodeId: b, anchor: 'left' }));
    const scene = versionScene(Y.encodeStateAsUpdate(doc));
    expect(scene?.items.map((item) => item.id)).toEqual([a, b, c]);
    const connector = scene?.items.find((item) => item.id === c)?.record as ConnectorRecord;
    expect(connector.path).toEqual([100, 25, 300, 225]);
    expect(scene?.bounds).toMatchObject({ x: 0, y: 0, w: 400, h: 250 });
  });

  it('usa la primera página si la pedida no existe y devuelve null si no pinta nada', () => {
    const doc = newDoc();
    expect(versionScene(Y.encodeStateAsUpdate(doc), PAGE_ID)).toBeNull();
    putNode(doc, rect({ x: 10, y: 20 }));
    expect(versionScene(Y.encodeStateAsUpdate(doc), 'PAGE_NO_EXISTE')?.items).toHaveLength(1);
  });

  it('lleva el fondo del documento', () => {
    const doc = newDoc();
    putNode(doc, rect());
    doc.getMap('meta').set('background', '#203040FF');
    expect(versionScene(Y.encodeStateAsUpdate(doc))?.background).toBe('#203040FF');
  });
});

describe('thumbnailFrame', () => {
  it('centra el contenido y llena exactamente la miniatura', () => {
    const { bounds, scale } = thumbnailFrame({ x: 1000, y: 2000, w: 1200, h: 300 }, THUMB_WIDTH, THUMB_HEIGHT);
    expect(scale).toBeCloseTo(120 / 1200, 9);
    expect(bounds.w * scale).toBeCloseTo(THUMB_WIDTH, 9);
    expect(bounds.h * scale).toBeCloseTo(THUMB_HEIGHT, 9);
    expect(bounds.x + bounds.w / 2).toBeCloseTo(1600, 9);
    expect(bounds.y + bounds.h / 2).toBeCloseTo(2150, 9);
  });

  it('no amplía el contenido pequeño por encima del 100 %', () => {
    const { bounds, scale } = thumbnailFrame({ x: 0, y: 0, w: 20, h: 10 }, THUMB_WIDTH, THUMB_HEIGHT);
    expect(scale).toBe(1);
    expect(bounds).toEqual({ x: -54, y: -35, w: 128, h: 80 });
  });
});
