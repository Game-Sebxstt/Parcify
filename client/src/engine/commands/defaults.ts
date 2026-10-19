import type { NodeOf } from '../../shared/document/schema.js';
import type { BasicShapeType, Box, RenderableRecord } from '../types.ts';

export const DEFAULT_FILL = '#D9D9D9FF';
export const DEFAULT_STROKE = '#D9D9D9FF';
export const DEFAULT_SIZE = 100;

type Base = { id: string; pageId: string; parentId: string | null; index: string; createdBy: string };

const style = {
  stroke: null,
  strokeWidth: 1,
  strokeDash: 'solid' as const,
  shadow: null,
};

export function newShape(type: BasicShapeType, base: Base, box: Box): RenderableRecord {
  const common = {
    ...base,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: DEFAULT_FILL,
    ...style,
  };
  switch (type) {
    case 'rect':
      return { ...common, type, cornerRadius: 0 } satisfies NodeOf<'rect'>;
    case 'ellipse':
    case 'triangle':
    case 'diamond':
      return { ...common, type };
    case 'star':
      return { ...common, type, points: 5, innerRatio: 0.5 } satisfies NodeOf<'star'>;
    case 'polygon':
      return { ...common, type, sides: 6 } satisfies NodeOf<'polygon'>;
    case 'arc':
      return { ...common, type, startAngle: 0, endAngle: Math.PI * 1.5, innerRatio: 0 } satisfies NodeOf<'arc'>;
  }
}

export const DEFAULT_TEXT = { fontFamily: 'Manrope', fontSize: 24, lineHeight: 1.25, color: '#EEF2F6FF' } as const;

// Sin ancho, el texto crece con lo que se escribe (autoWidth); con ancho, parte las líneas.
export function newText(base: Base, at: { x: number; y: number }, width: number | null): NodeOf<'text'> {
  return {
    ...base,
    type: 'text',
    x: Math.round(at.x),
    y: Math.round(at.y),
    w: width === null ? 4 : Math.max(8, Math.round(width)),
    h: Math.ceil(DEFAULT_TEXT.fontSize * DEFAULT_TEXT.lineHeight),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fontFamily: DEFAULT_TEXT.fontFamily,
    fontSize: DEFAULT_TEXT.fontSize,
    fontWeight: 400,
    italic: false,
    underline: false,
    strike: false,
    color: DEFAULT_TEXT.color,
    align: 'left',
    lineHeight: DEFAULT_TEXT.lineHeight,
    autoWidth: width === null,
  };
}

export const DEFAULT_CONNECTOR_STROKE = '#EEF2F6FF';

// La caja (x, y, w, h, flipX, flipY) es la de sus extremos al crearlo: ver endpointBox.
export function newConnector(
  base: Base,
  from: NodeOf<'connector'>['from'],
  to: NodeOf<'connector'>['to'],
  box: { x: number; y: number; w: number; h: number; flipX: boolean; flipY: boolean },
  route: NodeOf<'connector'>['route'] = 'elbow',
): NodeOf<'connector'> {
  return {
    ...base,
    type: 'connector',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    ...(box.flipX ? { flipX: true } : {}),
    ...(box.flipY ? { flipY: true } : {}),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: null,
    stroke: DEFAULT_CONNECTOR_STROKE,
    strokeWidth: 2,
    strokeDash: 'solid',
    shadow: null,
    from,
    to,
    route,
    startCap: 'none',
    endCap: 'arrow',
  };
}

// Tamaños habituales de un frame. `id` es lo que se guarda en presetName.
export const FRAME_PRESETS = [
  { id: '16:9', w: 1920, h: 1080 },
  { id: '4:3', w: 1024, h: 768 },
  { id: '1:1', w: 1080, h: 1080 },
  { id: 'A4', w: 794, h: 1123 },
  { id: 'A4-landscape', w: 1123, h: 794 },
  { id: 'letter', w: 816, h: 1056 },
  { id: 'phone', w: 390, h: 844 },
  { id: 'story', w: 1080, h: 1920 },
] as const;

export type FramePresetId = (typeof FRAME_PRESETS)[number]['id'];
export const DEFAULT_FRAME_PRESET: FramePresetId = '16:9';
export const DEFAULT_FRAME_FILL = '#FFFFFFFF';

export function framePreset(id: string): (typeof FRAME_PRESETS)[number] | undefined {
  return FRAME_PRESETS.find((preset) => preset.id === id);
}

export function newFrame(base: Base, box: Box, presetName?: string): NodeOf<'frame'> {
  return {
    ...base,
    type: 'frame',
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.max(1, Math.round(box.w)),
    h: Math.max(1, Math.round(box.h)),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: DEFAULT_FRAME_FILL,
    clip: true,
    ...(presetName ? { presetName } : {}),
  };
}

export function newGroup(base: Base, at: { x: number; y: number }): NodeOf<'group'> {
  return { ...base, type: 'group', x: at.x, y: at.y, w: 0, h: 0, rotation: 0, opacity: 1, visible: true, locked: false };
}

// Las imágenes nuevas caben en esta caja conservando su proporción.
export const IMAGE_MAX_SIDE = 640;

export function newImage(base: Base, assetId: string, box: Box, alt?: string): NodeOf<'image'> {
  return {
    ...base,
    type: 'image',
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.max(1, Math.round(box.w)),
    h: Math.max(1, Math.round(box.h)),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId,
    fit: 'fill',
    cornerRadius: 0,
    ...(alt ? { alt } : {}),
  };
}

// Tamaño inicial de una imagen: su tamaño natural, reducido para caber en IMAGE_MAX_SIDE.
export function imageSize(width: number | null, height: number | null): { w: number; h: number } {
  const w = width && width > 0 ? width : DEFAULT_SIZE * 2;
  const h = height && height > 0 ? height : DEFAULT_SIZE * 2;
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// Una línea guarda sus puntos relativos a (x, y), con la caja ajustada a ellos.
export function newLine(base: Base, from: { x: number; y: number }, to: { x: number; y: number }, arrow: boolean): NodeOf<'line'> {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    ...base,
    type: 'line',
    x,
    y,
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: null,
    stroke: DEFAULT_STROKE,
    strokeWidth: 2,
    strokeDash: 'solid',
    shadow: null,
    points: [
      [from.x - x, from.y - y],
      [to.x - x, to.y - y],
    ],
    startCap: 'none',
    endCap: arrow ? 'arrow' : 'none',
  };
}
