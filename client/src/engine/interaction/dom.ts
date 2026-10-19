import type { EditorCore } from '../EditorCore.ts';
import type { PointerInput } from './PointerController.ts';
import type { KeyInput } from './shortcuts.ts';
import { readTransfer, type ClipboardController } from './clipboard.ts';
import { TEXT_EDITOR_ATTR } from '../text/TextEditor.ts';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// Los widgets con teclado propio (el árbol de capas, la lista de páginas) llevan este atributo.
export const OWN_KEYS_ATTR = 'data-own-keys';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// Dónde se abrió el menú contextual: en la ventana (para colocarlo) y en la página (para pegar ahí).
export type ContextMenuRequest = { clientX: number; clientY: number; at: { x: number; y: number } };

export type DomOptions = {
  embedded?: boolean;
  onDropFiles?: (files: File[], at: { x: number; y: number }) => void;
  onContextMenu?: (request: ContextMenuRequest) => void;
};

// Un único conjunto de listeners sobre el contenedor del lienzo; Pixi no escucha eventos.
export function bindDom(core: EditorCore, container: HTMLElement, clipboard: ClipboardController, options: DomOptions = {}): () => void {
  // Incrustado, el teclado y el portapapeles solo cuentan con el foco dentro del lienzo.
  const outside = (event: Event) => options.embedded === true && !container.contains(event.target as Node | null);
  let rect = container.getBoundingClientRect();
  const refreshRect = () => {
    rect = container.getBoundingClientRect();
  };

  const toInput = (event: PointerEvent): PointerInput => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    button: event.button,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: MAC ? event.metaKey : event.ctrlKey,
    pointerId: event.pointerId,
  });

  const toKey = (event: KeyboardEvent): KeyInput => ({
    key: event.key,
    code: event.code,
    ctrl: MAC ? event.metaKey : event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    repeat: event.repeat,
  });

  const onPointerDown = (event: PointerEvent) => {
    // Dentro del editor de texto, el puntero mueve el caret; fuera, confirma la edición.
    if (event.target instanceof Element && event.target.closest(`[${TEXT_EDITOR_ATTR}]`)) return;
    if (core.editingText.get()) core.stopTextEdit();
    refreshRect();
    if (document.activeElement !== container) container.focus({ preventScroll: true });
    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // Los eventos sintéticos no tienen un puntero activo que capturar.
    }
    if (event.button === 1) event.preventDefault();
    core.controller.pointerDown(toInput(event));
  };
  const inEditor = (event: Event) => event.target instanceof Element && event.target.closest(`[${TEXT_EDITOR_ATTR}]`) !== null;
  const onPointerMove = (event: PointerEvent) => core.controller.pointerMove(toInput(event));
  const onPointerUp = (event: PointerEvent) => {
    if (inEditor(event) && core.controller.state === 'idle') return;
    try {
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    } catch {
      // Sin captura que soltar.
    }
    core.controller.pointerUp(toInput(event));
  };
  const onPointerCancel = () => core.controller.cancel();
  const onWheel = (event: WheelEvent) => {
    // Incrustado en una página, la rueda desplaza la página; solo el pellizco (Ctrl) hace zoom.
    if (options.embedded && !event.ctrlKey) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    core.controller.wheel({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      deltaX: event.deltaX * scale,
      deltaY: event.deltaY * scale,
      ctrl: event.ctrlKey || event.metaKey,
    });
  };

  // Los atajos se escuchan en la ventana, salvo con el foco en un campo de texto o al pulsar un botón.
  const onKeyDown = (event: KeyboardEvent) => {
    if (outside(event) || isEditable(event.target)) return;
    // Dentro de un widget con teclado propio solo valen los atajos con Ctrl (deshacer, copiar…).
    if (event.target instanceof Element && event.target.closest(`[${OWN_KEYS_ATTR}]`) && !(event.ctrlKey || event.metaKey)) return;
    // Con el foco en el lienzo, Tab recorre los nodos; al pasar del último, el foco sale del lienzo.
    if (event.key === 'Tab') {
      if (event.target === container && !event.ctrlKey && !event.altKey && !event.metaKey && core.commands.focusNext(event.shiftKey ? -1 : 1)) event.preventDefault();
      return;
    }
    if ((event.key === ' ' || event.key === 'Enter') && event.target instanceof HTMLButtonElement) return;
    if (event.target === container && options.onContextMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault();
      openMenuFromKeyboard();
      return;
    }
    if (core.controller.keyDown(toKey(event))) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => core.controller.keyUp(toKey(event));
  const onBlur = () => core.controller.blur();

  // Copiar y cortar escriben el bloque de Parcify en text/html y el texto de los nodos en text/plain.
  const onCopy = (event: ClipboardEvent) => {
    if (outside(event) || isEditable(event.target) || !event.clipboardData) return;
    if (clipboard.copyTo(event.clipboardData)) event.preventDefault();
  };
  const onCut = (event: ClipboardEvent) => {
    if (outside(event) || isEditable(event.target) || core.readOnly.get() || !event.clipboardData) return;
    if (clipboard.cutTo(event.clipboardData)) event.preventDefault();
  };
  // Pegar nunca mete el HTML recibido en el DOM: solo se lee el bloque de Parcify, archivos y texto.
  const onPaste = (event: ClipboardEvent) => {
    if (outside(event) || isEditable(event.target) || core.readOnly.get() || !event.clipboardData) return;
    const content = readTransfer(event.clipboardData);
    if (!content) return;
    event.preventDefault();
    void clipboard.paste(content);
  };

  const onContextMenu = (event: MouseEvent) => {
    if (inEditor(event) || !options.onContextMenu) return;
    event.preventDefault();
    if (core.editingText.get()) core.stopTextEdit();
    refreshRect();
    const at = core.controller.contextMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    options.onContextMenu({ clientX: event.clientX, clientY: event.clientY, at });
  };
  // Con el teclado (tecla de menú o Shift+F10) el menú se abre sobre la selección o en el centro de la vista.
  const openMenuFromKeyboard = () => {
    refreshRect();
    const ids = core.selection.get();
    const box = ids.length ? core.boundsOf(ids) : null;
    const at = box && Number.isFinite(box.minX) ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : core.viewCenter();
    const screen = core.camera.worldToScreen(at.x, at.y);
    const clientX = Math.min(rect.right, Math.max(rect.left, rect.left + screen.x));
    const clientY = Math.min(rect.bottom, Math.max(rect.top, rect.top + screen.y));
    options.onContextMenu?.({ clientX, clientY, at });
  };

  // Archivos de imagen soltados sobre el lienzo: se suben y se colocan donde cayeron.
  const carriesFiles = (event: DragEvent) => !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  const onDragOver = (event: DragEvent) => {
    if (!options.onDropFiles || !carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = core.readOnly.get() ? 'none' : 'copy';
  };
  const onDrop = (event: DragEvent) => {
    if (!options.onDropFiles || !carriesFiles(event)) return;
    event.preventDefault();
    if (core.readOnly.get()) return;
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    refreshRect();
    const at = core.camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    options.onDropFiles(files, at);
  };

  const unsubscribeCursor = core.controller.cursor.subscribe((cursor) => {
    container.style.cursor = cursor;
  });
  const observer = new ResizeObserver(refreshRect);
  observer.observe(container);

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('drop', onDrop);
  container.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('scroll', refreshRect, true);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);

  return () => {
    unsubscribeCursor();
    observer.disconnect();
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('drop', onDrop);
    container.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('scroll', refreshRect, true);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
  };
}
