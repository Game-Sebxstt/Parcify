import type { EditorCore } from '../EditorCore.ts';
import type { PointerInput } from './PointerController.ts';
import type { KeyInput } from './shortcuts.ts';
import { readTransfer, type ClipboardController } from './clipboard.ts';
import { TEXT_EDITOR_ATTR } from '../text/TextEditor.ts';
import { classifyWheel, type WheelAction, type WheelPreference, type WheelSample } from './input/wheel.ts';
import { GestureRouter } from './input/GestureRouter.ts';
import { toPointerKind, type PointerKind } from './input/profile.ts';
import { bindSafariGestures } from './input/safari-gestures.ts';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function toWheelSample(event: WheelEvent, rect: { left: number; top: number }): WheelSample {
  return {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? 2 : 0,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

// Los gestos de cámara nunca tocan el documento; cualquiera de ellos deja de seguir a otro y anula el encuadre pendiente.
export function applyWheel(core: EditorCore, action: WheelAction): void {
  if (action.kind === 'ignore') return;
  core.stopFollowing();
  core.markUserCamera();
  if (action.kind === 'zoom') core.camera.zoomAt(action.x, action.y, action.factor);
  else core.camera.panBy(action.dx, action.dy);
  core.requestFrame();
}

// Los widgets con teclado propio (el árbol de capas, la lista de páginas) llevan este atributo.
export const OWN_KEYS_ATTR = 'data-own-keys';
// Las zonas que gestionan su propia rueda (cada lienzo, las pistas de la línea de tiempo) llevan este atributo: fuera de
// ellas, el editor anula Ctrl/⌘+rueda para que el pellizco no haga zoom de la página.
export const OWN_WHEEL_ATTR = 'data-own-wheel';
// Superposiciones que tapan el lienzo con otro lienzo (la vista previa de una versión): con el foco dentro, el teclado
// y el portapapeles no llegan al editor de debajo.
export const OWN_STAGE_ATTR = 'data-own-stage';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// Dónde se abrió el menú contextual: en la ventana (para colocarlo) y en la página (para pegar ahí). pointerType dice
// si llegó del ratón (o del teclado), del lápiz o de una pulsación larga con el dedo.
export type ContextMenuRequest = { clientX: number; clientY: number; at: { x: number; y: number }; pointerType: PointerKind };

export type DomOptions = {
  embedded?: boolean;
  // 'page': la rueda sin Ctrl/⌘ se deja al navegador para que desplace la página. 'canvas': toda rueda es del lienzo.
  wheel?: 'canvas' | 'page';
  // El motor no lee localStorage: la preferencia de la rueda del ratón llega desde fuera.
  wheelPref?: () => WheelPreference;
  // Movimiento reducido (sistema o cuenta): sin inercia tras los gestos de dos dedos.
  reducedMotion?: () => boolean;
  onDropFiles?: (files: File[], at: { x: number; y: number }) => void;
  onContextMenu?: (request: ContextMenuRequest) => void;
};

// Un único conjunto de listeners sobre el contenedor del lienzo; Pixi no escucha eventos.
export function bindDom(core: EditorCore, container: HTMLElement, clipboard: ClipboardController, options: DomOptions = {}): () => void {
  // Incrustado, el teclado y el portapapeles solo cuentan con el foco dentro del lienzo.
  const outside = (event: Event) =>
    options.embedded === true
      ? !container.contains(event.target as Node | null)
      : event.target instanceof Element && event.target.closest(`[${OWN_STAGE_ATTR}]`) !== null;
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
    pointerType: toPointerKind(event.pointerType),
    pressure: event.pressure,
  });

  const toKey = (event: KeyboardEvent): KeyInput => ({
    key: event.key,
    code: event.code,
    ctrl: MAC ? event.metaKey : event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    repeat: event.repeat,
  });

  // Tipo y botón del último pointerdown: tras uno con el dedo o con la punta del lápiz, el contextmenu nativo de la
  // pulsación larga se descarta. El botón lateral del lápiz (2) sigue abriendo el menú por la vía nativa.
  let lastDownKind: PointerKind = 'mouse';
  let lastDownButton = 0;

  // Dentro de una página que se desplaza (la landing), el dedo es de la página: sin dos dedos ni gestos de Safari.
  // La vista previa de versiones, incrustada pero con la rueda propia, sí hace pan y zoom con dos dedos.
  const inScrollingPage = options.embedded === true && options.wheel === 'page';
  const router = new GestureRouter(core, {
    embedded: inScrollingPage,
    ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
    stopTextEdit: () => {
      if (!core.editingText.get()) return;
      core.stopTextEdit();
      // Con el dedo el contenedor no tomó el foco al tocar, para no cerrar el teclado: lo toma ahora.
      if (document.activeElement !== container) container.focus({ preventScroll: true });
    },
    ...(options.onContextMenu
      ? {
          onLongPress: (input: PointerInput) => {
            const at = core.controller.contextMenu({ x: input.x, y: input.y });
            options.onContextMenu?.({ clientX: rect.left + input.x, clientY: rect.top + input.y, at, pointerType: input.pointerType });
          },
        }
      : {}),
  });

  const onPointerDown = (event: PointerEvent) => {
    // Dentro del editor de texto, el puntero mueve el caret; fuera, confirma la edición (lo decide el enrutador).
    if (event.target instanceof Element && event.target.closest(`[${TEXT_EDITOR_ATTR}]`)) return;
    // Cualquier toque o clic en el lienzo detiene la vista previa de animaciones antes de hacer lo suyo.
    if (core.anim.previewActive) core.anim.preview(null);
    lastDownKind = toPointerKind(event.pointerType);
    lastDownButton = event.button;
    refreshRect();
    // Mientras se edita un texto con el dedo, el foco se queda en el texto para no esconder el teclado.
    const keepTextFocus = lastDownKind === 'touch' && core.editingText.get() !== null;
    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // Los eventos sintéticos no tienen un puntero activo que capturar.
    }
    // Con el dedo, sin los eventos de ratón de compatibilidad: su mousedown llevaría el foco al lienzo después de que el
    // toque abriera el editor de texto, y el teclado virtual se cerraría.
    if (event.button === 1 || lastDownKind === 'touch') event.preventDefault();
    router.down(toInput(event));
    if (!keepTextFocus && document.activeElement !== container) container.focus({ preventScroll: true });
  };
  const inEditor = (event: Event) => event.target instanceof Element && event.target.closest(`[${TEXT_EDITOR_ATTR}]`) !== null;
  const onPointerMove = (event: PointerEvent) => router.move(toInput(event));
  const releaseCapture = (event: PointerEvent) => {
    try {
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    } catch {
      // Sin captura que soltar.
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (inEditor(event) && core.controller.state === 'idle') return;
    releaseCapture(event);
    router.up(toInput(event));
  };
  const onPointerCancel = (event: PointerEvent) => {
    releaseCapture(event);
    router.cancel(toInput(event));
  };
  const onPointerLeave = (event: PointerEvent) => router.leave(event.buttons);
  const onWheel = (event: WheelEvent) => {
    if (options.wheel === 'page' && !(event.ctrlKey || event.metaKey)) return;
    // También con `ignore`: un pellizco sobre el lienzo nunca hace zoom de la página.
    event.preventDefault();
    router.stopInertia();
    const action = classifyWheel(toWheelSample(event, rect), {
      isMac: MAC,
      pref: options.wheelPref?.() ?? 'pan',
      gestureActive: router.gestureActive,
      viewportHeight: rect.height,
    });
    applyWheel(core, action);
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
  const onBlur = () => {
    core.controller.blur();
    router.reset();
  };

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
    // Android y Windows Ink lanzan contextmenu en su propia pulsación larga: el menú ya lo abre el enrutador.
    if (lastDownKind === 'touch' || (lastDownKind === 'pen' && lastDownButton === 0)) return;
    if (core.editingText.get()) core.stopTextEdit();
    refreshRect();
    const at = core.controller.contextMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    options.onContextMenu({ clientX: event.clientX, clientY: event.clientY, at, pointerType: lastDownKind });
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
    options.onContextMenu?.({ clientX, clientY, at, pointerType: 'mouse' });
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
  container.setAttribute(OWN_WHEEL_ATTR, '');
  const unbindSafari = inScrollingPage ? () => {} : bindSafariGestures(container, core, router);

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('pointerleave', onPointerLeave);
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
    unbindSafari();
    router.reset();
    container.removeAttribute(OWN_WHEEL_ATTR);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
    container.removeEventListener('pointerleave', onPointerLeave);
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
