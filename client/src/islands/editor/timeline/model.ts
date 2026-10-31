import { effectiveDuration, type KeyRef, type NodeRecord } from '../../../engine/index.ts';
import { formatNumber } from '../../../lib/format.ts';
import { m } from '../../../paraglide/messages.js';
import { ANIM_PROPS, type Animation, type AnimProp, type Keyframe } from '../../../shared/document/schema.js';
import { animatable } from '../properties/panel.ts';

export const MIN_SPAN = 1000;
// Píxeles por milisegundo entre los que se mueve el zoom de la regla.
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 2;
// Columna de nombres y alto de la regla.
export const LABEL_WIDTH = 200;
// En la hoja del móvil la columna cabe el plegado, ▶ y ⋯ de 44 px y el nombre.
export const LABEL_WIDTH_SHEET = 216;
export const RULER_HEIGHT = 24;
// Margen antes del instante 0: un keyframe en 0 no queda medio tapado por la columna de nombres.
export const LANE_PAD = 8;
// Posición en la pista (px) de un instante (ms).
export const timeX = (ms: number, zoom: number) => LANE_PAD + ms * zoom;
// Alto de las filas: con el dedo crecen para que los rombos y los botones se puedan tocar.
// En la hoja del móvil, las filas de nodo llevan botones de 44 px.
const ROW_HEIGHTS = { mouse: { node: 28, track: 24 }, touch: { node: 36, track: 32 }, sheet: { node: 44, track: 32 } } as const;

export type TimelineKeyframe = { key: string; keyframe: Keyframe; time: number };

export type NodeRow = {
  kind: 'node';
  rowKey: string;
  id: string;
  record: NodeRecord;
  animation: Animation | undefined;
  expanded: boolean;
  // Instantes (ms) con algún keyframe y los keyframes de cada uno, para el resumen de la fila plegada.
  marks: Array<{ ms: number; refs: KeyRef[] }>;
  count: number;
  // Pistas que se pueden añadir desde el menú de la fila: las animables que aún no tienen keyframes.
  addable: AnimProp[];
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

const hasData = (animation: Animation | undefined, prop: AnimProp) => Object.keys(animation?.tracks[prop] ?? {}).length > 0;

export function sortedKeyframes(animation: Animation | undefined, prop: AnimProp): TimelineKeyframe[] {
  const track = animation?.tracks[prop];
  if (!animation || !track) return [];
  return Object.entries(track)
    .map(([key, keyframe]) => ({ key, keyframe, time: keyframeAt(animation, keyframe.t) }))
    .sort((a, b) => a.keyframe.t - b.keyframe.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Una fila por nodo y, debajo, solo las pistas que tienen keyframes.
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
    const tracks = ANIM_PROPS.filter((prop) => hasData(anim, prop)).map((prop): TrackRow => ({
      kind: 'track',
      rowKey: `${id}:${prop}`,
      id,
      prop,
      record: node,
      animation: anim,
      keyframes: sortedKeyframes(anim, prop),
    }));
    const grouped = new Map<number, KeyRef[]>();
    for (const track of tracks) {
      for (const item of track.keyframes) grouped.set(item.time, [...(grouped.get(item.time) ?? []), { nodeId: id, prop: track.prop, key: item.key }]);
    }
    const marks = [...grouped].map(([ms, refs]) => ({ ms, refs })).sort((a, b) => a.ms - b.ms);
    const addable = ANIM_PROPS.filter((prop) => !hasData(anim, prop) && animatable(node, prop));
    const expanded = !collapsed.has(id);
    const count = tracks.reduce((sum, track) => sum + track.keyframes.length, 0);
    rows.push({ kind: 'node', rowKey: id, id, record: node, animation: anim, expanded, marks, count, addable });
    if (expanded) rows.push(...tracks);
  }
  return rows;
}

export const rowHeight = (row: Row, touch: boolean | 'sheet') => ROW_HEIGHTS[touch === 'sheet' ? 'sheet' : touch ? 'touch' : 'mouse'][row.kind];

// Posición vertical de cada fila: offsets[i] es su borde superior y offsets[n], el alto total.
export function rowOffsets(heights: readonly number[]): number[] {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets[offsets.length - 1]! + height);
  return offsets;
}

// Filas que hay que pintar para un scroll y un alto de vista, con margen arriba y abajo.
export function visibleRows(offsets: readonly number[], scrollTop: number, height: number, overscan = 6): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  let low = 0;
  let high = count - 1;
  const top = Math.max(0, scrollTop);
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= top) low = middle;
    else high = middle - 1;
  }
  let end = low;
  while (end < count && offsets[end]! < top + Math.max(height, 1)) end++;
  return { start: Math.max(0, low - overscan), end: Math.min(count, end + overscan) };
}

// Lo que mide la regla: al menos un segundo y hasta el final de la animación más larga (una iteración si se repite
// sin fin).
export function spanOf(animations: Iterable<Pick<Animation, 'delay' | 'duration' | 'loop'>>, head: number): number {
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

// Etiquetas de la regla: sin ceros de más («0,5 s», «1 s»).
export function formatRulerTime(ms: number): string {
  return `${formatNumber(ms / 1000, { maximumFractionDigits: 2 })} s`;
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

// Unidad corta junto al campo de valor de la pista.
export function shortUnitOf(prop: AnimProp): string {
  if (prop === 'rotation') return '°';
  if (prop === 'opacity') return '%';
  if (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') return '×';
  return '';
}

export function stepOf(prop: AnimProp): number {
  return prop === 'scale' || prop === 'scaleX' || prop === 'scaleY' ? 0.01 : 1;
}

export function formatValue(prop: AnimProp, value: number | string): string {
  if (typeof value === 'string') return value;
  const shown = formatNumber(toDisplay(prop, value), { maximumFractionDigits: 2 });
  if (prop === 'rotation') return `${shown}°`;
  if (prop === 'opacity') return `${shown} %`;
  if (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') return `${shown}×`;
  return `${shown} px`;
}

// Pasos de la regla: etiquetas entre 50 ms y 5 s, con marcas intermedias. Se toma el primero que deja al menos
// LABEL_GAP píxeles entre etiquetas.
const TICK_STEPS: ReadonlyArray<{ label: number; minor: number }> = [
  { label: 50, minor: 10 },
  { label: 100, minor: 20 },
  { label: 200, minor: 50 },
  { label: 500, minor: 100 },
  { label: 1000, minor: 200 },
  { label: 2000, minor: 500 },
  { label: 5000, minor: 1000 },
];
const LABEL_GAP = 112;

export function tickSteps(zoom: number): { label: number; minor: number } {
  return TICK_STEPS.find((step) => step.label * zoom >= LABEL_GAP) ?? TICK_STEPS[TICK_STEPS.length - 1]!;
}

// Marcas de la regla entre dos instantes (ms); `label` las que llevan texto.
export function rulerTicks(zoom: number, fromMs: number, toMs: number): Array<{ ms: number; label: boolean }> {
  const { label, minor } = tickSteps(zoom);
  const ticks: Array<{ ms: number; label: boolean }> = [];
  const first = Math.max(0, Math.floor(fromMs / minor) * minor);
  for (let ms = first; ms <= toMs && ticks.length < 2000; ms += minor) ticks.push({ ms, label: ms % label === 0 });
  return ticks;
}

export const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(value) ? value : MIN_ZOOM));

// El slider de zoom va de 0 a 100 en escala logarítmica: cada tramo igual del slider multiplica el zoom por lo mismo.
const ZOOM_RANGE = Math.log(MAX_ZOOM / MIN_ZOOM);
export const zoomToSlider = (zoom: number) => Math.round((Math.log(clampZoom(zoom) / MIN_ZOOM) / ZOOM_RANGE) * 100);
export const sliderToZoom = (value: number) => clampZoom(MIN_ZOOM * Math.exp((Math.min(100, Math.max(0, value)) / 100) * ZOOM_RANGE));
