import type { DocumentStore } from '../model/DocumentStore.ts';
import type { NodeRecord } from '../types.ts';
import type { DocumentBackend } from './backend.ts';
import type { AnimProp, Keyframe } from '../../shared/document/schema.js';
import type { AnimationSettings, DocOp, OpOrigin, OpStep, PageFields } from './protocol.ts';

// Constructor de las ops de una transacción.
export class OpBuilder {
  readonly ops: DocOp[] = [];

  setNode(record: NodeRecord): void {
    this.ops.push({ k: 'node.set', record });
  }

  // Una clave con valor undefined se borra.
  patchNode(id: string, patch: Record<string, unknown>): void {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) unset.push(key);
      else set[key] = value;
    }
    this.ops.push(unset.length ? { k: 'node.patch', id, set, unset } : { k: 'node.patch', id, set });
  }

  // La animación del nodo se borra en la misma transacción.
  deleteNode(id: string): void {
    this.ops.push({ k: 'node.delete', id }, { k: 'animation.delete', id });
  }

  setText(id: string, content: string): void {
    this.ops.push({ k: 'text.set', id, content });
  }

  deleteText(id: string): void {
    this.ops.push({ k: 'text.delete', id });
  }

  setPage(id: string, page: PageFields): void {
    this.ops.push({ k: 'page.set', id, page });
  }

  patchPage(id: string, set: Partial<PageFields>): void {
    this.ops.push({ k: 'page.patch', id, set });
  }

  deletePage(id: string): void {
    this.ops.push({ k: 'page.delete', id });
  }

  deleteAnimation(id: string): void {
    this.ops.push({ k: 'animation.delete', id });
  }

  ensureAnimation(id: string, settings: AnimationSettings): void {
    this.ops.push({ k: 'animation.ensure', id, settings });
  }

  patchAnimation(id: string, set: Partial<AnimationSettings>): void {
    this.ops.push({ k: 'animation.patch', id, set });
  }

  setKeyframe(id: string, prop: AnimProp, key: string, keyframe: Keyframe): void {
    this.ops.push({ k: 'keyframe.set', id, prop, key, keyframe });
  }

  deleteKeyframe(id: string, prop: AnimProp, key: string): void {
    this.ops.push({ k: 'keyframe.delete', id, prop, key });
  }
}

export type TextEditMessage = { session: number; textGen: number; base: number; start: number; end: number; insert: string; anchor: number; head: number };
export type TextCaretMessage = { session: number; textGen: number; base: number; anchor: number; head: number };

// Única vía de escritura del motor. Cada transacción se ve en el espejo en el acto y viaja al host con un seq
// creciente (también las ediciones de texto, el deshacer y el rehacer); el host acusa cada seq en un lote.
export class DocWriter {
  private seq = 0;
  private session = 0;

  constructor(
    private readonly backend: DocumentBackend,
    private readonly store: DocumentStore,
    private readonly selection: () => readonly string[],
    private readonly onLocal: () => void = () => {},
  ) {}

  private nextSeq(): number {
    return ++this.seq;
  }

  transact(options: { origin?: OpOrigin; step?: OpStep }, run: (w: OpBuilder) => void): boolean {
    const builder = new OpBuilder();
    run(builder);
    if (!builder.ops.length) return false;
    const seq = this.nextSeq();
    this.store.applyLocal(seq, builder.ops);
    this.onLocal();
    this.backend.send({
      t: 'ops',
      seq,
      origin: options.origin ?? 'local',
      step: options.step ?? 'new',
      selection: [...this.selection()],
      ops: builder.ops,
    });
    return true;
  }

  setSelectionAfter(ids: readonly string[]): void {
    this.backend.send({ t: 'step-after', selection: [...ids] });
  }

  undo(): void {
    this.backend.send({ t: 'undo', seq: this.nextSeq(), selection: [...this.selection()] });
  }

  redo(): void {
    this.backend.send({ t: 'redo', seq: this.nextSeq(), selection: [...this.selection()] });
  }

  openText(id: string, value: string): number {
    const session = ++this.session;
    this.backend.send({ t: 'text-open', session, id, value, selection: [...this.selection()] });
    return session;
  }

  closeText(session: number): void {
    this.backend.send({ t: 'text-close', session });
  }

  // Devuelve el seq con el que el host acusará la edición.
  editText(id: string, content: string, message: TextEditMessage): number {
    const seq = this.nextSeq();
    this.store.applyLocal(seq, [{ k: 'text.local', id, content }]);
    this.onLocal();
    this.backend.send({ t: 'text-edit', seq, ...message });
    return seq;
  }

  moveCaret(message: TextCaretMessage): number {
    const seq = this.nextSeq();
    this.backend.send({ t: 'text-caret', seq, ...message });
    return seq;
  }
}
