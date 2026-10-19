import { Container, Graphics, Matrix } from 'pixi.js';
import type { Mat } from '../../geometry/matrix.ts';
import { dashPattern, dashSegments, outline, polygonPoints, starPolygon, arcPolygon, arcSweep } from '../../geometry/shapes.ts';
import { layoutOf } from '../../text/layout.ts';
import type { ConnectorRecord, LineRecord, RenderableRecord, ShapeRecord } from '../../types.ts';
import { parseColor } from '../color.ts';
import { ImageView, type ImageSlot } from './ImageView.ts';
import { TextView } from './TextView.ts';

const scratch = new Matrix();

// Propiedades que no cambian el dibujo: se aplican con la transformación o se ignoran.
const TRANSFORM_KEYS = new Set(['x', 'y', 'rotation', 'flipX', 'flipY', 'index', 'name', 'locked', 'createdBy', 'pageId', 'parentId', 'visible', 'opacity', 'id']);

export function needsRedraw(prev: RenderableRecord | null, next: RenderableRecord): boolean {
  if (prev === next) return false;
  if (!prev || prev.type !== next.type) return true;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  for (const key in b) {
    const before = a[key];
    const after = b[key];
    // Comparar primero evita la búsqueda en el Set en las claves que no cambian, que son casi todas.
    if (before === after || TRANSFORM_KEYS.has(key)) continue;
    if (Array.isArray(before) && Array.isArray(after) && typeof after[0] === 'number') {
      if (sameNumbers(before as number[], after as number[])) continue;
      return true;
    }
    if (typeof before === 'object' && typeof after === 'object' && before && after && JSON.stringify(before) === JSON.stringify(after)) continue;
    return true;
  }
  for (const key in a) {
    if (!(key in b) && !TRANSFORM_KEYS.has(key)) return true;
  }
  return false;
}

// El recorrido de un conector: comparar los números evita serializar dos arrays en cada movimiento.
function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Una vista por nodo, reciclable entre tipos: el Graphics de la forma y, si hace falta, su texto encima.
export class ShapeView {
  readonly root = new Container();
  readonly graphics = new Graphics();
  textView: TextView | null = null;
  imageView: ImageView | null = null;
  drawn: RenderableRecord | null = null;
  // Recorrido del conector dibujado: la vista previa de un gesto reutiliza su registro y solo cambia `path`.
  private drawnPath: readonly number[] | undefined;
  drawnText = '';
  hiddenSince = 0;
  // Trazo de línea que Pixi ya tiene convertido en este Graphics (clear() lo conserva): si es el mismo, stroke()
  // sin argumentos lo reutiliza y no vuelve a convertir el estilo en cada redibujo.
  private lineStyleKey: string | null = null;

  constructor() {
    this.root.eventMode = 'none';
    this.root.interactiveChildren = false;
    this.root.addChild(this.graphics);
    this.graphics.eventMode = 'none';
    // En «auto» Pixi deja fuera del batch las formas de más de 200 vértices (elipses, estrellas con trazo),
    // y cada una cuesta una llamada de dibujo. Las formas son pequeñas: se agrupan siempre.
    this.graphics.context.batchMode = 'batch';
  }

  // El mismo objeto puede llegar con otro recorrido (vista previa mutable de un conector).
  needsDraw(record: RenderableRecord): boolean {
    if (record === this.drawn && record.type === 'connector') return !sameNumbers(this.drawnPath ?? [], record.path ?? []);
    return needsRedraw(this.drawn, record);
  }

  draw(record: RenderableRecord, image: ImageSlot = { kind: 'loading' }): void {
    const g = this.graphics;
    g.clear();
    this.drawn = record;
    this.drawnPath = record.type === 'connector' ? record.path : undefined;
    if (this.imageView) this.imageView.drawnKey = '';
    if (record.type === 'line') {
      this.lineStyleKey = drawLine(g, record, record.points.flat(), this.lineStyleKey);
      return;
    }
    if (record.type === 'connector') {
      this.lineStyleKey = drawLine(g, record, record.path ?? [], this.lineStyleKey);
      return;
    }
    this.lineStyleKey = null;
    if (record.type === 'image') {
      this.imageView ??= new ImageView(g, this.root);
      this.imageView.draw(record, image);
      return;
    }
    this.root.label = '';
    if (record.type === 'text') return;
    if (record.shadow) {
      const shadow = parseColor(record.shadow.color);
      const { x, y, blur } = record.shadow;
      // Aproximación barata del desenfoque: el contorno con un trazo ancho y translúcido.
      shapePath(g, record, x, y);
      g.fill({ color: shadow.color, alpha: shadow.alpha * (blur > 0 ? 0.55 : 1) });
      if (blur > 0) {
        shapePath(g, record, x, y);
        g.stroke({ width: blur, color: shadow.color, alpha: shadow.alpha * 0.25, alignment: 0.5, join: 'round' });
      }
    }
    if (record.fill) {
      shapePath(g, record, 0, 0);
      const fill = parseColor(record.fill);
      g.fill({ color: fill.color, alpha: fill.alpha });
      if (record.type === 'arc' && record.innerRatio > 0 && arcSweep(record.startAngle, record.endAngle) >= Math.PI * 2) {
        g.ellipse(record.w / 2, record.h / 2, (record.w / 2) * record.innerRatio, (record.h / 2) * record.innerRatio).cut();
      }
    }
    if (record.stroke && record.strokeWidth > 0) {
      const stroke = parseColor(record.stroke);
      const pattern = dashPattern(record.strokeDash, record.strokeWidth);
      const style = {
        width: record.strokeWidth,
        color: stroke.color,
        alpha: stroke.alpha,
        alignment: 0.5,
        join: 'round' as const,
        cap: (record.strokeDash === 'dotted' ? 'round' : 'butt') as 'round' | 'butt',
      };
      if (pattern) {
        const { points, closed } = outline(record);
        g.beginPath();
        for (const segment of dashSegments(points, closed, pattern[0], pattern[1])) polyline(g, segment);
        g.stroke(style);
      } else {
        shapePath(g, record, 0, 0);
        g.stroke(style);
      }
    }
  }

  // Texto propio o interior. Devuelve una promesa si espera a su fuente.
  drawText(record: RenderableRecord, content: string, resolution: number, hidden: boolean): Promise<void> | null {
    this.drawnText = content;
    const layout = layoutOf(record, content);
    if (!layout) {
      this.textView?.clear();
      return null;
    }
    if (!this.textView) {
      this.textView = new TextView();
      this.root.addChild(this.textView.container);
    }
    const waiting = this.textView.update(layout, resolution);
    if (hidden) this.textView.container.visible = false;
    return waiting;
  }

  setTextHidden(hidden: boolean): void {
    if (this.textView) this.textView.container.visible = !hidden && this.textView.active;
  }

  // La vista no tiene giro, escala ni sesgo (se lleva aquí para no leer los getters de Pixi en cada movimiento).
  private plain = true;

  setWorld(matrix: Readonly<Mat>, alpha: number): void {
    const g = this.root;
    // Traslación pura sobre una vista sin giro ni escala: basta con la posición, sin descomponer la matriz.
    if (matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1) {
      if (this.plain) g.position.set(matrix[4], matrix[5]);
      else {
        g.position.set(matrix[4], matrix[5]);
        g.rotation = 0;
        g.scale.set(1, 1);
        g.skew.set(0, 0);
        this.plain = true;
      }
    } else {
      scratch.set(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      g.setFromMatrix(scratch);
      this.plain = false;
    }
    if (g.alpha !== alpha) g.alpha = alpha;
  }

  reset(): void {
    this.graphics.clear();
    this.textView?.clear();
    if (this.imageView) this.imageView.drawnKey = '';
    this.root.label = '';
    this.drawn = null;
    this.drawnPath = undefined;
    this.drawnText = '';
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

type PathTarget = { moveTo(x: number, y: number): unknown; lineTo(x: number, y: number): unknown };

function polyline(g: PathTarget, points: readonly number[]): void {
  g.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
}

function shapePath(g: Graphics, record: ShapeRecord, ox: number, oy: number): void {
  const { w, h } = record;
  g.beginPath();
  switch (record.type) {
    case 'rect':
      if (record.cornerRadius > 0) g.roundRect(ox, oy, w, h, Math.min(record.cornerRadius, w / 2, h / 2));
      else g.rect(ox, oy, w, h);
      return;
    case 'ellipse':
      g.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2);
      return;
    case 'triangle':
      g.poly([ox + w / 2, oy, ox + w, oy + h, ox, oy + h], true);
      return;
    case 'diamond':
      g.poly([ox + w / 2, oy, ox + w, oy + h / 2, ox + w / 2, oy + h, ox, oy + h / 2], true);
      return;
    case 'star':
      g.poly(offset(starPolygon(w, h, record.points, record.innerRatio), ox, oy), true);
      return;
    case 'polygon':
      g.poly(offset(polygonPoints(record), ox, oy), true);
      return;
    case 'arc':
      if (arcSweep(record.startAngle, record.endAngle) >= Math.PI * 2) g.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2);
      else g.poly(offset(arcPolygon(w, h, record.startAngle, record.endAngle, record.innerRatio), ox, oy), true);
      return;
  }
}

function offset(points: number[], ox: number, oy: number): number[] {
  if (ox === 0 && oy === 0) return points;
  return points.map((value, i) => value + (i % 2 === 0 ? ox : oy));
}

// Polilínea abierta con sus extremos: las líneas en coordenadas locales y los conectores en mundo.
// Devuelve la clave del trazo que queda como estilo actual del Graphics.
function drawLine(g: Graphics, record: LineRecord | ConnectorRecord, points: readonly number[], styleKey: string | null): string | null {
  if (!record.stroke || record.strokeWidth <= 0 || points.length < 4) return styleKey;
  const stroke = parseColor(record.stroke);
  const width = record.strokeWidth;
  const pattern = dashPattern(record.strokeDash, width);
  const key = `${record.stroke}|${width}`;
  // El recorrido va directo al contexto: los métodos de Graphics solo lo reenvían, copiando los argumentos.
  const path = g.context;
  g.beginPath();
  if (pattern) for (const segment of dashSegments(points, false, pattern[0], pattern[1])) polyline(path, segment);
  else polyline(path, points);

  // Las puntas de trazo van en el mismo trazo que la línea: cada subtrazo se tesela aparte, igual que con dos
  // llamadas, pero Pixi rehace una instrucción en vez de dos.
  const n = points.length;
  const at = (i: number) => [points[i * 2]!, points[i * 2 + 1]!] as const;
  const caps: Array<[typeof record.endCap, readonly [number, number], readonly [number, number]]> = [
    [record.startCap, at(0), at(1)],
    [record.endCap, at(n / 2 - 1), at(n / 2 - 2)],
  ];
  const size = Math.max(8, width * 4);
  for (const [cap, tip, prev] of caps) {
    if (cap !== 'arrow' && cap !== 'bar') continue;
    const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    const [tx, ty] = tip;
    if (cap === 'arrow') {
      const spread = Math.PI / 6;
      g.moveTo(tx - size * Math.cos(angle - spread), ty - size * Math.sin(angle - spread))
        .lineTo(tx, ty)
        .lineTo(tx - size * Math.cos(angle + spread), ty - size * Math.sin(angle + spread));
    } else {
      const half = size / 2;
      const nx = -Math.sin(angle) * half;
      const ny = Math.cos(angle) * half;
      g.moveTo(tx + nx, ty + ny).lineTo(tx - nx, ty - ny);
    }
  }
  if (key === styleKey) g.stroke();
  else g.stroke({ width, color: stroke.color, alpha: stroke.alpha, join: 'round', cap: 'round' });

  for (const [cap, tip, prev] of caps) {
    if (cap !== 'triangle' && cap !== 'circle') continue;
    const [tx, ty] = tip;
    g.beginPath();
    if (cap === 'triangle') {
      const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
      const spread = Math.PI / 7;
      g.poly([tx, ty, tx - size * Math.cos(angle - spread), ty - size * Math.sin(angle - spread), tx - size * Math.cos(angle + spread), ty - size * Math.sin(angle + spread)], true).fill({
        color: stroke.color,
        alpha: stroke.alpha,
      });
    } else {
      g.circle(tx, ty, Math.max(3, width * 1.6)).fill({ color: stroke.color, alpha: stroke.alpha });
    }
  }
  return key;
}
