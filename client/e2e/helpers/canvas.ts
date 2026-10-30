import type { Page } from '@playwright/test';

export type Area = { x: number; y: number; width: number; height: number };

// El lienzo ocupa toda la ventana y los paneles flotan encima: esta es la parte que no tapa nada (entre los paneles
// abiertos, por debajo de las pastillas y los avisos y por encima de las barras de abajo). En px de la página.
export function canvasGap(page: Page): Promise<Area> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[role="application"]')!.getBoundingClientRect();
    const openPanel = (testid: string) => {
      const panel = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
      return panel && !panel.hidden && panel.dataset.state === 'open' ? panel.getBoundingClientRect() : null;
    };
    const left = openPanel('left-panel');
    const right = openPanel('right-panel');
    const x = left ? left.right + 8 : canvas.left;
    const end = right ? right.left - 8 : canvas.right;
    const top = canvas.top + 56;
    const bottom = canvas.bottom - 72;
    return { x, y: top, width: end - x, height: bottom - top };
  });
}
