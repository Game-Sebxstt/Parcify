import { describe, expect, it } from 'vitest';
import { DOCUMENT_LIMITS } from '../../src/shared/document/limits.js';
import {
  AnimationSchema,
  MetaSchema,
  NODE_TYPES,
  NodeSchema,
  PageSchema,
  TextContentSchema,
  type NodeType,
} from '../../src/shared/document/schema.js';

const ID = 'V1StGXR8_Z5jdHi6B-myT';
const PAGE = 'pg1StGXR8_Z5jdHi6B-my';

const base = {
  id: ID,
  pageId: PAGE,
  parentId: null,
  index: 'a0',
  x: 10,
  y: 20,
  w: 100,
  h: 50,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  createdBy: 'user_1',
};

const style = { fill: '#FF6B4AFF', stroke: null, strokeWidth: 1, strokeDash: 'solid', shadow: null };

const valid: Record<NodeType, Record<string, unknown>> = {
  rect: { ...base, ...style, type: 'rect', cornerRadius: 8 },
  ellipse: { ...base, ...style, type: 'ellipse' },
  triangle: { ...base, ...style, type: 'triangle' },
  diamond: { ...base, ...style, type: 'diamond' },
  star: { ...base, ...style, type: 'star', points: 5, innerRatio: 0.5 },
  polygon: { ...base, ...style, type: 'polygon', sides: 6 },
  arc: { ...base, ...style, type: 'arc', startAngle: 0, endAngle: Math.PI, innerRatio: 0 },
  line: { ...base, ...style, type: 'line', points: [[0, 0], [100, 50]], startCap: 'none', endCap: 'arrow' },
  connector: {
    ...base,
    ...style,
    type: 'connector',
    from: { nodeId: ID, anchor: 'right' },
    to: { x: 300, y: 40 },
    route: 'elbow',
    startCap: 'none',
    endCap: 'arrow',
  },
  text: {
    ...base,
    type: 'text',
    fontFamily: 'Manrope',
    fontSize: 16,
    fontWeight: 400,
    italic: false,
    underline: false,
    strike: false,
    color: '#FFFFFFFF',
    align: 'left',
    lineHeight: 1.4,
    autoWidth: true,
  },
  image: {
    ...base,
    type: 'image',
    assetId: '0199e2f0-8a5b-7c3d-9e4f-0123456789ab',
    fit: 'cover',
    cornerRadius: 0,
    alt: 'Logo',
  },
  group: { ...base, type: 'group', w: 0, h: 0 },
  frame: { ...base, type: 'frame', fill: '#141416FF', clip: true, presetName: '16:9' },
};

function ok(value: unknown) {
  return NodeSchema.safeParse(value).success;
}

describe('NodeSchema', () => {
  it.each(NODE_TYPES)('acepta un nodo %s válido', (type) => {
    expect(ok(valid[type])).toBe(true);
  });

  it('acepta las propiedades label* en formas', () => {
    expect(
      ok({ ...valid.rect, labelFontSize: 14, labelColor: '#000000FF', labelAlign: 'center', labelVAlign: 'middle' }),
    ).toBe(true);
    expect(ok({ ...valid.rect, labelVAlign: 'centro' })).toBe(false);
  });

  it('acepta los valores en el límite', () => {
    const limit = DOCUMENT_LIMITS.maxCoordinate;
    expect(ok({ ...valid.ellipse, x: limit, y: -limit, w: 0, h: DOCUMENT_LIMITS.maxSize })).toBe(true);
    expect(ok({ ...valid.ellipse, rotation: Math.PI, opacity: 0 })).toBe(true);
    expect(ok({ ...valid.rect, w: 100, h: 50, cornerRadius: 25 })).toBe(true);
    expect(ok({ ...valid.star, points: 64, innerRatio: 0.95 })).toBe(true);
    expect(ok({ ...valid.ellipse, strokeWidth: 200, shadow: { x: 0, y: 2, blur: 100, color: '#00000080' } })).toBe(true);
    expect(ok({ ...valid.text, fontSize: 800, lineHeight: 3 })).toBe(true);
    const points = Array.from({ length: DOCUMENT_LIMITS.maxPoints }, (_, i) => [i, i]);
    expect(ok({ ...valid.line, points })).toBe(true);
    expect(ok({ ...valid.ellipse, name: 'n'.repeat(80) })).toBe(true);
  });

  it('rechaza valores fuera de límite', () => {
    expect(ok({ ...valid.ellipse, x: DOCUMENT_LIMITS.maxCoordinate + 1 })).toBe(false);
    expect(ok({ ...valid.ellipse, w: -1 })).toBe(false);
    expect(ok({ ...valid.ellipse, x: Number.NaN })).toBe(false);
    expect(ok({ ...valid.ellipse, x: Number.POSITIVE_INFINITY })).toBe(false);
    expect(ok({ ...valid.ellipse, rotation: 4 })).toBe(false);
    expect(ok({ ...valid.ellipse, opacity: 1.1 })).toBe(false);
    expect(ok({ ...valid.ellipse, strokeWidth: 201 })).toBe(false);
    expect(ok({ ...valid.ellipse, name: 'n'.repeat(81) })).toBe(false);
    expect(ok({ ...valid.ellipse, shadow: { x: 0, y: 0, blur: 101, color: '#00000080' } })).toBe(false);
  });

  it('rechaza un tipo desconocido o un id con formato inválido', () => {
    expect(ok({ ...valid.rect, type: 'hexagon' })).toBe(false);
    expect(ok({ ...valid.rect, id: 'corto' })).toBe(false);
    expect(ok({ ...valid.rect, parentId: 'corto' })).toBe(false);
  });

  it('rechaza colores que no son #RRGGBBAA', () => {
    expect(ok({ ...valid.ellipse, fill: '#FF6B4A' })).toBe(false);
    expect(ok({ ...valid.ellipse, fill: 'red' })).toBe(false);
  });

  it('valida cada tipo con sus propias reglas', () => {
    expect(ok({ ...valid.rect, cornerRadius: 26 })).toBe(false);
    expect(ok({ ...valid.star, points: 2 })).toBe(false);
    expect(ok({ ...valid.star, innerRatio: 0.05 })).toBe(false);
    expect(ok({ ...valid.polygon, sides: 65 })).toBe(false);
    expect(ok({ ...valid.polygon, sides: undefined })).toBe(false);
    expect(ok({ ...valid.polygon, sides: undefined, vertices: [[0, 0], [1, 0], [0.5, 1]] })).toBe(true);
    expect(ok({ ...valid.polygon, vertices: [[0, 0], [1, 0], [0.5, 1]] })).toBe(false);
    expect(ok({ ...valid.polygon, sides: undefined, vertices: [[0, 0], [2, 0], [0.5, 1]] })).toBe(false);
    expect(ok({ ...valid.arc, innerRatio: 0.96 })).toBe(false);
    expect(ok({ ...valid.line, points: [[0, 0]] })).toBe(false);
    expect(ok({ ...valid.line, points: Array.from({ length: 513 }, () => [0, 0]) })).toBe(false);
    expect(ok({ ...valid.line, endCap: 'flecha' })).toBe(false);
    expect(ok({ ...valid.connector, from: { nodeId: ID, anchor: { u: 0.5, v: 1 } } })).toBe(true);
    expect(ok({ ...valid.connector, from: { nodeId: ID, anchor: { u: 2, v: 0 } } })).toBe(false);
    expect(ok({ ...valid.connector, route: 'smart' })).toBe(false);
    expect(ok({ ...valid.text, fontFamily: 'Comic Sans' })).toBe(false);
    expect(ok({ ...valid.text, fontWeight: 450 })).toBe(false);
    expect(ok({ ...valid.text, fontSize: 3 })).toBe(false);
    expect(ok({ ...valid.text, lineHeight: 0.7 })).toBe(false);
    expect(ok({ ...valid.image, assetId: 'no-uuid' })).toBe(false);
    expect(ok({ ...valid.image, crop: { x: 0, y: 0, w: 1.5, h: 1 } })).toBe(false);
    expect(ok({ ...valid.image, alt: 'a'.repeat(301) })).toBe(false);
    expect(ok({ ...valid.group, w: 10 })).toBe(false);
    expect(ok({ ...valid.frame, clip: 'sí' })).toBe(false);
  });

  it('rechaza nodos sin claves requeridas', () => {
    const { pageId: _pageId, ...missing } = valid.rect;
    expect(ok(missing)).toBe(false);
  });
});

describe('PageSchema, MetaSchema y textos', () => {
  it('valida páginas y meta', () => {
    expect(PageSchema.safeParse({ name: 'Página 1', index: 'a0' }).success).toBe(true);
    expect(PageSchema.safeParse({ name: '', index: 'a0' }).success).toBe(false);
    expect(MetaSchema.safeParse({ schemaVersion: 1, createdAt: 0, background: '#141416FF' }).success).toBe(true);
    expect(MetaSchema.safeParse({ schemaVersion: 0, createdAt: 0, background: '#141416FF' }).success).toBe(false);
  });

  it('limita la longitud de los textos', () => {
    expect(TextContentSchema.safeParse('a'.repeat(DOCUMENT_LIMITS.maxTextLength)).success).toBe(true);
    expect(TextContentSchema.safeParse('a'.repeat(DOCUMENT_LIMITS.maxTextLength + 1)).success).toBe(false);
  });
});

describe('AnimationSchema', () => {
  const animation = {
    duration: 1000,
    delay: 0,
    loop: 1,
    direction: 'normal',
    autoplay: 'present',
    tracks: {
      offsetX: { k1: { t: 0, v: 0, e: 'linear' }, k2: { t: 1, v: 120, e: [0.4, 0, 0.2, 1] } },
      fill: { k3: { t: 0.5, v: '#FF6B4AFF', e: 'step' } },
    },
  };

  it('acepta una animación válida', () => {
    expect(AnimationSchema.safeParse(animation).success).toBe(true);
  });

  it('acepta los límites de duración, retraso, repeticiones y keyframes', () => {
    const track = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, { t: i / 63, v: i, e: 'linear' }]));
    expect(
      AnimationSchema.safeParse({ ...animation, duration: 60_000, delay: 60_000, loop: 100, tracks: { scale: track } })
        .success,
    ).toBe(true);
    expect(AnimationSchema.safeParse({ ...animation, duration: 100, loop: 0 }).success).toBe(true);
  });

  it('rechaza valores fuera de límite y tipos incorrectos', () => {
    expect(AnimationSchema.safeParse({ ...animation, duration: 99 }).success).toBe(false);
    expect(AnimationSchema.safeParse({ ...animation, loop: 101 }).success).toBe(false);
    expect(AnimationSchema.safeParse({ ...animation, direction: 'reverse' }).success).toBe(false);
    expect(AnimationSchema.safeParse({ ...animation, tracks: { blur: {} } }).success).toBe(false);
    expect(
      AnimationSchema.safeParse({ ...animation, tracks: { opacity: { k: { t: 0, v: '#FFFFFFFF', e: 'linear' } } } })
        .success,
    ).toBe(false);
    expect(
      AnimationSchema.safeParse({ ...animation, tracks: { fill: { k: { t: 0, v: 1, e: 'linear' } } } }).success,
    ).toBe(false);
    expect(
      AnimationSchema.safeParse({ ...animation, tracks: { offsetX: { k: { t: 1.2, v: 0, e: 'linear' } } } }).success,
    ).toBe(false);
    const track = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, { t: 0, v: i, e: 'linear' }]));
    expect(AnimationSchema.safeParse({ ...animation, tracks: { scale: track } }).success).toBe(false);
  });
});
