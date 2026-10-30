import type { EditorCore, TextEditing } from '../EditorCore.ts';
import type { TextSessionState } from '../doc/protocol.ts';
import { parseColor } from '../render/color.ts';
import { isRenderable } from '../types.ts';
import { diffText, editFor } from './binding.ts';
import { cssFamily, loadFont } from './fonts.ts';
import { ALIGN_FACTOR, layoutOf } from './layout.ts';
import { TextModel } from './TextModel.ts';

export const TEXT_EDITOR_ATTR = 'data-text-editor';
export const REMOTE_CARET_ATTR = 'data-remote-caret';

const cssColor = (hex: string) => {
  const { color, alpha } = parseColor(hex);
  return `rgb(${(color >> 16) & 255} ${(color >> 8) & 255} ${color & 255} / ${alpha})`;
};

export type TextEditorOptions = { label: string };

// Editor DOM superpuesto al lienzo y enlazado a texts[id]. Los beforeinput se traducen a ediciones de texto plano
// con eco local (TextModel); el estado que manda el host se pinta con textContent, con el caret que calculó. Nunca
// innerHTML.
export class TextEditor {
  private session: Session | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly core: EditorCore,
    private readonly root: HTMLElement,
    private readonly options: TextEditorOptions = { label: 'Texto' },
  ) {
    this.unsubscribe = core.editingText.subscribe((editing) => this.toggle(editing));
  }

  get element(): HTMLElement | null {
    return this.session?.element ?? null;
  }

  private toggle(editing: TextEditing | null): void {
    if (this.session && this.session.id !== editing?.id) {
      this.session.close();
      this.session = null;
    }
    if (editing && !this.session) {
      if (!this.core.store.hasText(editing.id)) return;
      this.session = new Session(this.core, this.root, editing, this.options);
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.session?.close();
    this.session = null;
  }
}

class Session {
  readonly element: HTMLDivElement;
  private readonly textNode: Text;
  private readonly carets: HTMLDivElement;
  private readonly model: TextModel;
  private readonly cleanups: Array<() => void> = [];
  private applying = false;
  private composing = false;
  // Estado al empezar una composición: el texto pintado, el tramo que sustituye y la generación del texto.
  private composition: { before: string; start: number; end: number; textGen: number } | null = null;
  // Estado del host recibido durante una composición: se adopta al terminarla.
  private stashed: { state: TextSessionState; applied: number } | null = null;
  // Último valor escrito en el DOM por render().
  private rendered: string;
  private transformKey = '';

  constructor(
    private readonly core: EditorCore,
    private readonly root: HTMLElement,
    private readonly editing: TextEditing,
    options: TextEditorOptions,
  ) {
    this.model = new TextModel(core.writer, core.store, editing.id);
    this.rendered = this.model.value;
    const element = document.createElement('div');
    element.contentEditable = 'plaintext-only';
    // Navegadores sin plaintext-only: el pegado y los formatos se interceptan igualmente en beforeinput.
    if (element.contentEditable !== 'plaintext-only') element.contentEditable = 'true';
    element.tabIndex = 0;
    element.setAttribute(TEXT_EDITOR_ATTR, '');
    element.setAttribute('role', 'textbox');
    element.setAttribute('aria-multiline', 'true');
    element.setAttribute('aria-label', options.label);
    Object.assign(element.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      margin: '0',
      padding: '0',
      border: '0',
      outline: 'none',
      background: 'transparent',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      transformOrigin: '0 0',
      minWidth: '1px',
      cursor: 'text',
      zIndex: '2',
      // El lienzo anula la selección de texto para que el dedo no seleccione la página; aquí hay que poder seleccionar.
      userSelect: 'text',
      webkitUserSelect: 'text',
    } satisfies Partial<CSSStyleDeclaration>);
    this.textNode = document.createTextNode(this.rendered);
    // El <br> final deja ver la última línea vacía; no cuenta en el texto.
    element.append(this.textNode, document.createElement('br'));
    this.element = element;

    this.carets = document.createElement('div');
    this.carets.setAttribute('aria-hidden', 'true');
    Object.assign(this.carets.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '3' });
    root.append(element, this.carets);

    this.listen(element, 'beforeinput', this.onBeforeInput as EventListener);
    this.listen(element, 'input', this.onInput);
    this.listen(element, 'compositionstart', this.onCompositionStart);
    this.listen(element, 'compositionend', this.onCompositionEnd);
    this.listen(element, 'keydown', this.onKeyDown as EventListener);
    this.listen(document, 'selectionchange', this.onSelectionChange);
    this.cleanups.push(core.onTextState((state, applied) => this.onState(state, applied)));
    this.cleanups.push(core.onFrame(() => this.position()));

    this.position();
    element.focus({ preventScroll: true });
    const end = this.textNode.length;
    this.select(end, end);
    this.drawCarets();
  }

  get id(): string {
    return this.editing.id;
  }

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.cleanups.push(() => target.removeEventListener(type, listener));
  }

  // ── Entrada local ──

  private readonly onBeforeInput = (event: InputEvent) => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault();
      if (event.inputType === 'historyUndo') this.core.commands.undo();
      else this.core.commands.redo();
      return;
    }
    // La composición (IME) no se puede cancelar: se recoge en input al terminar.
    if (event.inputType === 'insertCompositionText' || this.composing) return;
    event.preventDefault();
    const range = this.offsets();
    if (!range) return;
    const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? null;
    const edit = editFor(event.inputType, data, range.start, range.end, this.model.value);
    if (!edit || (edit.start === edit.end && edit.insert === '')) return;
    this.applying = true;
    try {
      const caret = this.model.apply(edit);
      this.render(caret, caret);
    } finally {
      this.applying = false;
    }
    this.afterLocalChange();
  };

  // Lo que el navegador escribió por su cuenta (composición, corrector): se compara y se manda como edición.
  private readonly onInput = () => {
    if (this.composing) return;
    const range = this.offsets();
    const written = this.element.textContent ?? '';
    const edit = diffText(this.model.value, written);
    this.applying = true;
    let caret: number;
    try {
      const applied = edit ? this.model.apply(edit) : null;
      const value = this.model.value;
      caret = Math.min(range?.end ?? value.length, value.length);
      this.render(caret, caret);
      if (applied !== caret) this.model.caret(caret, caret);
    } finally {
      this.applying = false;
    }
    if (edit) this.afterLocalChange();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.core.stopTextEdit();
      return;
    }
    if (ctrl && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) this.core.commands.redo();
      else this.core.commands.undo();
    }
  };

  private readonly onSelectionChange = () => {
    if (this.applying || this.composing || document.activeElement !== this.element) return;
    const range = this.offsets();
    if (!range) return;
    this.model.caret(range.anchor, range.head);
  };

  private afterLocalChange(): void {
    this.fit();
    this.position();
    this.drawCarets();
  }

  // Un texto crece con lo que se escribe: su caja en el documento sigue al editor.
  private fit(): void {
    const record = this.core.store.get(this.id);
    if (record?.type !== 'text') return;
    this.core.commands.fitText(this.id, { h: this.element.offsetHeight, ...(record.autoWidth ? { w: this.element.offsetWidth } : {}) });
  }

  // ── Estado del host (cambios de los demás, deshacer) ──

  // Durante una composición el DOM es del navegador: el estado se guarda y se pinta al terminarla.
  private onState(state: TextSessionState, applied: number): void {
    if (state.session !== this.model.session) return;
    if (this.composing) {
      this.stashed = { state, applied };
      return;
    }
    if (this.model.canAdopt(state, applied)) this.adopt(state);
    else {
      this.model.carets = state.carets;
      this.drawCarets();
    }
  }

  private adopt(state: TextSessionState): void {
    this.model.adopt(state);
    this.applying = true;
    try {
      this.render(state.anchor, state.head);
    } finally {
      this.applying = false;
    }
    this.position();
    this.drawCarets();
  }

  // ── Composición (IME y teclas muertas) ──

  private readonly onCompositionStart = () => {
    const range = this.offsets();
    const length = this.rendered.length;
    const start = Math.min(range?.start ?? length, length);
    const end = Math.min(range?.end ?? length, length);
    this.composing = true;
    this.stashed = null;
    this.composition = { before: this.rendered, start, end, textGen: this.model.textGen };
  };

  // Lo compuesto es lo que el navegador dejó entre el prefijo y el sufijo de antes. Se manda con la base de cuando
  // empezó la composición (no se adopta nada mientras dura) y el host lo coloca con lo remoto ya incluido.
  private readonly onCompositionEnd = () => {
    const composition = this.composition;
    const stashed = this.stashed;
    this.composing = false;
    this.composition = null;
    this.stashed = null;
    const written = this.element.textContent ?? '';
    const tail = composition ? composition.before.length - composition.end : 0;
    const intact =
      composition !== null &&
      written.length - tail >= composition.start &&
      written.startsWith(composition.before.slice(0, composition.start)) &&
      written.endsWith(composition.before.slice(composition.end));
    if (!composition || !intact) {
      if (stashed && stashed.state.textGen !== this.model.textGen) this.adopt(stashed.state);
      this.onInput();
      return;
    }
    const insert = written.slice(composition.start, written.length - tail);
    const changed = insert !== composition.before.slice(composition.start, composition.end);
    // Otro cliente sustituyó el texto: se adopta el nuevo y lo compuesto se añade al final.
    if (stashed && stashed.state.textGen !== composition.textGen) {
      this.adopt(stashed.state);
      if (changed && insert) {
        const end = this.model.value.length;
        this.applyLocal({ start: end, end, insert });
      }
      return;
    }
    if (changed) {
      this.applyLocal({ start: composition.start, end: composition.end, insert });
      return;
    }
    if (stashed && this.model.canAdopt(stashed.state, stashed.applied)) {
      this.adopt(stashed.state);
      return;
    }
    const range = this.offsets();
    const caret = Math.min(range?.head ?? this.model.value.length, this.model.value.length);
    this.applying = true;
    try {
      this.render(caret, caret);
    } finally {
      this.applying = false;
    }
    this.position();
    this.drawCarets();
  };

  private applyLocal(edit: { start: number; end: number; insert: string }): void {
    this.applying = true;
    try {
      const caret = this.model.apply(edit);
      this.render(caret, caret);
    } finally {
      this.applying = false;
    }
    this.afterLocalChange();
  }

  private render(anchor: number, head: number): void {
    const value = this.model.value;
    this.rendered = value;
    if (this.textNode.data !== value) this.textNode.data = value;
    // Nada que no sea el texto y el <br> final: lo que el navegador haya añadido se quita.
    if (this.element.childNodes.length !== 2 || this.element.firstChild !== this.textNode) {
      this.element.replaceChildren(this.textNode, document.createElement('br'));
    }
    if (document.activeElement === this.element) this.select(anchor, head);
  }

  // ── Selección en índices de texto ──

  private offsets(): { start: number; end: number; anchor: number; head: number } | null {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !this.element.contains(selection.anchorNode)) return null;
    const at = (node: Node, offset: number) => {
      const range = document.createRange();
      range.setStart(this.element, 0);
      range.setEnd(node, offset);
      return Math.min(range.toString().length, this.textNode.length);
    };
    const anchor = at(selection.anchorNode, selection.anchorOffset);
    const head = selection.focusNode ? at(selection.focusNode, selection.focusOffset) : anchor;
    return { start: Math.min(anchor, head), end: Math.max(anchor, head), anchor, head };
  }

  private select(anchor: number, head: number): void {
    const selection = document.getSelection();
    if (!selection) return;
    const length = this.textNode.length;
    selection.setBaseAndExtent(this.textNode, Math.min(anchor, length), this.textNode, Math.min(head, length));
  }

  // ── Posición y estilo ──

  private position(): void {
    const stored = this.core.store.get(this.id);
    if (!stored || !isRenderable(stored)) return;
    const record = this.core.drawnRecord(stored);
    const layout = layoutOf(record, 'x');
    if (!layout) return;
    void loadFont(layout.family, layout.italic);
    const camera = this.core.camera;
    const m = this.core.viewMatrix(record);
    const z = camera.zoom;
    const style = this.element.style;
    style.fontFamily = `"${cssFamily(layout.family)}"`;
    style.fontSize = `${layout.size}px`;
    style.fontWeight = String(layout.weight);
    style.fontStyle = layout.italic ? 'italic' : 'normal';
    style.lineHeight = `${layout.size * layout.lineHeight}px`;
    style.color = cssColor(layout.color);
    style.caretColor = cssColor(layout.color);
    style.textAlign = layout.align;
    style.textDecoration = [layout.underline ? 'underline' : '', layout.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    style.width = layout.wrapWidth === null ? 'max-content' : `${layout.wrapWidth}px`;
    const offsetY = layout.box.y + (layout.box.h - this.element.offsetHeight) * ALIGN_FACTOR[layout.vAlign];
    const transform = `matrix(${m[0] * z}, ${m[1] * z}, ${m[2] * z}, ${m[3] * z}, ${(m[4] - camera.x) * z}, ${(m[5] - camera.y) * z}) translate(${layout.box.x}px, ${record.type === 'text' ? 0 : offsetY}px)`;
    if (transform !== this.transformKey) {
      this.transformKey = transform;
      style.transform = transform;
      this.drawCarets();
    }
  }


  // ── Carets y selecciones de los demás ──

  // Como el texto, no se pintan durante una composición.
  private drawCarets(): void {
    if (this.composing) return;
    const spans: HTMLElement[] = [];
    const base = this.root.getBoundingClientRect();
    const length = this.textNode.length;
    for (const remote of this.model.carets) {
      const anchor = Math.min(remote.anchor, length);
      const head = Math.min(remote.head, length);
      const color = remote.color;
      const range = document.createRange();
      if (anchor !== head) {
        range.setStart(this.textNode, Math.min(anchor, head));
        range.setEnd(this.textNode, Math.max(anchor, head));
        for (const rect of Array.from(range.getClientRects())) {
          spans.push(this.box(rect, base, { background: color, opacity: '0.3' }));
        }
      }
      const caret = this.caretRect(head);
      if (!caret) continue;
      const span = this.box({ left: caret.left, top: caret.top, width: 2, height: caret.height }, base, { background: color });
      span.setAttribute(REMOTE_CARET_ATTR, String(remote.clientId));
      span.title = remote.name;
      const name = document.createElement('span');
      name.textContent = remote.name;
      Object.assign(name.style, {
        position: 'absolute',
        left: '0',
        bottom: '100%',
        padding: '1px 4px',
        borderRadius: '4px',
        background: color,
        color: '#0B1220',
        font: '600 11px/1.3 "Manrope Variable", sans-serif',
        whiteSpace: 'nowrap',
      } satisfies Partial<CSSStyleDeclaration>);
      span.append(name);
      spans.push(span);
    }
    this.carets.replaceChildren(...spans);
  }

  private caretRect(index: number): { left: number; top: number; height: number } | null {
    const range = document.createRange();
    const length = this.textNode.length;
    range.setStart(this.textNode, index);
    range.setEnd(this.textNode, index);
    const rect = range.getClientRects()[0];
    if (rect && rect.height > 0) return { left: rect.left, top: rect.top, height: rect.height };
    // Al final de una línea vacía no hay rectángulo: se usa el del carácter anterior o el del editor.
    if (index > 0 && length > 0) {
      range.setStart(this.textNode, index - 1);
      const before = range.getClientRects();
      const last = before[before.length - 1];
      if (last && last.height > 0) {
        if (this.textNode.data[index - 1] === '\n') return { left: this.element.getBoundingClientRect().left, top: last.bottom, height: last.height };
        return { left: last.right, top: last.top, height: last.height };
      }
    }
    const box = this.element.getBoundingClientRect();
    return box.height > 0 ? { left: box.left, top: box.top, height: box.height } : null;
  }

  private box(rect: { left: number; top: number; width: number; height: number }, base: DOMRect, style: Partial<CSSStyleDeclaration>): HTMLElement {
    const span = document.createElement('span');
    Object.assign(span.style, {
      position: 'absolute',
      left: `${rect.left - base.left}px`,
      top: `${rect.top - base.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      ...style,
    });
    return span;
  }


  close(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.model.close();
    const focused = document.activeElement === this.element;
    this.element.remove();
    this.carets.remove();
    if (focused) this.root.focus({ preventScroll: true });
  }
}
