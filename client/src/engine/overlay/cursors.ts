import type { CornerName } from './handles.ts';

// Cursor de giro: flecha curva de doble punta que rodea la esquina. El SVG base abraza la esquina superior
// derecha cuando se gira 45°; cada esquina suma 90° y el ángulo de la forma se suma encima.
const CORNER_TURNS: Record<CornerName, number> = { ne: 0, se: 1, sw: 2, nw: 3 };
const STEP_DEG = 15;
const STEPS = 360 / STEP_DEG;

const cache = new Map<number, string>();

function svg(degrees: number): string {
  const arc = 'M6.5 13 A8 8 0 0 1 17.5 13';
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>` +
    `<g transform='rotate(${degrees} 12 12)'>` +
    `<path d='${arc}' fill='none' stroke='#000B1D' stroke-width='5'/>` +
    `<path d='${arc}' fill='none' stroke='#EEF2F6' stroke-width='2'/>` +
    `<path d='M3.6 15.8 L4.4 10.8 L8.6 15.2 Z M20.4 15.8 L19.6 10.8 L15.4 15.2 Z' fill='#EEF2F6' stroke='#000B1D' stroke-width='1.5' stroke-linejoin='round'/>` +
    `</g></svg>`
  );
}

// `angle` en radianes (el de la caja en pantalla). Se redondea a pasos de 15°: 24 variantes, cacheadas. Si el
// navegador no admite cursores SVG queda `grab`.
export function rotateCursor(corner: CornerName, angle: number): string {
  const degrees = 45 + 90 * CORNER_TURNS[corner] + (angle * 180) / Math.PI;
  const step = (((Math.round(degrees / STEP_DEG) % STEPS) + STEPS) % STEPS);
  let cursor = cache.get(step);
  if (!cursor) {
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg(step * STEP_DEG))}") 12 12, grab`;
    cache.set(step, cursor);
  }
  return cursor;
}
