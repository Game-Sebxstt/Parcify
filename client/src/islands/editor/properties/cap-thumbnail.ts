import { decorateLine, type CapKind } from '../../../engine/geometry/arrowheads.ts';

const fmt = (value: number) => String(Math.round(value * 100) / 100);

// Miniatura SVG (40×16 px) de un extremo con el grosor del trazo: un tramo horizontal que acaba en la punta, dibujado
// con las mismas puntas que el lienzo. La punta se dibuja a su tamaño máximo para ese grosor, así que la proporción
// entre el trazo y la punta es la que se verá en una línea larga.
export function capThumbnail(cap: CapKind, side: 'start' | 'end', strokeWidth: number): string {
  const sw = Math.max(0.5, Math.min(strokeWidth || 1, 50));
  const length = 10 + 3 * sw;
  const height = 1.2 * length + sw;
  const width = height * 2.5;
  const y = height / 2;
  const inset = sw / 2 + length * 0.05;
  // El trazo entra desde fuera del lado contrario a la punta.
  const tip = side === 'end' ? width - inset : inset;
  const tail = side === 'end' ? -sw : width + sw;
  const points = side === 'end' ? [tail, y, tip, y] : [tip, y, tail, y];
  const { path, heads } = decorateLine({ startCap: side === 'start' ? cap : 'none', endCap: side === 'end' ? cap : 'none', strokeWidth: sw }, points);
  const stroke = `stroke="currentColor" stroke-width="${fmt(sw)}" stroke-linecap="round" stroke-linejoin="round"`;
  let body = path.length >= 4 ? `<path d="M${fmt(path[0]!)} ${fmt(path[1]!)}L${fmt(path[path.length - 2]!)} ${fmt(path[path.length - 1]!)}" ${stroke}/>` : '';
  for (const head of heads) {
    const list = head.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
    if (head.type === 'polyline' || head.type === 'segment') body += `<polyline points="${list}" ${stroke}/>`;
    else if (head.type === 'polygon') body += `<polygon points="${list}" fill="currentColor"/>`;
    else body += `<circle cx="${fmt(head.points[0]!.x)}" cy="${fmt(head.points[0]!.y)}" r="${fmt(head.radius ?? 0)}" fill="currentColor"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="40" height="16" fill="none" aria-hidden="true" data-cap="${cap}">${body}</svg>`;
}
