import { computePosition, flip, hide, offset, shift, type Placement } from '@floating-ui/dom';

export type Rect = { x: number; y: number; width: number; height: number };

// Sirve como `customAnchor` de bits-ui y como referencia de computePosition.
export type VirtualAnchor = { getBoundingClientRect: () => DOMRect };

// Elemento virtual para anclar un popover a algo que no es del DOM (un punto o una caja del lienzo, el caret).
export function virtualAnchor(getRect: () => DOMRect): VirtualAnchor {
  return { getBoundingClientRect: getRect };
}

// Ancla de 1×1 en un punto de la ventana.
export function pointAnchor(x: number, y: number): VirtualAnchor {
  return virtualAnchor(() => new DOMRect(x, y, 1, 1));
}

export type PlaceOptions = {
  placement?: Placement;
  gap?: number;
  padding?: number;
};

// Coloca `el` (position: fixed) junto a un rectángulo en coordenadas de la ventana. Se llama cada vez que el motor
// publica un rectángulo nuevo, en vez de dejar un autoUpdate escuchando.
export async function placeOverCanvas(el: HTMLElement, rect: Rect, opts: PlaceOptions = {}): Promise<void> {
  const reference = virtualAnchor(() => new DOMRect(rect.x, rect.y, rect.width, rect.height));
  const padding = opts.padding ?? 8;
  const { x, y, middlewareData } = await computePosition(reference, el, {
    strategy: 'fixed',
    placement: opts.placement ?? 'top',
    middleware: [offset(opts.gap ?? 8), flip({ padding }), shift({ padding }), hide({ padding })],
  });
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.visibility = middlewareData.hide?.referenceHidden ? 'hidden' : '';
}
