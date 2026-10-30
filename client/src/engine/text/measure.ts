import { CanvasTextMetrics, TextStyle } from 'pixi.js';
import { textStyleOf } from '../render/views/TextView.ts';
import type { TextRecord } from '../types.ts';
import { fontReady, loadFont } from './fonts.ts';
import { layoutOf } from './layout.ts';

// Sin canvas 2D (Node, jsdom) no hay con qué medir. Se comprueba una sola vez.
let measurable: boolean | null = null;
function canMeasure(): boolean {
  if (measurable === null) {
    measurable = typeof document !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined' && document.createElement('canvas').getContext('2d') !== null;
  }
  return measurable;
}

function endsInEmptyLine(content: string): boolean {
  const last = content.lastIndexOf('\n');
  return last >= 0 && content.slice(last + 1).trimEnd().length === 0;
}

// Caja de un texto según su contenido, medida con el mismo estilo con el que TextView lo pinta: es la única fuente de
// w y h de un texto. En auto-ancho, w es lo que ocupa la línea más larga; con ancho fijo, w no cambia y el alto sale del
// reparto en líneas. Devuelve null si aún no se puede medir (la fuente no ha cargado o no hay canvas): la caja actual
// se mantiene, y quien la necesite vuelve a medir cuando onFontLoad avise.
export function measureTextBox(record: TextRecord, content: string): { w: number; h: number } | null {
  if (!canMeasure()) return null;
  const layout = layoutOf(record, content);
  if (!layout) return null;
  if (!fontReady(layout.family, layout.italic)) {
    void loadFont(layout.family, layout.italic);
    return null;
  }
  try {
    const metrics = CanvasTextMetrics.measureText(content, new TextStyle(textStyleOf(layout)));
    // Al partir líneas, Pixi descarta la última si queda vacía; el editor sí la enseña, con el caret en ella.
    const height = metrics.height + (!record.autoWidth && endsInEmptyLine(content) ? layout.size * layout.lineHeight : 0);
    return { w: record.autoWidth ? Math.max(1, Math.ceil(metrics.width)) : record.w, h: Math.max(1, Math.ceil(height)) };
  } catch {
    return null;
  }
}
