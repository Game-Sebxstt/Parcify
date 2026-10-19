import { apply, invert, type Mat } from './matrix.ts';
import { arcSweep, distanceToPolyline, outline, pointInPolygon } from './shapes.ts';
import { isRenderable, type NodeRecord } from '../types.ts';

function inRoundRect(x: number, y: number, w: number, h: number, radius: number): boolean {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return true;
  const cx = x < r ? r : x > w - r ? w - r : x;
  const cy = y < r ? r : y > h - r ? h - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inEllipse(x: number, y: number, w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false;
  const u = (x - w / 2) / (w / 2);
  const v = (y - h / 2) / (h / 2);
  return u * u + v * v <= 1;
}

function inArc(x: number, y: number, record: Extract<NodeRecord, { type: 'arc' }>): boolean {
  const { w, h } = record;
  if (w <= 0 || h <= 0) return false;
  const u = (x - w / 2) / (w / 2);
  const v = (y - h / 2) / (h / 2);
  const r = Math.hypot(u, v);
  if (r > 1 || r < record.innerRatio) return false;
  const sweep = arcSweep(record.startAngle, record.endAngle);
  if (sweep >= Math.PI * 2) return true;
  const angle = Math.atan2(v, u);
  const delta = (((angle - record.startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return delta <= sweep;
}

function insideFill(record: NodeRecord, x: number, y: number): boolean {
  switch (record.type) {
    case 'rect':
      return inRoundRect(x, y, record.w, record.h, record.cornerRadius);
    case 'ellipse':
      return inEllipse(x, y, record.w, record.h);
    case 'arc':
      return inArc(x, y, record);
    case 'triangle':
    case 'diamond':
    case 'star':
    case 'polygon':
      return pointInPolygon(outline(record).points, x, y);
    default:
      return false;
  }
}

export function insideBox(record: NodeRecord, world: Readonly<Mat>, wx: number, wy: number, tolerance = 0): boolean {
  const local = apply(invert(world), wx, wy);
  return local.x >= -tolerance && local.y >= -tolerance && local.x <= record.w + tolerance && local.y <= record.h + tolerance;
}

// Prueba exacta en coordenadas de mundo. `tolerance` también está en unidades de mundo.
export function hitRecord(record: NodeRecord, world: Readonly<Mat>, wx: number, wy: number, tolerance: number): boolean {
  // Un frame se toca en toda su caja, tenga relleno o no.
  if (record.type === 'frame') return insideBox(record, world, wx, wy, tolerance);
  if (!isRenderable(record)) return false;
  const halfStroke = 'stroke' in record && record.stroke ? record.strokeWidth / 2 : 0;
  // El recorrido de un conector ya está en mundo.
  if (record.type === 'connector') {
    const route = record.path;
    return !!route && route.length >= 4 && distanceToPolyline(route, false, wx, wy) <= tolerance + Math.max(halfStroke, 0.5);
  }
  // Las matrices del motor solo giran y voltean: las distancias locales y de mundo coinciden.
  const local = apply(invert(world), wx, wy);
  if (record.type === 'line') {
    return distanceToPolyline(record.points.flat(), false, local.x, local.y) <= tolerance + Math.max(halfStroke, 0.5);
  }
  // Un texto o una imagen se tocan por su caja.
  if (record.type === 'text' || record.type === 'image') {
    return local.x >= -tolerance && local.y >= -tolerance && local.x <= record.w + tolerance && local.y <= record.h + tolerance;
  }
  if (record.fill && insideFill(record, local.x, local.y)) return true;
  // Sin relleno (o justo fuera) cuenta el contorno con la tolerancia.
  const { points, closed } = outline(record);
  return distanceToPolyline(points, closed, local.x, local.y) <= tolerance + halfStroke;
}
