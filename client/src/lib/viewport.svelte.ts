import { on } from 'svelte/events';
import { createSubscriber } from 'svelte/reactivity';

export type ViewportMode = 'mobile' | 'tablet' | 'desktop';

export const TABLET_MIN_WIDTH = 640;
export const DESKTOP_MIN_WIDTH = 1024;

export function modeFor(width: number): ViewportMode {
  if (width < TABLET_MIN_WIDTH) return 'mobile';
  return width < DESKTOP_MIN_WIDTH ? 'tablet' : 'desktop';
}

// Tamaño de la ventana, puntero grueso y alto del teclado virtual. Se lee con reactividad dentro de efectos y
// plantillas; fuera de ellos devuelve el valor del momento.
export class Viewport {
  readonly #subscribe = createSubscriber((update) => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const offs = [on(window, 'resize', update), on(coarse, 'change', update)];
    const visual = window.visualViewport;
    if (visual) offs.push(on(visual, 'resize', update), on(visual, 'scroll', update));
    return () => {
      for (const off of offs) off();
    };
  });

  get width(): number {
    this.#subscribe();
    return window.innerWidth;
  }

  get height(): number {
    this.#subscribe();
    return window.innerHeight;
  }

  get mode(): ViewportMode {
    return modeFor(this.width);
  }

  get coarse(): boolean {
    this.#subscribe();
    return window.matchMedia('(pointer: coarse)').matches;
  }

  get keyboardInset(): number {
    this.#subscribe();
    const visual = window.visualViewport;
    if (!visual) return 0;
    return Math.max(0, window.innerHeight - visual.height - visual.offsetTop);
  }
}
