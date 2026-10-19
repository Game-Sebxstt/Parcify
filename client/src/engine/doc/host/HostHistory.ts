import * as Y from 'yjs';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { AI_ORIGIN, LOCAL_ORIGIN } from '../../origins.ts';

export const CAPTURE_TIMEOUT_MS = 400;

type StackEvent = { stackItem: { meta: Map<string, unknown> }; type: 'undo' | 'redo' };

const BEFORE = 'selectionBefore';
const AFTER = 'selectionAfter';

// Deshacer por pestaña: solo lo propio (LOCAL_ORIGIN y AI_ORIGIN), con la selección guardada en cada paso. La
// selección «actual» es la del último mensaje del hilo principal que la trae.
export class HostHistory {
  readonly manager: Y.UndoManager;
  private pendingBefore: string[] | null = null;
  private poppedMeta: Map<string, unknown> | null = null;
  private current: string[] = [];

  constructor(
    doc: Y.Doc,
    private readonly onChange: (state: { canUndo: boolean; canRedo: boolean }) => void,
    private readonly onRestore: (selection: string[]) => void,
  ) {
    this.manager = new Y.UndoManager(
      [doc.getMap(ROOT_KEYS.nodes), doc.getMap(ROOT_KEYS.texts), doc.getMap(ROOT_KEYS.animations), doc.getMap(ROOT_KEYS.pages)],
      { trackedOrigins: new Set<unknown>([LOCAL_ORIGIN, AI_ORIGIN]), captureTimeout: CAPTURE_TIMEOUT_MS },
    );
    this.manager.on('stack-item-added', this.handleAdded);
    this.manager.on('stack-item-popped', this.handlePopped);
    this.manager.on('stack-cleared', this.emit);
  }

  setSelection(selection: readonly string[]): void {
    this.current = [...selection];
  }

  // Antes de un comando o de abrir una sesión de texto: corta el paso anterior y guarda la selección previa.
  begin(selection: readonly string[]): void {
    this.manager.stopCapturing();
    this.pendingBefore = [...selection];
    this.current = [...selection];
  }

  private readonly handleAdded = (event: StackEvent) => {
    const meta = event.stackItem.meta;
    if (this.poppedMeta) {
      // Al deshacer, Yjs crea el paso de rehacer antes de avisar del paso sacado: se copia su selección.
      for (const [key, value] of this.poppedMeta) meta.set(key, value);
      this.poppedMeta = null;
    } else {
      if (!meta.has(BEFORE)) meta.set(BEFORE, this.pendingBefore ?? [...this.current]);
      meta.set(AFTER, [...this.current]);
    }
    this.pendingBefore = null;
    this.emit();
  };

  // Para comandos que cambian la selección después de escribir (crear, pegar, duplicar).
  setSelectionAfter(selection: readonly string[]): void {
    this.current = [...selection];
    this.manager.undoStack.at(-1)?.meta.set(AFTER, [...selection]);
  }

  private readonly handlePopped = (event: StackEvent) => {
    const meta = event.stackItem.meta;
    const ids = (event.type === 'undo' ? meta.get(BEFORE) : meta.get(AFTER)) as string[] | undefined;
    if (ids) {
      this.current = [...ids];
      this.onRestore([...ids]);
    }
    this.emit();
  };

  undo(selection: readonly string[]): boolean {
    this.current = [...selection];
    this.manager.stopCapturing();
    this.armCopy('undo');
    const done = this.manager.undo() !== null;
    this.poppedMeta = null;
    return done;
  }

  redo(selection: readonly string[]): boolean {
    this.current = [...selection];
    this.manager.stopCapturing();
    this.armCopy('redo');
    const done = this.manager.redo() !== null;
    this.poppedMeta = null;
    return done;
  }

  // El paso que se va a sacar pasa sus metadatos al paso opuesto que Yjs crea al aplicarlo.
  private armCopy(kind: 'undo' | 'redo'): void {
    const stack = kind === 'undo' ? this.manager.undoStack : this.manager.redoStack;
    const item = stack.at(-1);
    this.poppedMeta = item ? new Map(item.meta) : null;
  }

  get canUndo(): boolean {
    return this.manager.canUndo();
  }

  get canRedo(): boolean {
    return this.manager.canRedo();
  }

  private readonly emit = () => {
    this.onChange({ canUndo: this.canUndo, canRedo: this.canRedo });
  };

  destroy(): void {
    this.manager.off('stack-item-added', this.handleAdded);
    this.manager.off('stack-item-popped', this.handlePopped);
    this.manager.off('stack-cleared', this.emit);
    this.manager.destroy();
  }
}
