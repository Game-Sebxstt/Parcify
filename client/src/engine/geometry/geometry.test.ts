import { describe, expect, it } from 'vitest';
import { NodeSchema } from '../../shared/document/schema.js';
import { rect } from '../test-utils.ts';
import type { NodeRecord } from '../types.ts';
import { INPUT_PROFILES } from '../interaction/input/profile.ts';
import { normalizeDeg, snapRotation, toDeg, toRad } from './angles.ts';
import { geometryAABB, localMatrix, paintedAABB, paintPadding, translatedPlacement } from './bounds.ts';
import { hitRecord } from './hit.ts';
import { apply, compose, invert, multiply, rotateAround, scaleAround, translation } from './matrix.ts';
import { nearestCandidate, SnapCandidates, snapBox } from './snapping.ts';
import { applyPatch, transformPatch } from './transform.ts';

const node = (overrides: Record<string, unknown> = {}) => NodeSchema.parse(rect(overrides)) as NodeRecord;
const shape = (type: string, extra: Record<string, unknown> = {}) => NodeSchema.parse({ ...rect({ w: 100, h: 100 }), type, ...extra }) as NodeRecord;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('matrices', () => {
  it('invert deshace multiply', () => {
    const m = compose(translation(10, 20), rotateAround(5, 5, 0.7), scaleAround(0, 0, 2, 3));
    const p = apply(multiply(invert(m), m), 7, -3);
    close(p.x, 7);
    close(p.y, -3);
  });

  it('la matriz local gira alrededor del centro de la caja', () => {
    const m = localMatrix({ x: 0, y: 0, w: 100, h: 50, rotation: Math.PI / 2 });
    const center = apply(m, 50, 25);
    close(center.x, 50);
    close(center.y, 25);
    const corner = apply(m, 0, 0);
    close(corner.x, 75);
    close(corner.y, -25);
  });

  it('desplazar la colocación da lo mismo que recalcularla, con giro, volteo y padre girado', () => {
    const parents = [null, compose(translation(300, -40), rotateAround(0, 0, 0.6)), compose(translation(-20, 10), rotateAround(5, 5, -2.1), scaleAround(0, 0, -1, 1))];
    const records = [
      node({ x: 10, y: 20, w: 80, h: 30 }),
      node({ x: 3.5, y: -7.25, w: 60, h: 90, rotation: 1.1, flipX: true, stroke: '#000000FF', strokeWidth: 6 }),
      NodeSchema.parse({ ...rect({ x: 5, y: 5, w: 40, h: 20, rotation: -0.4 }), type: 'line', points: [[0, 0], [40, 20], [10, 35]], fill: null, stroke: '#000000FF', strokeWidth: 3, startCap: 'none', endCap: 'arrow' }) as NodeRecord,
    ];
    for (const parent of parents) {
      for (const record of records) {
        const full = (r: NodeRecord) => {
          const world = parent ? multiply(parent, localMatrix(r)) : localMatrix(r);
          return { world, geometry: geometryAABB(r, world), painted: paintedAABB(r, world) };
        };
        const start = full(record);
        const base = { x: record.x, y: record.y, rotation: record.rotation, world: start.world, geometry: start.geometry, pad: paintPadding(record) };
        const moved = { ...record, x: record.x + 37.3, y: record.y - 12.9 } as NodeRecord;
        const expected = full(moved);
        const actual = translatedPlacement(base, moved, parent);
        actual.world.forEach((value, i) => close(value, expected.world[i]!));
        for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
          close(actual.geometry[key], expected.geometry[key]);
          close(actual.painted[key], expected.painted[key]);
        }
      }
    }
  });

  it('la AABB de una caja girada envuelve las esquinas y suma el trazo', () => {
    const record = node({ rotation: Math.PI / 4, stroke: '#000000FF', strokeWidth: 4 });
    const world = localMatrix(record);
    const geo = geometryAABB(record, world);
    const painted = paintedAABB(record, world);
    const half = (Math.SQRT2 * 150) / 4;
    close(geo.maxX - geo.minX, half * 2);
    close(painted.minX, geo.minX - 2);
  });
});

describe('hit-test exacto', () => {
  const at = (record: NodeRecord, x: number, y: number, tolerance = 0) => hitRecord(record, localMatrix(record), x, y, tolerance);

  it('rect con esquinas redondeadas no acierta en la esquina', () => {
    const record = node({ w: 100, h: 100, cornerRadius: 30 });
    expect(at(record, 50, 50)).toBe(true);
    expect(at(record, 2, 2)).toBe(false);
  });

  it('elipse, triángulo, rombo, estrella, polígono y arco', () => {
    expect(at(shape('ellipse'), 50, 50)).toBe(true);
    expect(at(shape('ellipse'), 5, 5)).toBe(false);
    expect(at(shape('triangle'), 50, 80)).toBe(true);
    expect(at(shape('triangle'), 5, 5)).toBe(false);
    expect(at(shape('diamond'), 50, 50)).toBe(true);
    expect(at(shape('diamond'), 10, 10)).toBe(false);
    expect(at(shape('star', { points: 5, innerRatio: 0.4 }), 50, 50)).toBe(true);
    expect(at(shape('star', { points: 5, innerRatio: 0.4 }), 5, 95)).toBe(false);
    expect(at(shape('polygon', { sides: 6 }), 50, 50)).toBe(true);
    const arc = shape('arc', { startAngle: 0, endAngle: Math.PI / 2, innerRatio: 0 });
    expect(at(arc, 75, 75)).toBe(true);
    expect(at(arc, 25, 25)).toBe(false);
    const ring = shape('arc', { startAngle: 0, endAngle: Math.PI * 2, innerRatio: 0.5 });
    expect(at(ring, 50, 50)).toBe(false);
    expect(at(ring, 50, 90)).toBe(true);
  });

  it('una forma sin relleno solo acierta en el contorno, con tolerancia', () => {
    const record = node({ fill: null, stroke: '#000000FF', strokeWidth: 2 });
    expect(at(record, 50, 25)).toBe(false);
    expect(at(record, 50, 0.5)).toBe(true);
    expect(at(record, 50, -4, 4)).toBe(true);
  });

  it('línea por distancia al segmento', () => {
    const line = NodeSchema.parse({ ...rect(), type: 'line', fill: null, stroke: '#000000FF', strokeWidth: 2, points: [[0, 0], [100, 100]], startCap: 'none', endCap: 'none', w: 100, h: 100 }) as NodeRecord;
    expect(at(line, 50, 52, 2)).toBe(true);
    expect(at(line, 50, 70, 4)).toBe(false);
  });

  it('respeta la rotación', () => {
    const record = node({ w: 200, h: 20, rotation: Math.PI / 2 });
    expect(at(record, 100, 10)).toBe(true);
    expect(at(record, 100, -80)).toBe(true);
    expect(at(record, 10, 10)).toBe(false);
  });
});

describe('commitTransform: matriz → propiedades', () => {
  it('una traslación solo cambia x e y', () => {
    expect(transformPatch(node({ x: 10, y: 20 }), translation(5, -5))).toEqual({ x: 15, y: 15 });
  });

  it('una escala cambia w y h y conserva la esquina fija', () => {
    const record = node({ x: 0, y: 0, w: 100, h: 50 });
    const patch = transformPatch(record, scaleAround(0, 0, 2, 3));
    expect(patch).toMatchObject({ x: 0, y: 0, w: 200, h: 150 });
    close(patch.rotation!, 0);
  });

  it('un giro alrededor del centro cambia solo la rotación', () => {
    const record = node({ x: 0, y: 0, w: 100, h: 50 });
    const patch = transformPatch(record, rotateAround(50, 25, 0.5));
    close(patch.x!, 0);
    close(patch.y!, 0);
    close(patch.rotation!, 0.5);
  });

  it('escalar en negativo voltea y respeta el mínimo de 1 px', () => {
    const record = node({ w: 100, h: 50 });
    const flipped = transformPatch(record, scaleAround(0, 25, 1, -1));
    expect(flipped.flipY).toBe(true);
    expect(transformPatch(record, scaleAround(0, 0, 0, 0))).toMatchObject({ w: 1, h: 1 });
  });

  it('recorta el radio de esquina al encoger', () => {
    const record = node({ w: 100, h: 100, cornerRadius: 40 });
    const patch = transformPatch(record, scaleAround(0, 0, 0.5, 0.5));
    expect(patch.cornerRadius).toBe(25);
    expect(NodeSchema.safeParse(applyPatch(record, patch)).success).toBe(true);
  });

  it('el resultado reproduce la caja transformada', () => {
    const record = node({ x: 30, y: 40, w: 80, h: 60, rotation: 0.3 });
    const m = compose(rotateAround(100, 100, 0.8), scaleAround(30, 40, 1.5, 0.75, 0.3));
    const next = applyPatch(record, transformPatch(record, m));
    const expected = multiply(m, localMatrix(record));
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      const a = apply(expected, u * record.w, v * record.h);
      const b = apply(localMatrix(next), u * next.w, v * next.h);
      expect(a.x).toBeCloseTo(b.x, 2);
      expect(a.y).toBeCloseTo(b.y, 2);
    }
  });

  it('en una línea transforma los puntos', () => {
    const line = NodeSchema.parse({ ...rect(), type: 'line', fill: null, stroke: '#000000FF', points: [[0, 0], [100, 0]], startCap: 'none', endCap: 'arrow', w: 100, h: 0 }) as NodeRecord;
    const patch = transformPatch(line, rotateAround(50, 0, Math.PI / 2));
    expect(patch.points!.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([[0, 0], [0, 100]]);
    expect(patch).toMatchObject({ x: 50, y: -50, w: 0, h: 100 });
  });
});

describe('snapping', () => {
  it('búsqueda binaria del candidato más cercano', () => {
    const sorted = [1, 5, 9, 20].map((value) => ({ value }));
    expect(nearestCandidate(sorted, 6)?.value).toBe(5);
    expect(nearestCandidate(sorted, 15)?.value).toBe(20);
    expect(nearestCandidate(sorted, -10)?.value).toBe(1);
    expect(nearestCandidate([], 3)).toBeNull();
  });

  it('ajusta al borde o al centro más cercano dentro del umbral', () => {
    const candidates = new SnapCandidates([{ minX: 100, minY: 0, maxX: 200, maxY: 50 }]);
    const result = snapBox({ minX: 204, minY: 300, maxX: 254, maxY: 350 }, candidates, 6);
    expect(result.dx).toBe(-4);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({ axis: 'x', value: 200 });
  });

  it('fuera del umbral no ajusta', () => {
    const candidates = new SnapCandidates([{ minX: 100, minY: 0, maxX: 200, maxY: 50 }]);
    expect(snapBox({ minX: 220, minY: 300, maxX: 260, maxY: 340 }, candidates, 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('con miles de candidatos sigue eligiendo el exacto', () => {
    const boxes = Array.from({ length: 5000 }, (_, i) => ({ minX: i * 10, minY: 0, maxX: i * 10 + 5, maxY: 5 }));
    const candidates = new SnapCandidates(boxes);
    expect(candidates.size).toBe(5000);
    // El centro de la caja 1230–1235 (1232,5) queda a 0,5 del borde izquierdo: gana a los demás.
    const result = snapBox({ minX: 1233, minY: 1000, maxX: 1236, maxY: 1003 }, candidates, 3);
    expect(1233 + result.dx).toBe(1232.5);
  });
});

describe('imán de rotación', () => {
  const mouse = { shift: false, ctrl: false, thresholdDeg: INPUT_PROFILES.mouse.rotateSnapDeg };
  const touch = { shift: false, ctrl: false, thresholdDeg: INPUT_PROFILES.touch.rotateSnapDeg };

  it('se imanta a 45° cerca de un múltiplo y no lejos', () => {
    expect(snapRotation(43.5, mouse)).toEqual({ angle: 45, snapped: true });
    expect(snapRotation(41, mouse)).toEqual({ angle: 41, snapped: false });
    expect(snapRotation(47, touch)).toEqual({ angle: 45, snapped: true });
    expect(snapRotation(-2, mouse)).toEqual({ angle: 0, snapped: true });
  });

  it('Shift va en pasos de 15° y Ctrl desactiva el imán', () => {
    expect(snapRotation(41, { ...mouse, shift: true })).toEqual({ angle: 45, snapped: true });
    expect(snapRotation(44, { ...mouse, ctrl: true })).toEqual({ angle: 44, snapped: false });
  });

  it('normaliza a (−180°, 180°] y redondea a 0,1°', () => {
    expect(snapRotation(182, { ...mouse, ctrl: true })).toEqual({ angle: -178, snapped: false });
    expect(snapRotation(190, mouse)).toEqual({ angle: -170, snapped: false });
    expect(snapRotation(-180, mouse)).toEqual({ angle: 180, snapped: true });
    expect(snapRotation(12.345, mouse)).toEqual({ angle: 12.3, snapped: false });
    expect(normalizeDeg(540)).toBe(180);
    expect(normalizeDeg(-190)).toBe(170);
    expect(Object.is(normalizeDeg(-360), 0)).toBe(true);
    expect(toDeg(toRad(37))).toBeCloseTo(37, 9);
  });
});
