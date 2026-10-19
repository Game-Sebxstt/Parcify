import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { makeCore, nodeMap, pointer, putNode, rect } from '../test-utils.ts';
import { diffText, editFor } from './binding.ts';
import { cappedResolution, layoutOf, textResolution } from './layout.ts';

describe('editFor y diffText', () => {
  it('traduce los beforeinput de texto plano', () => {
    expect(editFor('insertText', 'a', 1, 1, 'xy')).toEqual({ start: 1, end: 1, insert: 'a' });
    expect(editFor('insertParagraph', null, 2, 2, 'xy')).toEqual({ start: 2, end: 2, insert: '\n' });
    expect(editFor('insertFromPaste', 'a\r\nb', 0, 2, 'xy')).toEqual({ start: 0, end: 2, insert: 'a\nb' });
    expect(editFor('deleteContentBackward', null, 2, 2, 'xy')).toEqual({ start: 1, end: 2, insert: '' });
    expect(editFor('deleteContentBackward', null, 2, 2, 'a😀')).toEqual({ start: 1, end: 2, insert: '' });
    expect(editFor('deleteContentBackward', null, 3, 3, 'a😀')).toEqual({ start: 1, end: 3, insert: '' });
    expect(editFor('deleteContentForward', null, 0, 0, 'xy')).toEqual({ start: 0, end: 1, insert: '' });
    expect(editFor('deleteWordBackward', null, 9, 9, 'hola mundo')).toEqual({ start: 5, end: 9, insert: '' });
    expect(editFor('formatBold', null, 0, 1, 'xy')).toBeNull();
  });

  it('calcula la sustitución mínima', () => {
    expect(diffText('hola', 'hola')).toBeNull();
    expect(diffText('hola', 'hoXla')).toEqual({ start: 2, end: 2, insert: 'X' });
    expect(diffText('hola mundo', 'hola')).toEqual({ start: 4, end: 10, insert: '' });
  });
});

describe('resolución y maquetación del texto', () => {
  it('sigue al zoom entre 1 y 4, con el tope de 4096 px por lado', () => {
    expect(textResolution(0.1, 1)).toBe(1);
    expect(textResolution(2, 1.25)).toBe(2.5);
    expect(textResolution(10, 2)).toBe(4);
    expect(cappedResolution(4, 2000, 100)).toBe(2.048);
    expect(cappedResolution(2, 500, 100)).toBe(2);
  });

  it('el texto interior de una forma usa las propiedades label* y su caja', () => {
    const shape = { ...rect({ w: 200, h: 100, labelVAlign: 'bottom' }) } as never;
    const layout = layoutOf(shape, 'Hola')!;
    expect(layout).toMatchObject({ size: 16, align: 'center', vAlign: 'bottom', wrapWidth: 184 });
    expect(layoutOf(shape, '')).toBeNull();
  });
});

describe('edición de texto en el motor', () => {
  it('la herramienta T crea un texto, abre el editor y, si sale vacío, se borra', () => {
    const { core, sink, tick, doc } = makeCore();
    core.commands.setTool('text');
    core.controller.pointerDown(pointer(100, 100));
    core.controller.pointerUp(pointer(100, 100));
    const editing = core.editingText.get();
    expect(editing?.kind).toBe('text');
    const record = core.record(editing!.id);
    expect(record).toMatchObject({ type: 'text', fontFamily: 'Manrope', autoWidth: true });
    expect(core.tool.get()).toBe('select');
    tick();
    expect(sink.editing).toBe(editing!.id);
    core.stopTextEdit();
    tick();
    expect(core.record(editing!.id)).toBeUndefined();
    expect(doc.getMap(ROOT_KEYS.texts).has(editing!.id)).toBe(false);
    expect(sink.editing).toBeNull();
  });

  it('un texto con contenido se conserva y lo pintado incluye el contenido', () => {
    const { core, sink, tick, doc } = makeCore();
    const id = core.commands.createText({ x: 0, y: 0 })!;
    expect(core.startTextEdit(id)).toBe(true);
    (doc.getMap(ROOT_KEYS.texts).get(id) as Y.Text).insert(0, '<img src=x onerror=alert(1)>');
    core.stopTextEdit();
    tick();
    expect(core.record(id)?.type).toBe('text');
    expect(sink.texts.get(id)).toBe('<img src=x onerror=alert(1)>');
  });

  it('doble clic en una forma abre su texto interior; vacío, solo se quita el texto', () => {
    const { core, doc, tick } = makeCore();
    const id = putNode(doc, rect({ x: 0, y: 0, w: 200, h: 100 }));
    tick();
    for (let i = 0; i < 2; i++) {
      core.controller.pointerDown(pointer(50, 50));
      core.controller.pointerUp(pointer(50, 50));
    }
    expect(core.editingText.get()).toEqual({ id, kind: 'label' });
    expect(doc.getMap(ROOT_KEYS.texts).get(id)).toBeInstanceOf(Y.Text);
    core.stopTextEdit();
    expect(doc.getMap(ROOT_KEYS.texts).has(id)).toBe(false);
    expect(core.record(id)).toBeDefined();
  });

  it('un nodo bloqueado o en solo lectura no se edita, y bloquearlo cierra el editor', () => {
    const { core, doc, tick } = makeCore();
    const id = core.commands.createText({ x: 0, y: 0 })!;
    core.startTextEdit(id);
    nodeMap(doc, id).set('locked', true);
    tick();
    expect(core.editingText.get()).toBeNull();
    expect(core.startTextEdit(id)).toBe(false);
    const other = putNode(doc, rect());
    core.setReadOnly(true);
    expect(core.startTextEdit(other)).toBe(false);
  });

  it('borrar un texto borra también su contenido', () => {
    const { core, doc } = makeCore();
    const id = core.commands.createText({ x: 0, y: 0 })!;
    (doc.getMap(ROOT_KEYS.texts).get(id) as Y.Text).insert(0, 'Hola');
    core.commands.select([id]);
    core.commands.deleteSelection();
    expect(doc.getMap(ROOT_KEYS.texts).has(id)).toBe(false);
  });

  it('las propiedades de tipografía se validan con el esquema', () => {
    const { core } = makeCore();
    const id = core.commands.createText({ x: 0, y: 0 })!;
    core.commands.setStyle({ fontFamily: 'Lora', fontSize: 48, italic: true, align: 'center' }, [id]);
    expect(core.record(id)).toMatchObject({ fontFamily: 'Lora', fontSize: 48, italic: true, align: 'center' });
    core.commands.setStyle({ fontSize: 2 }, [id]);
    expect(core.record(id)).toMatchObject({ fontSize: 48 });
  });
});
