// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import type { EditorCore } from '../EditorCore.ts';
import { encodePosition } from '../doc/host/TextSession.ts';
import { LOCAL_ORIGIN } from '../origins.ts';
import { makeCore, newDoc, putNode, rect } from '../test-utils.ts';
import { TEXT_EDITOR_ATTR, TextEditor } from './TextEditor.ts';

beforeAll(() => {
  // jsdom no hace maquetación: sin rectángulos.
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
});

function setupOn(doc: Y.Doc) {
  const root = document.createElement('div');
  root.tabIndex = 0;
  document.body.append(root);
  const awareness = new Awareness(doc);
  const harness = makeCore(doc, { awareness });
  const editor = new TextEditor(harness.core, root, { label: 'Texto' });
  cleanup = () => {
    editor.destroy();
    harness.core.destroy();
    awareness.destroy();
  };
  return { ...harness, awareness, docA: doc, root, editor, element: () => root.querySelector<HTMLElement>(`[${TEXT_EDITOR_ATTR}]`) };
}

function setup(content = '') {
  const harness = setupOn(newDoc());
  const id = harness.core.commands.createText({ x: 10, y: 20 })!;
  if (content) harness.doc.transact(() => textType(harness.doc, id).insert(0, content), 'remote');
  harness.core.startTextEdit(id);
  return { ...harness, id };
}

const textType = (doc: Y.Doc, id: string) => doc.getMap(ROOT_KEYS.texts).get(id) as Y.Text;

// Otra persona edita el mismo texto: su Awareness lleva las posiciones codificadas.
function remoteEditing(core: EditorCore, awareness: Awareness, nodeId: string, anchor = '', head = '') {
  awareness.states.set(99, {
    user: { id: 'bea', name: 'Bea', color: '#5AA9FB', avatarAssetId: null },
    pageId: core.activePage,
    cursor: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [],
    selectionBox: null,
    marquee: null,
    gesture: null,
    editingText: { nodeId, anchor, head },
    chatTyping: false,
    aiBusy: false,
  });
  awareness.emit('change', [{ added: [99], updated: [], removed: [] }, 'remote']);
}

function type(element: HTMLElement, inputType: string, data: string | null = null) {
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}
describe('TextEditor', () => {
  it('pinta el contenido como texto, nunca como marcado', () => {
    const { element } = setup('<img src=x onerror=alert(1)>');
    const editable = element()!;
    expect(editable.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(editable.querySelector('img')).toBeNull();
    expect(editable.getAttribute('role')).toBe('textbox');
    expect(editable.getAttribute('aria-label')).toBe('Texto');
  });

  it('beforeinput escribe en el texto en una transacción local y conserva el caret', () => {
    const { doc, id, element, tick } = setup();
    const editable = element()!;
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: { origin: unknown }) => origins.push(transaction.origin));
    const event = type(editable, 'insertText', 'Hola');
    expect(event.defaultPrevented).toBe(true);
    type(editable, 'insertParagraph');
    type(editable, 'insertText', 'a');
    type(editable, 'deleteContentBackward');
    expect(textType(doc, id).toString()).toBe('Hola\n');
    expect(editable.textContent).toBe('Hola\n');
    tick();
    expect(editable.textContent).toBe('Hola\n');
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((origin) => origin === LOCAL_ORIGIN)).toBe(true);
    const selection = document.getSelection()!;
    expect(selection.focusOffset).toBe(5);
  });

  it('un cambio remoto se aplica al DOM con el caret en su sitio', () => {
    const { doc, id, element, tick } = setup('mundo');
    const editable = element()!;
    document.getSelection()!.setBaseAndExtent(editable.firstChild!, 2, editable.firstChild!, 2);
    document.dispatchEvent(new Event('selectionchange'));
    doc.transact(() => textType(doc, id).insert(0, 'Hola '), 'remote');
    tick();
    expect(editable.textContent).toBe('Hola mundo');
    expect(document.getSelection()!.focusOffset).toBe(7);
  });

  it('pinta el caret remoto de otra persona que edita el mismo texto', () => {
    const { core, doc, id, root, awareness, tick } = setup('Hola');
    const position = encodePosition(Y.createRelativePositionFromTypeIndex(textType(doc, id), 2));
    // jsdom no tiene maquetación: el rectángulo del editor sirve de referencia.
    const element = root.querySelector<HTMLElement>(`[${TEXT_EDITOR_ATTR}]`)!;
    element.getBoundingClientRect = () => ({ left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30, x: 10, y: 10, toJSON: () => ({}) });
    remoteEditing(core, awareness, id, position, position);
    tick();
    const caret = root.querySelector('[data-remote-caret]');
    expect(caret).not.toBeNull();
    expect(caret!.textContent).toBe('Bea');
  });

  it('un cambio remoto durante una composición no se pierde ni pisa lo compuesto', () => {
    const { doc, id, element, tick, root, core, awareness } = setup('Hola');
    const editable = element()!;
    const node = editable.firstChild as Text;
    editable.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    node.data = 'Hola´';
    doc.transact(() => textType(doc, id).insert(0, '>> '), 'remote');
    const position = encodePosition(Y.createRelativePositionFromTypeIndex(textType(doc, id), 0));
    remoteEditing(core, awareness, id, position, position);
    tick();
    expect(editable.textContent).toBe('Hola´');
    // Durante la composición tampoco se pintan los carets de los demás.
    expect(root.querySelector('[data-remote-caret]')).toBeNull();
    node.data = 'Holaá';
    editable.dispatchEvent(new CompositionEvent('compositionend', { data: 'á', bubbles: true }));
    expect(textType(doc, id).toString()).toBe('>> Holaá');
    tick();
    expect(editable.textContent).toBe('>> Holaá');
    expect(document.getSelection()!.focusOffset).toBe(8);
  });

  it('no borra el texto interior vacío que otra persona está editando', () => {
    const { core, doc, root, tick, awareness } = setupOn(newDoc());
    const id = putNode(doc, rect());
    tick();
    expect(core.startTextEdit(id)).toBe(true);
    remoteEditing(core, awareness, id);
    core.stopTextEdit();
    expect(doc.getMap(ROOT_KEYS.texts).get(id)).toBeInstanceOf(Y.Text);
    expect(root.querySelector(`[${TEXT_EDITOR_ATTR}]`)).toBeNull();
  });

  describe('con dos documentos', () => {
    function pair() {
      const docA = newDoc();
      const id = putNode(docA, rect());
      const docB = new Y.Doc();
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      const harness = setupOn(docA);
      const sync = () => {
        Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)), 'remote');
        Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)), 'remote');
        harness.tick();
      };
      return { ...harness, docB, id, sync, textsB: docB.getMap(ROOT_KEYS.texts) };
    }

    it('si otro cliente sustituye el texto en edición, lo escrito pasa al que queda', () => {
      const { core, docA, docB, id, sync, textsB, element } = pair();
      // B gana el conflicto del Y.Map.
      docB.clientID = docA.clientID + 1;
      core.startTextEdit(id);
      const mine = textType(docA, id);
      type(element()!, 'insertText', 'Ana');
      docB.transact(() => {
        const theirs = new Y.Text();
        textsB.set(id, theirs);
        theirs.insert(0, 'Bea ');
      });
      sync();
      const kept = textType(docA, id);
      expect(kept).not.toBe(mine);
      expect(kept.toString()).toBe('Bea Ana');
      expect(element()!.textContent).toBe('Bea Ana');
      type(element()!, 'insertText', '!');
      sync();
      expect((textsB.get(id) as Y.Text).toString()).toBe('Bea Ana!');
      expect(textType(docA, id).toString()).toBe('Bea Ana!');
      expect(core.store.text(id)).toBe('Bea Ana!');
    });

    it('si otro cliente borra el texto interior mientras se escribe, se conserva lo escrito', () => {
      const { core, docB, id, sync, textsB, element, docA } = pair();
      docB.transact(() => textsB.set(id, new Y.Text()));
      sync();
      core.startTextEdit(id);
      type(element()!, 'insertText', 'Hola');
      docB.transact(() => textsB.delete(id));
      sync();
      expect(textType(docA, id).toString()).toBe('Hola');
      expect(element()!.textContent).toBe('Hola');
      type(element()!, 'insertText', '!');
      sync();
      expect((textsB.get(id) as Y.Text).toString()).toBe('Hola!');
    });
  });

  it('Escape confirma y devuelve el foco al lienzo', () => {
    const { core, root, element } = setup('Hola');
    const editable = element()!;
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(core.editingText.get()).toBeNull();
    expect(root.querySelector(`[${TEXT_EDITOR_ATTR}]`)).toBeNull();
    expect(document.activeElement).toBe(root);
  });
});
