export type WindowRect = { x: number; y: number; w: number; h: number };
export type WindowSize = { w: number; h: number };

// Distancia mínima de una ventana flotante a cada borde de la vista.
export const WINDOW_MARGIN = 8;
// Una ventana no pasa de la vista menos esto (16 px por lado).
const WINDOW_INSET = 32;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Lo más grande que puede ser una ventana en una vista: la vista menos 32, o menos los dos márgenes si así no cabe
// ni el tamaño mínimo.
function cap(view: number, min: number): number {
  const inset = view - WINDOW_INSET;
  return inset >= min ? inset : Math.max(0, view - 2 * WINDOW_MARGIN);
}

// Ajusta la ventana a la vista: tamaño entre el mínimo y el máximo, y x ∈ [8, vw − w − 8], y ∈ [8, vh − h − 8].
export function clampRect(rect: WindowRect, view: WindowSize, min: WindowSize): WindowRect {
  const maxW = cap(view.w, min.w);
  const maxH = cap(view.h, min.h);
  const w = clamp(rect.w, Math.min(min.w, maxW), maxW);
  const h = clamp(rect.h, Math.min(min.h, maxH), maxH);
  const x = clamp(rect.x, WINDOW_MARGIN, Math.max(WINDOW_MARGIN, view.w - w - WINDOW_MARGIN));
  const y = clamp(rect.y, WINDOW_MARGIN, Math.max(WINDOW_MARGIN, view.h - h - WINDOW_MARGIN));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export type ResizeEdge = 'left' | 'top' | 'corner';

// Redimensionar por el borde izquierdo o el superior deja quieto el borde opuesto: lo que crece es hacia fuera.
export function resizeRect(start: WindowRect, edge: ResizeEdge, dx: number, dy: number, view: WindowSize, min: WindowSize): WindowRect {
  const next = { ...start };
  if (edge === 'left' || edge === 'corner') {
    const right = start.x + start.w;
    const w = clamp(start.w - dx, Math.min(min.w, cap(view.w, min.w)), Math.min(cap(view.w, min.w), right - WINDOW_MARGIN));
    next.x = right - w;
    next.w = w;
  }
  if (edge === 'top' || edge === 'corner') {
    const bottom = start.y + start.h;
    const h = clamp(start.h - dy, Math.min(min.h, cap(view.h, min.h)), Math.min(cap(view.h, min.h), bottom - WINDOW_MARGIN));
    next.y = bottom - h;
    next.h = h;
  }
  return clampRect(next, view, min);
}

// La última ventana tocada queda por encima de las demás.
class WindowStack {
  front = $state('');

  raise(id: string) {
    this.front = id;
  }
}

export const windowStack = new WindowStack();
