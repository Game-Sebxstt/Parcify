import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { LOCAL_ORIGIN } from '../origins.ts';
import { frame, makeCore, newDoc, nodeMap, pointer, putNode, rect } from '../test-utils.ts';
import { applyWheel } from './dom.ts';

function countLocalTransactions(doc: Y.Doc) {
  let count = 0;
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN && tr.changed.size > 0) count++;
  });
  return () => count;
}

describe('máquina de estados del puntero', () => {
  it('clic selecciona, clic en vacío deselecciona y Shift suma', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ x: 100, y: 100 }));
    const b = putNode(doc, rect({ x: 300, y: 100, index: 'a1' }));
    const { core, tick } = makeCore(doc);
    tick();
    const c = core.controller;
    c.pointerDown(pointer(150, 120));
    expect(c.state).toBe('pressing');
    c.pointerUp(pointer(150, 120));
    expect(c.state).toBe('idle');
    expect(core.selection.get()).toEqual([a]);
    c.pointerDown(pointer(350, 120, { shift: true }));
    c.pointerUp(pointer(350, 120, { shift: true }));
    expect(core.selection.get()).toEqual([a, b]);
    c.pointerDown(pointer(800, 700));
    c.pointerUp(pointer(800, 700));
    expect(core.selection.get()).toEqual([]);
  });

  it('un arrastre no escribe por frame y produce una sola transacción al soltar', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ x: 100, y: 100 }));
    const { core, tick, sink } = makeCore(doc);
    tick();
    const transactions = countLocalTransactions(doc);
    const c = core.controller;
    c.pointerDown(pointer(150, 120));
    for (let i = 1; i <= 30; i++) {
      c.pointerMove(pointer(150 + i * 5, 120 + i * 2, { ctrl: true }));
      tick();
      if (i > 1) expect(c.state).toBe('dragging');
    }
    expect(transactions()).toBe(0);
    expect(nodeMap(doc, id).get('x')).toBe(100);
    expect(sink.overrides.has(id)).toBe(true);
    c.pointerUp(pointer(300, 180, { ctrl: true }));
    tick();
    expect(transactions()).toBe(1);
    expect(nodeMap(doc, id).get('x')).toBe(250);
    expect(nodeMap(doc, id).get('y')).toBe(160);
    expect(sink.overrides.has(id)).toBe(false);
  });

  it('el arrastre ajusta a los bordes de otros nodos y Ctrl lo desactiva', () => {
    const doc = newDoc();
    const moving = putNode(doc, rect({ x: 0, y: 300, w: 50, h: 50 }));
    putNode(doc, rect({ x: 200, y: 0, w: 50, h: 50, index: 'a1' }));
    const { core, tick } = makeCore(doc);
    tick();
    const c = core.controller;
    c.pointerDown(pointer(25, 325));
    c.pointerMove(pointer(222, 325));
    tick();
    c.pointerUp(pointer(222, 325));
    expect(nodeMap(doc, moving).get('x')).toBe(200);
    expect(core.snapGuides).toEqual([]);
  });

  it('dentro de un frame, el hueco de la selección arrastra la selección y no el frame', () => {
    const doc = newDoc();
    const f = putNode(doc, frame({ x: 0, y: 0, w: 600, h: 400 }));
    const a = putNode(doc, rect({ parentId: f, x: 50, y: 100, w: 100, h: 50 }));
    const b = putNode(doc, rect({ parentId: f, x: 300, y: 100, w: 100, h: 50, index: 'a1' }));
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([a, b]);
    const c = core.controller;
    c.pointerDown(pointer(225, 125));
    c.pointerMove(pointer(262, 148));
    tick();
    expect(c.state).toBe('dragging');
    c.pointerUp(pointer(262, 148));
    tick();
    expect(core.selection.get()).toEqual([a, b]);
    expect(nodeMap(doc, a).get('x')).toBe(87);
    expect(nodeMap(doc, b).get('x')).toBe(337);
    expect(nodeMap(doc, a).get('y')).toBe(123);
    expect(nodeMap(doc, f).get('x')).toBe(0);
    expect(nodeMap(doc, a).get('parentId')).toBe(f);

    c.pointerDown(pointer(262, 148));
    c.pointerUp(pointer(262, 148));
    expect(core.selection.get()).toEqual([]);
  });

  it('el marquee selecciona lo que toca, sin los bloqueados', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ x: 100, y: 100 }));
    const locked = putNode(doc, rect({ x: 300, y: 100, locked: true, index: 'a1' }));
    putNode(doc, rect({ x: 700, y: 600, index: 'a2' }));
    const { core, tick } = makeCore(doc);
    tick();
    const c = core.controller;
    c.pointerDown(pointer(50, 50));
    c.pointerMove(pointer(420, 200));
    tick();
    expect(c.state).toBe('marquee');
    expect(core.marquee).not.toBeNull();
    c.pointerUp(pointer(420, 200));
    expect(core.selection.get()).toEqual([a]);
    expect(core.selection.get()).not.toContain(locked);
    expect(core.marquee).toBeNull();
  });

  it('un nodo bloqueado no se selecciona con clic salvo con Alt', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ x: 100, y: 100, locked: true }));
    const { core, tick } = makeCore(doc);
    tick();
    core.controller.pointerDown(pointer(150, 120));
    core.controller.pointerUp(pointer(150, 120));
    expect(core.selection.get()).toEqual([]);
    core.controller.pointerDown(pointer(150, 120, { alt: true }));
    core.controller.pointerUp(pointer(150, 120, { alt: true }));
    expect(core.selection.get()).toEqual([id]);
  });

  it('la herramienta de forma crea con un arrastre y vuelve a seleccionar', () => {
    const { core, tick, doc } = makeCore();
    core.commands.setTool('ellipse');
    const c = core.controller;
    c.pointerDown(pointer(100, 100));
    c.pointerMove(pointer(200, 160));
    tick();
    expect(c.state).toBe('creating');
    expect(core.creating?.type).toBe('ellipse');
    c.pointerUp(pointer(200, 160));
    const nodes = doc.getMap(ROOT_KEYS.nodes);
    expect(nodes.size).toBe(1);
    const created = [...nodes.values()][0] as Y.Map<unknown>;
    expect(created.toJSON()).toMatchObject({ type: 'ellipse', x: 100, y: 100, w: 100, h: 60 });
    expect(core.tool.get()).toBe('select');
    expect(core.selection.get()).toEqual([created.get('id')]);
  });

  it('redimensionar por la esquina con Shift mantiene la proporción', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ x: 100, y: 100, w: 100, h: 50 }));
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([id]);
    tick();
    const c = core.controller;
    c.pointerDown(pointer(200, 150));
    expect(c.state).toBe('pressing');
    c.pointerMove(pointer(300, 160, { shift: true }));
    tick();
    expect(c.state).toBe('resizing');
    c.pointerUp(pointer(300, 160, { shift: true }));
    expect(nodeMap(doc, id).toJSON()).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
  });

  it('girar con Shift ajusta a pasos de 15°', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ x: 100, y: 100, w: 100, h: 100 }));
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([id]);
    tick();
    const c = core.controller;
    c.pointerDown(pointer(212, 212));
    c.pointerMove(pointer(150, 230, { shift: true }));
    tick();
    expect(c.state).toBe('rotating');
    c.pointerUp(pointer(150, 230, { shift: true }));
    const angle = nodeMap(doc, id).get('rotation') as number;
    expect(Math.abs(angle / (Math.PI / 12) - Math.round(angle / (Math.PI / 12)))).toBeLessThan(1e-9);
    expect(angle).not.toBe(0);
  });

  it('la mano y la rueda mueven la cámara sin tocar el documento', () => {
    const { core, tick } = makeCore();
    core.commands.setTool('hand');
    core.controller.pointerDown(pointer(100, 100));
    core.controller.pointerMove(pointer(150, 130));
    tick();
    expect(core.camera.x).toBe(-50);
    core.controller.pointerUp(pointer(150, 130));
    applyWheel(core, { kind: 'zoom', factor: 1.1, x: 0, y: 0 });
    expect(core.camera.zoom).toBeGreaterThan(1);
  });

  it('con la herramienta bloqueada, un clic sin arrastre crea y la herramienta sigue activa', () => {
    const doc = newDoc();
    const { core, tick } = makeCore(doc);
    tick();
    core.commands.setTool('rect', { locked: true });
    core.controller.pointerDown(pointer(200, 200));
    core.controller.pointerUp(pointer(200, 200));
    tick();
    expect(doc.getMap(ROOT_KEYS.nodes).size).toBe(1);
    expect(core.tool.get()).toBe('rect');
    expect(core.toolLocked.get()).toBe(true);
    core.commands.setTool('ellipse');
    core.controller.pointerDown(pointer(400, 200));
    core.controller.pointerUp(pointer(400, 200));
    tick();
    expect(doc.getMap(ROOT_KEYS.nodes).size).toBe(2);
    expect(core.tool.get()).toBe('select');
  });

  it('en solo lectura no se crean ni se mueven nodos', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ x: 100, y: 100 }));
    const { core, tick } = makeCore(doc, { readOnly: true });
    tick();
    core.commands.setTool('rect');
    expect(core.tool.get()).toBe('select');
    core.controller.pointerDown(pointer(150, 120));
    core.controller.pointerMove(pointer(250, 120));
    tick();
    core.controller.pointerUp(pointer(250, 120));
    expect(core.selection.get()).toEqual([id]);
    expect(nodeMap(doc, id).get('x')).toBe(100);
    expect(core.controller.keyDown({ key: 'Delete', code: 'Delete', ctrl: false, shift: false, alt: false, repeat: false })).toBe(true);
    expect(doc.getMap(ROOT_KEYS.nodes).size).toBe(1);
  });
});

describe('atajos', () => {
  const key = (k: string, code: string, mods: Partial<{ ctrl: boolean; shift: boolean }> = {}) => ({ key: k, code, ctrl: false, shift: false, alt: false, repeat: false, ...mods });

  it('herramientas, borrar, duplicar y flechas', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ x: 10, y: 10 }));
    const { core, tick } = makeCore(doc);
    tick();
    const c = core.controller;
    c.keyDown(key('r', 'KeyR'));
    expect(core.tool.get()).toBe('rect');
    c.keyDown(key('L', 'KeyL', { shift: true }));
    expect(core.tool.get()).toBe('arrow');
    c.keyDown(key('v', 'KeyV'));
    core.setSelection([id]);
    c.keyDown(key('ArrowRight', 'ArrowRight', { shift: true }));
    expect(nodeMap(doc, id).get('x')).toBe(20);
    c.keyDown(key('d', 'KeyD', { ctrl: true }));
    tick();
    expect(doc.getMap(ROOT_KEYS.nodes).size).toBe(2);
    c.keyDown(key('Delete', 'Delete'));
    tick();
    expect(doc.getMap(ROOT_KEYS.nodes).size).toBe(1);
    c.keyDown(key('z', 'KeyZ', { ctrl: true }));
    tick();
    expect(doc.getMap(ROOT_KEYS.nodes).size).toBe(2);
  });

  it('Ctrl+\\ oculta la interfaz y Ctrl+Shift+\\ la minimiza, también con AltGr del teclado español', () => {
    const { core } = makeCore(newDoc(), { readOnly: true });
    const c = core.controller;
    expect(c.keyDown(key('\\', 'Backslash', { ctrl: true }))).toBe(true);
    expect(core.uiCommand.get()).toEqual({ name: 'hideUi', n: 1 });
    // AltGr+º: llegan Ctrl y Alt, y la tecla física no es la de «\».
    expect(c.keyDown({ ...key('\\', 'Backquote', { ctrl: true }), alt: true })).toBe(true);
    expect(core.uiCommand.get()).toEqual({ name: 'hideUi', n: 2 });
    expect(c.keyDown(key('|', 'Backslash', { ctrl: true, shift: true }))).toBe(true);
    expect(core.uiCommand.get()).toEqual({ name: 'minimizeUi', n: 3 });
    // La tecla «\» sin Ctrl no hace nada.
    expect(c.keyDown(key('\\', 'Backslash'))).toBe(false);
    expect(core.uiCommand.get()?.n).toBe(3);
  });

  it('orden z con Ctrl+] y Ctrl+Shift+[', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ index: 'a0' }));
    const b = putNode(doc, rect({ index: 'a1' }));
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([a]);
    core.controller.keyDown(key(']', 'BracketRight', { ctrl: true }));
    tick();
    expect((nodeMap(doc, a).get('index') as string) > (nodeMap(doc, b).get('index') as string)).toBe(true);
    core.controller.keyDown(key('{', 'BracketLeft', { ctrl: true, shift: true }));
    tick();
    expect((nodeMap(doc, a).get('index') as string) < (nodeMap(doc, b).get('index') as string)).toBe(true);
  });

  it('Ctrl++ del teclado español hace zoom sin reordenar, y Ctrl+− aleja', () => {
    const doc = newDoc();
    const a = putNode(doc, rect({ index: 'a0' }));
    const b = putNode(doc, rect({ index: 'a1' }));
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([a]);
    const start = core.camera.zoom;
    expect(core.controller.keyDown(key('+', 'BracketRight', { ctrl: true }))).toBe(true);
    tick();
    expect(core.camera.zoom).toBeGreaterThan(start);
    expect(nodeMap(doc, a).get('index')).toBe('a0');
    expect(nodeMap(doc, b).get('index')).toBe('a1');
    const zoomed = core.camera.zoom;
    core.controller.keyDown(key('-', 'Slash', { ctrl: true }));
    expect(core.camera.zoom).toBeLessThan(zoomed);
    core.controller.keyDown(key('=', 'Equal', { ctrl: true }));
    expect(core.camera.zoom).toBeCloseTo(zoomed);
    core.controller.keyDown(key('+', 'NumpadAdd', { ctrl: true }));
    expect(core.camera.zoom).toBeGreaterThan(zoomed);
  });

  it('bloquear con Ctrl+Shift+L y ocultar con el comando', () => {
    const doc = newDoc();
    const id = putNode(doc, rect());
    const { core, tick } = makeCore(doc);
    tick();
    core.setSelection([id]);
    core.controller.keyDown(key('L', 'KeyL', { ctrl: true, shift: true }));
    tick();
    expect(nodeMap(doc, id).get('locked')).toBe(true);
    core.commands.toggleHidden();
    expect(nodeMap(doc, id).get('visible')).toBe(false);
  });
});
