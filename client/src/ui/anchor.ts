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
  // Distancia a cada borde de la ventana que el elemento no debe pisar (paneles, barras de abajo).
  padding?: number | Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  // Márgenes con los que el rectángulo cuenta como fuera de la vista y el elemento se oculta. Por defecto los de
  // `padding`; una franja que el elemento no debe pisar no tiene por qué esconder lo que hay debajo.
  hidePadding?: number | Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
};

// Coloca `el` (position: fixed) junto a un rectángulo en coordenadas de la ventana. Se llama cada vez que el motor
// publica un rectángulo nuevo, en vez de dejar un autoUpdate escuchando. Si no cabe ni a un lado ni al otro (una
// selección más alta que la vista), se mete dentro del área permitida aunque tape parte del rectángulo.
export async function placeOverCanvas(el: HTMLElement, rect: Rect, opts: PlaceOptions = {}): Promise<void> {
  const reference = virtualAnchor(() => new DOMRect(rect.x, rect.y, rect.width, rect.height));
  const padding = opts.padding ?? 8;
  const { x, y, middlewareData } = await computePosition(reference, el, {
    strategy: 'fixed',
    placement: opts.placement ?? 'top',
    middleware: [offset(opts.gap ?? 8), flip({ padding }), shift({ padding, crossAxis: true }), hide({ padding: opts.hidePadding ?? padding })],
  });
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.visibility = middlewareData.hide?.referenceHidden ? 'hidden' : '';
}
