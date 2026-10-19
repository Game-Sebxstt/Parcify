import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import type { DocWriter } from '../doc/DocWriter.ts';
import type { TextSessionState } from '../doc/protocol.ts';
import type { DocumentStore } from '../model/DocumentStore.ts';
import type { TextEdit } from './binding.ts';

// Texto en edición en el hilo principal, con eco local. Cada edición viaja al host con la `base` (el último estado
// del host adoptado) y se ve en el espejo en el acto. El estado del host solo se adopta cuando ya refleja todo lo
// mandado (o cuando otro cliente sustituyó el texto): así el principal y el host acaban con el mismo texto.
export class TextModel {
  readonly session: number;
  value: string;
  textGen = 0;
  base = 0;
  private lastSent = 0;
  // Carets remotos del último estado recibido.
  carets: TextSessionState['carets'] = [];

  constructor(
    private readonly writer: DocWriter,
    store: DocumentStore,
    readonly id: string,
  ) {
    this.value = store.text(id).slice(0, DOCUMENT_LIMITS.maxTextLength);
    this.session = writer.openText(id, this.value);
  }

  // Aplica una edición y deja el caret tras lo insertado. Respeta el máximo de caracteres.
  apply(edit: TextEdit): number {
    const value = this.value;
    const start = Math.max(0, Math.min(edit.start, value.length));
    const end = Math.max(start, Math.min(edit.end, value.length));
    const room = DOCUMENT_LIMITS.maxTextLength - (value.length - (end - start));
    const insert = edit.insert.slice(0, Math.max(0, room));
    if (start === end && !insert) return start;
    this.value = value.slice(0, start) + insert + value.slice(end);
    const caret = start + insert.length;
    this.lastSent = this.writer.editText(this.id, this.value, {
      session: this.session,
      textGen: this.textGen,
      base: this.base,
      start,
      end,
      insert,
      anchor: caret,
      head: caret,
    });
    return caret;
  }

  caret(anchor: number, head: number): void {
    const length = this.value.length;
    this.lastSent = this.writer.moveCaret({
      session: this.session,
      textGen: this.textGen,
      base: this.base,
      anchor: Math.max(0, Math.min(anchor, length)),
      head: Math.max(0, Math.min(head, length)),
    });
  }

  // ¿Se puede adoptar este estado? Sin nada pendiente de confirmar, o si el texto se sustituyó.
  canAdopt(state: TextSessionState, applied: number): boolean {
    return state.session === this.session && (state.textGen !== this.textGen || applied >= this.lastSent);
  }

  adopt(state: TextSessionState): void {
    this.value = state.value;
    this.textGen = state.textGen;
    this.base = state.rseq;
    this.carets = state.carets;
  }

  close(): void {
    this.writer.closeText(this.session);
  }
}
