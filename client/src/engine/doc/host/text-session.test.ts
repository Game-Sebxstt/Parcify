import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { DocumentStore } from '../../model/DocumentStore.ts';
import { newDoc, putNode, rect } from '../../test-utils.ts';
import { TextModel } from '../../text/TextModel.ts';
import type { DocumentBackend } from '../backend.ts';
import { DocWriter } from '../DocWriter.ts';
import type { DocBatch, MainToHost } from '../protocol.ts';
import { DocHost } from './DocHost.ts';
import { decodePosition } from './TextSession.ts';

const QUIET = { warn: () => {}, error: () => {}, debug: () => {} };

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Principal y host con un canal de mensajes que se entregan a mano (y se clonan, como entre hilos), y un par
// remoto cuyos updates también se entregan a mano.
function harness(initial = '') {
  const doc = newDoc();
  const id = putNode(doc, rect());
  doc.getMap(ROOT_KEYS.texts).set(id, new Y.Text(initial));
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const toPeer: Uint8Array[] = [];
  const fromPeer: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => origin !== 'peer' && toPeer.push(update));
  peer.on('update', (update: Uint8Array, origin: unknown) => origin !== 'doc' && fromPeer.push(update));
  const awareness = new Awareness(doc);
  const host = new DocHost(doc, awareness, { logger: QUIET });
  const toHost: MainToHost[] = [];
  const toMain: DocBatch[] = [];
  const backend = { send: (message: MainToHost) => toHost.push(structuredClone(message)) } as unknown as DocumentBackend;
  const store = new DocumentStore();
  const writer = new DocWriter(backend, store, () => [id]);
  const pull = () => {
    const batch = host.take();
    if (batch) toMain.push(structuredClone(batch));
  };
  pull();
  store.applyBatch(toMain.shift()!);
  let model: TextModel | null = null;
  let caret = 0;
  const main = {
    open() {
      model = new TextModel(writer, store, id);
      caret = model.value.length;
      return model;
    },
    type(text: string) {
      caret = model!.apply({ start: caret, end: caret, insert: text });
    },
    get caret() {
      return caret;
    },
    set caret(value: number) {
      caret = value;
      model!.caret(value, value);
    },
  };
  const steps = {
    host() {
      const message = toHost.shift();
      if (message) host.handle(message);
      pull();
      return message !== undefined;
    },
    main() {
      const batch = toMain.shift();
      if (!batch) return false;
      store.applyBatch(batch);
      if (batch.text && model?.canAdopt(batch.text, batch.applied)) {
        model.adopt(batch.text);
        caret = batch.text.head;
      }
      return true;
    },
    toPeer() {
      const update = toPeer.shift();
      if (update) Y.applyUpdate(peer, update, 'doc');
      return update !== undefined;
    },
    fromPeer() {
      const update = fromPeer.shift();
      if (update) Y.applyUpdate(doc, update, 'peer');
      pull();
      return update !== undefined;
    },
  };
  const settle = () => {
    for (let i = 0; i < 10_000; i++) {
      const moved = steps.fromPeer() || steps.toPeer() || steps.host() || steps.main();
      if (!moved) {
        pull();
        if (!toMain.length) return;
      }
    }
    throw new Error('no se estabiliza');
  };
  const hostText = () => (doc.getMap(ROOT_KEYS.texts).get(id) as Y.Text).toString();
  const peerText = () => (peer.getMap(ROOT_KEYS.texts).get(id) as Y.Text).toString();
  return { doc, peer, id, host, store, awareness, main, steps, settle, hostText, peerText, model: () => model!, pending: () => toHost.length };
}

describe('sesión de texto del host', () => {
  it('converge con un par remoto que escribe y borra en cualquier sitio, con entregas al azar', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const random = prng(seed);
      const h = harness('0123456789');
      const model = h.main.open();
      const typed = 'abcdefghijklmnopqrstuvwxyz';
      let next = 0;
      for (let step = 0; step < 120; step++) {
        const roll = random();
        if (roll < 0.3 && next < typed.length && h.pending() < 5) h.main.type(typed[next++]!);
        else if (roll < 0.45) {
          const text = h.peer.getMap(ROOT_KEYS.texts).get(h.id) as Y.Text;
          if (text.length && random() < 0.5) {
            const at = Math.floor(random() * text.length);
            text.delete(at, 1 + Math.floor(random() * Math.min(3, text.length - at)));
          } else {
            text.insert(Math.floor(random() * (text.length + 1)), 'XY'.slice(0, 1 + Math.floor(random() * 2)));
          }
        } else if (roll < 0.6) h.steps.host();
        else if (roll < 0.75) h.steps.main();
        else if (roll < 0.87) h.steps.toPeer();
        else h.steps.fromPeer();
      }
      h.settle();
      expect(h.hostText(), `semilla ${seed}`).toBe(h.peerText());
      expect(model.value, `semilla ${seed}`).toBe(h.hostText());
      expect(h.store.text(h.id)).toBe(h.hostText());
      // Lo escrito que el par no borró aparece en el orden en que se escribió.
      const mine = [...h.hostText()].filter((char) => typed.includes(char)).map((char) => typed.indexOf(char));
      expect(mine, `semilla ${seed}: ${h.hostText()}`).toEqual([...mine].sort((a, b) => a - b));
      expect(h.main.caret).toBeLessThanOrEqual(model.value.length);
      h.host.destroy();
    }
  });

  it('sin entregas cruzadas lo escrito queda contiguo', () => {
    const h = harness('');
    h.main.open();
    for (const char of 'hola') h.main.type(char);
    (h.peer.getMap(ROOT_KEYS.texts).get(h.id) as Y.Text).insert(0, 'XX');
    h.settle();
    expect(h.hostText()).toBe('XXhola');
  });

  it('un update remoto aplicado entre la lectura del espejo y text-open deja la primera tecla en su sitio', () => {
    const h = harness('abc');
    const model = h.main.open();
    // El host aplica algo que el espejo no ha visto antes de procesar text-open.
    (h.peer.getMap(ROOT_KEYS.texts).get(h.id) as Y.Text).insert(0, '>> ');
    h.steps.fromPeer();
    h.main.type('!');
    h.settle();
    expect(h.hostText()).toBe('>> abc!');
    expect(model.value).toBe('>> abc!');
    expect(h.main.caret).toBe(7);
  });

  it('el caret de una edición se transforma contra lo ya aplicado encima de ella', () => {
    const h = harness('abcd');
    const model = h.main.open();
    h.steps.host();
    h.settle();
    h.main.caret = 1;
    h.steps.host();
    // El par borra «cd» mientras el principal escribe «xyz» tras la «a».
    (h.peer.getMap(ROOT_KEYS.texts).get(h.id) as Y.Text).delete(2, 2);
    h.steps.fromPeer();
    h.main.type('xyz');
    h.settle();
    expect(h.hostText()).toBe('axyzb');
    expect(model.value).toBe('axyzb');
    expect(h.main.caret).toBe(4);
  });

  it('si otro cliente sustituye el texto, sube textGen, lo escrito se lleva al nuevo y se adopta sin condiciones', () => {
    const h = harness('');
    const model = h.main.open();
    h.main.type('Ana');
    h.settle();
    h.peer.clientID = h.doc.clientID + 1;
    h.peer.transact(() => h.peer.getMap(ROOT_KEYS.texts).set(h.id, new Y.Text('Bea ')));
    h.steps.fromPeer();
    // Una tecla mandada con la generación vieja se descarta (y se acusa).
    h.main.type('?');
    h.settle();
    expect(model.textGen).toBe(1);
    expect(h.hostText()).toBe('Bea Ana');
    expect(model.value).toBe('Bea Ana');
    h.main.type('!');
    h.settle();
    expect(h.peerText()).toBe('Bea Ana!');
  });

  it('respeta el máximo de 20.000 caracteres', () => {
    const h = harness('');
    const model = h.main.open();
    h.main.type('x'.repeat(25_000));
    h.settle();
    expect(model.value.length).toBe(20_000);
    expect(h.hostText().length).toBe(20_000);
  });

  it('resuelve los carets remotos y codifica el editingText propio como siempre', () => {
    const h = harness('Hola');
    h.main.open();
    h.settle();
    const text = h.doc.getMap(ROOT_KEYS.texts).get(h.id) as Y.Text;
    const position = JSON.stringify(Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, 2)));
    const state = {
      user: { id: 'bea', name: 'Bea', color: '#5AA9FB', avatarAssetId: null },
      pageId: 'PAGE_0000000000000001',
      cursor: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: [],
      selectionBox: null,
      marquee: null,
      gesture: null,
      editingText: { nodeId: h.id, anchor: position, head: position },
      chatTyping: false,
      aiBusy: false,
    };
    h.host.handle({ t: 'presence', state: { ...state, user: { ...state.user, id: 'yo', name: 'Yo' }, editingText: null } });
    h.awareness.states.set(77, state);
    h.awareness.emit('change', [{ added: [77], updated: [], removed: [] }, 'remote']);
    const batch = h.host.take();
    expect(batch?.text?.carets).toEqual([{ clientId: 77, anchor: 2, head: 2, color: '#5AA9FB', name: 'Bea' }]);
    const own = h.awareness.getLocalState()?.editingText as { nodeId: string; anchor: string; head: string };
    expect(own.nodeId).toBe(h.id);
    const decoded = decodePosition(own.head)!;
    expect(Y.createAbsolutePositionFromRelativePosition(decoded, h.doc)?.index).toBe(4);
    expect(decodePosition('{no')).toBeNull();
  });
});
