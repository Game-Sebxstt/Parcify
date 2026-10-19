import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { DEFERRED_STYLE_MS } from '../../commands/Commands.ts';
import { makeCore, newDoc, nodeMap, pointer, putNode, rect } from '../../test-utils.ts';
import { TextModel } from '../../text/TextModel.ts';

describe('historial', () => {
  it('deshacer agrupa una acción completa y restaura la selección', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ x: 100, y: 100 }));
    const b = putNode(doc, rect({ x: 300, y: 100, index: 'a1' }));
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([a, b]);
    core.commands.commitTransform([a, b], [1, 0, 0, 1, 10, 10]);
    core.setSelection([]);
    core.commands.undo();
    expect(nodeMap(doc, a).get('x')).toBe(100);
    expect(nodeMap(doc, b).get('x')).toBe(300);
    expect(core.selection.get()).toEqual([a, b]);
    core.commands.redo();
    expect(nodeMap(doc, a).get('x')).toBe(110);
    expect(nodeMap(doc, b).get('x')).toBe(310);
  });

  it('dos comandos seguidos son dos pasos aunque caigan dentro del captureTimeout', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([id]);
    core.commands.nudge(1, 0);
    core.commands.nudge(1, 0);
    core.commands.undo();
    expect(nodeMap(doc, id).get('x')).toBe(1);
  });

  it('solo deshace lo propio: los cambios remotos se conservan', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([id]);
    core.commands.nudge(5, 0);
    doc.transact(() => nodeMap(doc, id).set('y', 77), 'provider');
    core.commands.undo();
    expect(nodeMap(doc, id).get('x')).toBe(0);
    expect(nodeMap(doc, id).get('y')).toBe(77);
  });

  it('crear y deshacer quita el nodo y la selección', () => {
    const { core, tick, doc } = makeCore();
    core.commands.setTool('rect');
    core.controller.pointerDown(pointer(100, 100));
    core.controller.pointerUp(pointer(100, 100));
    tick();
    expect(core.selection.get()).toHaveLength(1);
    core.commands.undo();
    tick();
    expect(doc.getMap(ROOT_KEYS.nodes).size).toBe(0);
    expect(core.selection.get()).toEqual([]);
  });
});

describe('historial con sesiones de texto', () => {
  const textOf = (doc: Y.Doc, id: string) => (doc.getMap(ROOT_KEYS.texts).get(id) as Y.Text | undefined)?.toString();

  it('rehacer una creación devuelve la selección de después', () => {
    const { core, doc } = makeCore();
    const id = core.commands.createShape('rect', { x: 0, y: 0, w: 40, h: 40 })!;
    expect(core.selection.get()).toEqual([id]);
    core.commands.undo();
    expect(core.selection.get()).toEqual([]);
    core.commands.redo();
    expect(doc.getMap(ROOT_KEYS.nodes).has(id)).toBe(true);
    expect(core.selection.get()).toEqual([id]);
  });

  it('crear un texto, escribir y deshacer quita solo lo escrito', () => {
    const { core, doc } = makeCore();
    const id = core.commands.createText({ x: 0, y: 0 })!;
    const model = new TextModel(core.writer, core.store, id);
    model.apply({ start: 0, end: 0, insert: 'Hola' });
    expect(textOf(doc, id)).toBe('Hola');
    core.commands.undo();
    expect(textOf(doc, id)).toBe('');
    expect(doc.getMap(ROOT_KEYS.nodes).has(id)).toBe(true);
    model.close();
  });

  it('mover un texto y escribir antes de 400 ms son dos pasos', () => {
    const doc = newDoc();
    const { core } = makeCore(doc);
    const id = core.commands.createText({ x: 0, y: 0 })!;
    core.commands.select([id]);
    core.commands.nudge(10, 0);
    const model = new TextModel(core.writer, core.store, id);
    model.apply({ start: 0, end: 0, insert: 'Hola' });
    core.commands.undo();
    expect(textOf(doc, id)).toBe('');
    expect(nodeMap(doc, id).get('x')).toBe(10);
    model.close();
  });
});

describe('estilo con escritura diferida', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('el deslizador solo escribe tras 250 ms quieto, en una transacción', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { core, tick, sink } = makeCore(doc);
    tick();
    core.setSelection([id]);
    let writes = 0;
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.changed.size) writes++;
    });
    for (const opacity of [0.9, 0.8, 0.7, 0.6]) {
      core.commands.previewStyle({ opacity });
      vi.advanceTimersByTime(50);
      tick();
    }
    expect(writes).toBe(0);
    expect(sink.overrides.get(id)?.record.opacity).toBe(0.6);
    vi.advanceTimersByTime(DEFERRED_STYLE_MS);
    expect(writes).toBe(1);
    expect(nodeMap(doc, id).get('opacity')).toBe(0.6);
    core.commands.undo();
    expect(nodeMap(doc, id).get('opacity')).toBe(1);
  });

  it('commitStyle escribe al soltar y descarta valores inválidos', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ w: 40, h: 40 }));
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([id]);
    core.commands.previewStyle({ cornerRadius: 500 });
    core.commands.commitStyle();
    expect(nodeMap(doc, id).get('cornerRadius')).toBe(20);
    core.commands.setStyle({ strokeWidth: 9999 });
    expect(nodeMap(doc, id).get('strokeWidth')).toBe(1);
    core.commands.setStyle({ strokeDash: 'dotted', stroke: '#00FF00FF' });
    expect(nodeMap(doc, id).toJSON()).toMatchObject({ strokeDash: 'dotted', stroke: '#00FF00FF' });
  });
});
