import type { Attachment } from 'svelte/attachments';

export type LongPressPoint = { clientX: number; clientY: number; pointerType: 'touch' | 'pen'; target: EventTarget | null };

type Options = { ms?: number; slop?: number };

// Pulsación larga con el dedo o el lápiz, para usar con {@attach longPress(...)}. El ratón ya tiene el clic derecho.
export function longPress(handler: (point: LongPressPoint) => void, { ms = 500, slop = 8 }: Options = {}): Attachment<HTMLElement> {
  return (node) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pointerId: number | null = null;
    let start = { x: 0, y: 0 };
    let fired = false;
    // Tras un pointerdown táctil (o de la punta del lápiz), el contextmenu nativo que Android y Windows Ink lanzan en
    // su propia pulsación larga se descarta: el menú ya lo abre este gesto.
    let suppressNative = false;

    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pointerId = null;
    };

    const onDown = (event: PointerEvent) => {
      const touchLike = event.pointerType === 'touch' || (event.pointerType === 'pen' && event.button === 0);
      suppressNative = touchLike;
      // Un segundo dedo convierte el gesto en otra cosa (pellizco, desplazamiento).
      if (pointerId !== null) {
        cancel();
        return;
      }
      fired = false;
      if (!touchLike) return;
      pointerId = event.pointerId;
      start = { x: event.clientX, y: event.clientY };
      const point: LongPressPoint = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerType: event.pointerType as 'touch' | 'pen',
        target: event.target,
      };
      timer = setTimeout(() => {
        timer = null;
        pointerId = null;
        fired = true;
        navigator.vibrate?.(10);
        handler(point);
      }, ms);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > slop) cancel();
    };

    const onEnd = (event: PointerEvent) => {
      if (event.pointerId === pointerId) cancel();
    };

    // Si el menú se abrió, el toque no cuenta además como clic sobre el elemento.
    const onClick = (event: MouseEvent) => {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!suppressNative) return;
      event.preventDefault();
      event.stopPropagation();
    };

    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onEnd);
    node.addEventListener('pointercancel', onEnd);
    node.addEventListener('click', onClick, true);
    node.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      cancel();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onEnd);
      node.removeEventListener('pointercancel', onEnd);
      node.removeEventListener('click', onClick, true);
      node.removeEventListener('contextmenu', onContextMenu, true);
    };
  };
}
