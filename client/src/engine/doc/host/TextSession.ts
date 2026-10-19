import * as Y from 'yjs';
import type { PresenceState } from '../../../shared/document/keys.js';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { DOCUMENT_LIMITS } from '../../../shared/document/limits.js';
import { LOCAL_ORIGIN } from '../../origins.ts';
import { diffText } from '../../text/binding.ts';
import type { RemoteCaret, TextSessionState } from '../protocol.ts';
import { deltaToPrims, replacePrims, transformCaret, xform, type Prim } from './textOT.ts';

type Logger = Pick<Console, 'debug'>;

export type EditingPosition = NonNullable<PresenceState['editingText']>;

export function encodePosition(position: Y.RelativePosition): string {
  return JSON.stringify(Y.relativePositionToJSON(position));
}

export function decodePosition(value: string): Y.RelativePosition | null {
  try {
    return Y.createRelativePositionFromJSON(JSON.parse(value));
  } catch {
    return null;
  }
}

type Outgoing = { rseq: number; ops: Prim[] };

const clamp = (value: number, max: number) => Math.max(0, Math.min(Number.isFinite(value) ? Math.trunc(value) : 0, max));

// Sesión de texto del host. El hilo principal escribe con eco local y manda cada edición con la `base` (el último
// estado del host que adoptó); lo que el host aplicó desde entonces (remoto, deshacer, normalización) está en
// `outgoing`, y la edición se transforma contra ello (cliente-servidor de dos partes). El hilo principal nunca
// transforma: adopta el estado del host cuando no le queda nada por confirmar.
export class TextSession {
  private text: Y.Text | null = null;
  private readonly texts: Y.Map<unknown>;
  private readonly nodes: Y.Map<unknown>;
  private outgoing: Outgoing[] = [];
  private rseq = 0;
  private textGen = 0;
  private applying = false;
  private anchorPos: Y.RelativePosition | null = null;
  private headPos: Y.RelativePosition | null = null;
  // Último texto y caret conocidos, para llevarlos a otro Y.Text si sustituyen texts[id].
  private lastValue = '';
  private lastCaret = { anchor: 0, head: 0 };
  private closed = false;

  constructor(
    private readonly doc: Y.Doc,
    readonly session: number,
    readonly id: string,
    value: string,
    private readonly onChange: () => void,
    private readonly logger: Logger = console,
  ) {
    this.texts = doc.getMap(ROOT_KEYS.texts);
    this.nodes = doc.getMap(ROOT_KEYS.nodes);
    this.texts.observe(this.onTexts);
    const current = this.ensureText();
    if (!current) return;
    this.bind(current);
    // rseq = 0 es el valor que tenía el principal al abrir. Si el host ya aplicó algo que el espejo no ha visto, la
    // diferencia va como rseq = 1 y las teclas con base 0 se transforman contra ella.
    const opened = value.slice(0, DOCUMENT_LIMITS.maxTextLength);
    const actual = current.toString();
    if (opened !== actual) {
      const diff = diffText(opened, actual);
      if (diff) this.outgoing.push({ rseq: ++this.rseq, ops: replacePrims(diff.start, diff.end, diff.insert) });
    }
    this.setCaret(actual.length, actual.length);
  }

  private ensureText(): Y.Text | null {
    const current = this.texts.get(this.id);
    if (current instanceof Y.Text) return current;
    if (!this.nodes.has(this.id)) return null;
    const created = new Y.Text();
    this.doc.transact(() => this.texts.set(this.id, created), LOCAL_ORIGIN);
    return this.texts.get(this.id) instanceof Y.Text ? (this.texts.get(this.id) as Y.Text) : created;
  }

  private bind(text: Y.Text): void {
    this.text?.unobserve(this.onText);
    this.text = text;
    this.lastValue = text.toString();
    text.observe(this.onText);
  }

  private readonly onText = (event: Y.YTextEvent) => {
    this.lastValue = (event.target as Y.Text).toString();
    if (this.applying) return;
    const ops = deltaToPrims(event.delta as Array<{ retain?: number; insert?: unknown; delete?: number }>);
    if (ops.length) this.outgoing.push({ rseq: ++this.rseq, ops });
    this.onChange();
  };

  // Otro cliente sustituyó o borró texts[id]: lo escrito se lleva al Y.Text que quede, al final.
  private readonly onTexts = (event: Y.YMapEvent<unknown>) => {
    if (this.closed || !event.keysChanged.has(this.id)) return;
    const current = this.texts.get(this.id);
    if (current === this.text) return;
    if (!(current instanceof Y.Text) && !this.nodes.has(this.id)) return;
    const carried = this.lastValue;
    const caret = this.lastCaret;
    let next = current instanceof Y.Text ? current : null;
    if (!next) {
      next = new Y.Text();
      const created = next;
      this.doc.transact(() => this.texts.set(this.id, created), LOCAL_ORIGIN);
    }
    this.bind(next);
    const base = next.length;
    if (carried) {
      const target = next;
      this.applying = true;
      try {
        const room = DOCUMENT_LIMITS.maxTextLength - base;
        if (room > 0) this.doc.transact(() => target.insert(base, carried.slice(0, room)), LOCAL_ORIGIN);
      } finally {
        this.applying = false;
      }
      this.lastValue = next.toString();
    }
    this.textGen++;
    this.rseq++;
    this.outgoing = [];
    const length = next.length;
    this.setCaret(Math.min(base + caret.anchor, length), Math.min(base + caret.head, length));
    this.onChange();
  };

  edit(message: { textGen: number; base: number; start: number; end: number; insert: string; anchor: number; head: number }): void {
    const text = this.text;
    if (!text || message.textGen !== this.textGen) {
      this.logger.debug('Edición de texto descartada: el texto se sustituyó.');
      return;
    }
    const pending = this.since(message.base);
    let edit = replacePrims(message.start, Math.max(message.start, message.end), message.insert);
    for (const entry of pending) {
      const [next, rebased] = xform(edit, entry.ops);
      edit = next;
      entry.ops = rebased;
    }
    this.applying = true;
    try {
      this.doc.transact(() => {
        for (const prim of edit) {
          const length = text.length;
          if (prim.t === 'del') {
            const at = clamp(prim.p, length);
            const count = clamp(prim.n, length - at);
            if (count > 0) text.delete(at, count);
          } else {
            const room = DOCUMENT_LIMITS.maxTextLength - length;
            const insert = prim.s.slice(0, Math.max(0, room));
            if (insert) text.insert(clamp(prim.p, length), insert);
          }
        }
      }, LOCAL_ORIGIN);
    } finally {
      this.applying = false;
    }
    this.lastValue = text.toString();
    // El caret está en el texto del principal (base + edición): lo que el host aplicó encima es lo ya transformado.
    const after = pending.flatMap((entry) => entry.ops);
    this.setCaret(transformCaret(message.anchor, after), transformCaret(message.head, after));
    this.onChange();
  }

  caret(message: { textGen: number; base: number; anchor: number; head: number }): void {
    if (!this.text || message.textGen !== this.textGen) return;
    const pending = this.since(message.base).flatMap((entry) => entry.ops);
    this.setCaret(transformCaret(message.anchor, pending), transformCaret(message.head, pending));
    this.onChange();
  }

  // Lo que el principal aún no ha visto: se olvida lo que ya adoptó.
  private since(base: number): Outgoing[] {
    if (this.outgoing.length && this.outgoing[0]!.rseq <= base) this.outgoing = this.outgoing.filter((entry) => entry.rseq > base);
    return this.outgoing;
  }

  private setCaret(anchor: number, head: number): void {
    const text = this.text;
    if (!text) return;
    const length = text.length;
    const a = clamp(anchor, length);
    const h = clamp(head, length);
    this.lastCaret = { anchor: a, head: h };
    this.anchorPos = Y.createRelativePositionFromTypeIndex(text, a);
    this.headPos = Y.createRelativePositionFromTypeIndex(text, h);
  }

  private absolute(position: Y.RelativePosition | null): number | null {
    if (!position || !this.text) return null;
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, this.doc);
    return absolute && absolute.type === this.text ? absolute.index : null;
  }

  // editingText de la Awareness propia, en el formato de siempre.
  editing(): EditingPosition | null {
    if (!this.anchorPos || !this.headPos) return null;
    return { nodeId: this.id, anchor: encodePosition(this.anchorPos), head: encodePosition(this.headPos) };
  }

  state(remotes: Iterable<[number, PresenceState]>, pageId: string): TextSessionState | null {
    const text = this.text;
    if (!text) return null;
    const length = text.length;
    const anchor = this.absolute(this.anchorPos) ?? length;
    const head = this.absolute(this.headPos) ?? length;
    this.lastCaret = { anchor, head };
    const carets: RemoteCaret[] = [];
    for (const [clientId, state] of remotes) {
      const editing = state.editingText;
      if (!editing || editing.nodeId !== this.id || state.pageId !== pageId) continue;
      const a = decodePosition(editing.anchor);
      const h = decodePosition(editing.head);
      const ra = this.absolute(a);
      const rh = this.absolute(h);
      if (ra === null || rh === null) continue;
      carets.push({ clientId, anchor: ra, head: rh, color: state.user.color, name: state.user.name });
    }
    return { session: this.session, id: this.id, textGen: this.textGen, value: text.toString(), rseq: this.rseq, anchor, head, carets };
  }

  close(): void {
    this.closed = true;
    this.text?.unobserve(this.onText);
    this.texts.unobserve(this.onTexts);
    this.text = null;
  }
}
