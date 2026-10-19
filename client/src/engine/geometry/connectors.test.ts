import { describe, expect, it } from 'vitest';
import { localMatrix } from './bounds.ts';
import { anchorAt, anchorTerminal, anchorUnit, endpointBox, endpointsFromBox, routePoints, type Terminal } from './connectors.ts';
import { imagePlacement, textureAffine } from './image.ts';
import { apply } from './matrix.ts';

const free = (x: number, y: number): Terminal => ({ x, y, dir: null });

function segments(points: number[]): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 2; i < points.length; i += 2) out.push([points[i - 2]!, points[i - 1]!, points[i]!, points[i + 1]!]);
  return out;
}

describe('anclas', () => {
  it('las anclas con nombre caen en el centro de cada lado con su normal hacia fuera', () => {
    const world = localMatrix({ x: 100, y: 50, w: 80, h: 40, rotation: 0 });
    const bounds = { minX: 100, minY: 50, maxX: 180, maxY: 90 };
    expect(anchorTerminal(world, 80, 40, 'top')).toEqual({ x: 140, y: 50, dir: { x: 0, y: -1 }, bounds });
    expect(anchorTerminal(world, 80, 40, 'right')).toEqual({ x: 180, y: 70, dir: { x: 1, y: 0 }, bounds });
    expect(anchorTerminal(world, 80, 40, 'bottom')).toEqual({ x: 140, y: 90, dir: { x: 0, y: 1 }, bounds });
    expect(anchorTerminal(world, 80, 40, 'left')).toEqual({ x: 100, y: 70, dir: { x: -1, y: 0 }, bounds });
    expect(anchorTerminal(world, 80, 40, 'center')).toEqual({ x: 140, y: 70, dir: null });
  });

  it('un ancla {u, v} sale por el lado más cercano', () => {
    expect(anchorUnit({ u: 0.9, v: 0.5 }).normal).toEqual({ x: 1, y: 0 });
    expect(anchorUnit({ u: 0.4, v: 0.05 }).normal).toEqual({ x: 0, y: -1 });
    const world = localMatrix({ x: 0, y: 0, w: 100, h: 100, rotation: 0 });
    expect(anchorTerminal(world, 100, 100, { u: 0.25, v: 1 })).toMatchObject({ x: 25, y: 100, dir: { x: 0, y: 1 } });
  });

  it('el ancla sigue a la caja al girar: el lado derecho girado 90° mira hacia abajo', () => {
    const world = localMatrix({ x: 0, y: 0, w: 100, h: 50, rotation: Math.PI / 2 });
    const right = anchorTerminal(world, 100, 50, 'right');
    // Centro en (50, 25); el punto (100, 25) gira a (50, 75).
    expect(right.x).toBeCloseTo(50);
    expect(right.y).toBeCloseTo(75);
    expect(right.dir!.x).toBeCloseTo(0);
    expect(right.dir!.y).toBeCloseTo(1);
  });

  it('anchorAt se pega al ancla con nombre cercana y si no da la posición relativa', () => {
    const world = localMatrix({ x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(anchorAt(world, 100, 50, { x: 97, y: 26 }, 12)).toBe('right');
    expect(anchorAt(world, 100, 50, { x: 30, y: 10 }, 5)).toEqual({ u: 0.3, v: 0.2 });
  });
});

describe('ruteo', () => {
  it('recto: dos puntos', () => {
    expect(routePoints(free(0, 0), free(100, 50), 'straight')).toEqual([0, 0, 100, 50]);
  });

  it('codo entre dos lados enfrentados: tres segmentos ortogonales con el giro a mitad', () => {
    const points = routePoints({ x: 0, y: 0, dir: { x: 1, y: 0 } }, { x: 200, y: 100, dir: { x: -1, y: 0 } }, 'elbow');
    expect(points).toEqual([0, 0, 100, 0, 100, 100, 200, 100]);
    for (const [x1, y1, x2, y2] of segments(points)) expect(x1 === x2 || y1 === y2).toBe(true);
  });

  it('codo entre un lado horizontal y uno vertical: dos segmentos', () => {
    expect(routePoints({ x: 0, y: 0, dir: { x: 1, y: 0 } }, { x: 100, y: 80, dir: { x: 0, y: -1 } }, 'elbow')).toEqual([0, 0, 100, 0, 100, 80]);
  });

  it('codo con los dos extremos mirando al mismo lado: rodea por fuera, como mucho tres segmentos', () => {
    const points = routePoints({ x: 0, y: 0, dir: { x: 1, y: 0 } }, { x: 100, y: 60, dir: { x: 1, y: 0 } }, 'elbow');
    expect(points.length / 2 - 1).toBeLessThanOrEqual(3);
    expect(Math.max(...points.filter((_, i) => i % 2 === 0))).toBeGreaterThan(100);
  });

  // El primer tramo sale hacia fuera del lado del ancla y el último llega desde fuera del lado del otro.
  const leavesOutward = (points: number[], start: Terminal, end: Terminal) => {
    const n = points.length;
    const first = { x: points[2]! - points[0]!, y: points[3]! - points[1]! };
    const last = { x: points[n - 4]! - points[n - 2]!, y: points[n - 3]! - points[n - 1]! };
    expect(first.x * start.dir!.x + first.y * start.dir!.y).toBeGreaterThan(0);
    expect(last.x * end.dir!.x + last.y * end.dir!.y).toBeGreaterThan(0);
    for (const [x1, y1, x2, y2] of segments(points)) expect(x1 === x2 || y1 === y2).toBe(true);
  };

  it('codo con anclas que se dan la espalda: sale de cada nodo antes de girar', () => {
    // Origen con ancla derecha y destino a su izquierda con ancla izquierda.
    const start: Terminal = { x: 200, y: 50, dir: { x: 1, y: 0 } };
    const end: Terminal = { x: 0, y: 50, dir: { x: -1, y: 0 } };
    leavesOutward(routePoints(start, end, 'elbow'), start, end);
    const up: Terminal = { x: 0, y: 0, dir: { x: 0, y: -1 } };
    const down: Terminal = { x: 40, y: 200, dir: { x: 0, y: 1 } };
    leavesOutward(routePoints(up, down, 'elbow'), up, down);
  });

  it('codo entre dos nodos de espaldas a la misma altura: rodea los dos sin atravesarlos', () => {
    const boxA = { x: 300, y: 0, w: 100, h: 100, rotation: 0 };
    const boxB = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    const start = anchorTerminal(localMatrix(boxA), 100, 100, 'right');
    const end = anchorTerminal(localMatrix(boxB), 100, 100, 'left');
    const points = routePoints(start, end, 'elbow');
    leavesOutward(points, start, end);
    const inside = (box: typeof boxA, x: number, y: number) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
    for (const [x1, y1, x2, y2] of segments(points)) {
      for (let t = 0.05; t < 1; t += 0.05) {
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        expect(inside(boxA, x, y) || inside(boxB, x, y)).toBe(false);
      }
    }
  });

  it('codo entre un lado horizontal y uno vertical que quedan detrás: tampoco vuelve sobre el nodo', () => {
    // Ancla derecha hacia un ancla superior situada arriba a la izquierda.
    const start: Terminal = { x: 200, y: 200, dir: { x: 1, y: 0 } };
    const end: Terminal = { x: 50, y: 0, dir: { x: 0, y: -1 } };
    leavesOutward(routePoints(start, end, 'elbow'), start, end);
    // Ancla derecha hacia un ancla superior situada arriba a la derecha: llega por encima.
    const above: Terminal = { x: 400, y: 0, dir: { x: 0, y: -1 } };
    leavesOutward(routePoints(start, above, 'elbow'), start, above);
  });

  it('codo alineado: un solo segmento', () => {
    expect(routePoints({ x: 0, y: 10, dir: { x: 1, y: 0 } }, { x: 90, y: 10, dir: { x: -1, y: 0 } }, 'elbow')).toEqual([0, 10, 90, 10]);
  });

  it('curvo: empieza y acaba en los extremos y sale en la dirección del ancla', () => {
    const points = routePoints({ x: 0, y: 0, dir: { x: 0, y: 1 } }, free(200, 0), 'curved');
    expect(points.slice(0, 2)).toEqual([0, 0]);
    expect(points.slice(-2)[0]).toBeCloseTo(200);
    expect(points.slice(-2)[1]).toBeCloseTo(0);
    // El segundo punto baja: la curva sale hacia abajo.
    expect(points[3]!).toBeGreaterThan(0);
  });
});

describe('caja de los extremos', () => {
  it('guarda el sentido para poder reconstruir los dos puntos', () => {
    const from = { x: 300, y: 20 };
    const to = { x: 100, y: 90 };
    const box = endpointBox(from, to);
    expect(box).toEqual({ x: 100, y: 20, w: 200, h: 70, flipX: true, flipY: false });
    expect(endpointsFromBox(box)).toEqual({ from, to });
  });
});

describe('colocación de imágenes', () => {
  const map = (affine: ReturnType<typeof textureAffine>, x: number, y: number) => apply(affine, x, y);

  it('fill: la textura entera ocupa la caja', () => {
    const { area, image } = imagePlacement({ w: 200, h: 100, fit: 'fill' }, 1600, 1200);
    expect(area).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(map(textureAffine(area, image), 0, 0)).toEqual({ x: 0, y: 0 });
    expect(map(textureAffine(area, image), 1, 1)).toEqual({ x: 1, y: 1 });
  });

  it('contain: la imagen cabe entera, centrada, y solo se rellena su parte', () => {
    const { area, image } = imagePlacement({ w: 200, h: 100, fit: 'contain' }, 1600, 1200);
    expect(area).toEqual({ x: (200 - 100 * (4 / 3)) / 2, y: 0, w: 100 * (4 / 3), h: 100 });
    expect(image).toEqual(area);
  });

  it('cover: la caja entera se rellena y la textura se recorta por los lados que sobran', () => {
    const { area, image } = imagePlacement({ w: 200, h: 100, fit: 'cover' }, 1600, 1200);
    expect(area).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(image.w).toBeCloseTo(200);
    expect(image.h).toBeCloseTo(150);
    const top = map(textureAffine(area, image), 0, 0);
    const bottom = map(textureAffine(area, image), 1, 1);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(1 / 6);
    expect(bottom.y).toBeCloseTo(5 / 6);
  });

  it('crop: solo la parte recortada de la textura', () => {
    const crop = { x: 0.5, y: 0, w: 0.5, h: 0.5 };
    const { area, image } = imagePlacement({ w: 100, h: 100, fit: 'fill', crop }, 1000, 1000);
    expect(map(textureAffine(area, image, crop), 0, 0)).toEqual({ x: 0.5, y: 0 });
    expect(map(textureAffine(area, image, crop), 1, 1)).toEqual({ x: 1, y: 0.5 });
  });
});
