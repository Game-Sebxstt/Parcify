import { effectiveDuration, type NodeRecord } from '../../../engine/index.ts';
import { formatNumber } from '../../../lib/format.ts';
import { m } from '../../../paraglide/messages.js';
import { ANIM_PROPS, type Animation, type AnimProp, type Keyframe } from '../../../shared/document/schema.js';

export const ROW_HEIGHT = 28;
export const MIN_SPAN = 1000;
// Píxeles por milisegundo entre los que se mueve el zoom de la regla.
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 2;

export type TimelineKeyframe = { key: string; keyframe: Keyframe; time: number };

export type NodeRow = {
  kind: 'node';
  rowKey: string;
  id: string;
  record: NodeRecord;
  animation: Animation | undefined;
  expanded: boolean;
  // Instantes (ms) con algún keyframe, para el resumen de la fila.
  marks: number[];
  count: number;
};

export type TrackRow = {
  kind: 'track';
  rowKey: string;
  id: string;
  prop: AnimProp;
  record: NodeRecord;
  animation: Animation | undefined;
  keyframes: TimelineKeyframe[];
};

export type Row = NodeRow | TrackRow;

const PROP_LABELS: Record<AnimProp, () => string> = {
  offsetX: m.timeline_prop_offsetX,
  offsetY: m.timeline_prop_offsetY,
  rotation: m.timeline_prop_rotation,
  scale: m.timeline_prop_scale,
  scaleX: m.timeline_prop_scaleX,
  scaleY: m.timeline_prop_scaleY,
  opacity: m.timeline_prop_opacity,
  fill: m.timeline_prop_fill,
  stroke: m.timeline_prop_stroke,
};

export const propLabel = (prop: AnimProp) => PROP_LABELS[prop]();

// Instante del timeline (ms) en que cae un keyframe: dentro de la primera iteración.
export const keyframeAt = (animation: Pick<Animation, 'delay' | 'duration'>, t: number) => animation.delay + t * animation.duration;

// Pistas que admite un nodo: las de color solo si tiene ese color (o ya hay keyframes).
export function propsFor(record: NodeRecord, animation: Animation | undefined): AnimProp[] {
  return ANIM_PROPS.filter((prop) => {
    if (animation?.tracks[prop]) return true;
    if (prop === 'fill') return record.type !== 'line' && typeof (record as { fill?: unknown }).fill === 'string';
    if (prop === 'stroke') return typeof (record as { stroke?: unknown }).stroke === 'string';
    // El reproductor todavía no aplica la escala por eje: no se ofrece una pista que no se vería.
    if (prop === 'scaleX' || prop === 'scaleY') return false;
    return true;
  });
}

export function sortedKeyframes(animation: Animation | undefined, prop: AnimProp): TimelineKeyframe[] {
  const track = animation?.tracks[prop];
  if (!animation || !track) return [];
  return Object.entries(track)
    .map(([key, keyframe]) => ({ key, keyframe, time: keyframeAt(animation, keyframe.t) }))
    .sort((a, b) => a.keyframe.t - b.keyframe.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function buildRows(
  ids: readonly string[],
  record: (id: string) => NodeRecord | undefined,
  animation: (id: string) => Animation | undefined,
  collapsed: ReadonlySet<string>,
): Row[] {
  const rows: Row[] = [];
  for (const id of ids) {
    const node = record(id);
    if (!node || node.type === 'connector') continue;
    const anim = animation(id);
    const tracks = propsFor(node, anim).map((prop): TrackRow => ({
      kind: 'track',
      rowKey: `${id}:${prop}`,
      id,
      prop,
      record: node,
      animation: anim,
      keyframes: sortedKeyframes(anim, prop),
    }));
    const marks = [...new Set(tracks.flatMap((track) => track.keyframes.map((item) => item.time)))].sort((a, b) => a - b);
    const expanded = !collapsed.has(id);
    rows.push({ kind: 'node', rowKey: id, id, record: node, animation: anim, expanded, marks, count: tracks.reduce((sum, track) => sum + track.keyframes.length, 0) });
    if (expanded) rows.push(...tracks);
  }
  return rows;
}

// Lo que mide la regla: al menos un segundo y hasta el final de la animación más larga (una iteración si se repite
// sin fin).
export function spanOf(animations: Iterable<Animation>, head: number): number {
  let span = MIN_SPAN;
  for (const animation of animations) {
    const total = effectiveDuration(animation);
    span = Math.max(span, Number.isFinite(total) ? total : animation.delay + animation.duration);
  }
  return Math.max(span, head);
}

export function formatTime(ms: number): string {
  return `${formatNumber(ms / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
}

// Valor en la unidad del editor: grados para el giro y porcentaje para la opacidad.
export function toDisplay(prop: AnimProp, value: number): number {
  if (prop === 'rotation') return Math.round(((value * 180) / Math.PI) * 100) / 100;
  if (prop === 'opacity') return Math.round(value * 1000) / 10;
  return Math.round(value * 1000) / 1000;
}

export function fromDisplay(prop: AnimProp, value: number): number {
  if (prop === 'rotation') return (value * Math.PI) / 180;
  if (prop === 'opacity') return Math.min(1, Math.max(0, value / 100));
  return value;
}

export function unitOf(prop: AnimProp): string {
  if (prop === 'rotation') return m.timeline_unit_deg();
  if (prop === 'opacity') return m.timeline_unit_percent();
  if (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') return m.timeline_unit_times();
  return m.timeline_unit_px();
}

export function formatValue(prop: AnimProp, value: number | string): string {
  if (typeof value === 'string') return value;
  const shown = formatNumber(toDisplay(prop, value), { maximumFractionDigits: 2 });
  if (prop === 'rotation') return `${shown}°`;
  if (prop === 'opacity') return `${shown} %`;
  if (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') return `${shown}×`;
  return `${shown} px`;
}

// Ticks de la regla: un paso «redondo» que deja al menos 64 px entre marcas.
export function tickStep(zoom: number): number {
  const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  return steps.find((step) => step * zoom >= 64) ?? 60000;
}
