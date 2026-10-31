import { MediaQuery } from 'svelte/reactivity';

// Puntero principal grueso (un dedo). Los diálogos y popovers van en un portal, fuera de las hojas del móvil: con este
// valor ponen data-touch-density="touch" y sus controles toman los tamaños táctiles de la variante `sheet:`.
let coarse: MediaQuery | null = null;

export function touchDensity(): 'touch' | undefined {
  // Sin matchMedia (el servidor, jsdom) se queda en la densidad normal.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  coarse ??= new MediaQuery('(pointer: coarse)', false);
  return coarse.current ? 'touch' : undefined;
}
