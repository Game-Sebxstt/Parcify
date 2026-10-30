import { describe, expect, it } from 'vitest';
import { localMatrix } from './bounds.ts';
import { arrowhead, arrowheadLength, arrowheadPadding, decorateLine, polylineLength } from './arrowheads.ts';
import {
  anchorAt,
  anchorTerminal,
  anchorUnit,
  CURVE_SEGMENTS,
  CURVE_SPAN_SEGMENTS,
  dragElbowSegment,
  ELBOW_MARGIN,
  endpointBox,
  endpointsFromBox,
  insertWaypoint,
  MAX_ROUTE_POINTS,
  moveWaypoint,
  removeWaypoint,
  routePoints,
  type Terminal,
} from './connectors.ts';
import { imagePlacement, textureAffine } from './image.ts';
import { apply, type Point } from './matrix.ts';

const free = (x: number, y: number): Terminal => ({ x, y, dir: null });

function segments(points: number[]): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 2; i < points.length; i += 2) out.push([points[i - 2]!, points[i - 1]!, points[i]!, points[i + 1]!]);
  return out;
}

// El primer tramo sale hacia fuera del lado del ancla y el último llega desde fuera del lado del otro.
const leavesOutward = (points: number[], start: Terminal, end: Terminal) => {
  const n = points.length;
  const first = { x: points[2]! - points[0]!, y: points[3]! - points[1]! };
  const last = { x: points[n - 4]! - points[n - 2]!, y: points[n - 3]! - points[n - 1]! };
  expect(first.x * start.dir!.x + first.y * start.dir!.y).toBeGreaterThan(0);
  expect(last.x * end.dir!.x + last.y * end.dir!.y).toBeGreaterThan(0);
  for (const [x1, y1, x2, y2] of segments(points)) expect(x1 === x2 || y1 === y2).toBe(true);
};

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

const right = (x: number, y: number): Terminal => ({ x, y, dir: { x: 1, y: 0 } });
const left = (x: number, y: number): Terminal => ({ x, y, dir: { x: -1, y: 0 } });

const orthogonal = (points: number[]) => {
  for (const [x1, y1, x2, y2] of segments(points)) expect(Math.abs(x1 - x2) < 1e-6 || Math.abs(y1 - y2) < 1e-6, `${x1},${y1} → ${x2},${y2}`).toBe(true);
};

// El punto cae sobre algún tramo del recorrido.
const passesThrough = (points: number[], p: Point) => {
  const on = segments(points).some(([x1, y1, x2, y2]) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const cross = Math.abs((x2 - x1) * (p.y - y1) - (y2 - y1) * (p.x - x1));
    const t = length > 0 ? ((p.x - x1) * (x2 - x1) + (p.y - y1) * (y2 - y1)) / (length * length) : 0;
    return (length > 0 ? cross / length : Math.hypot(p.x - x1, p.y - y1)) < 1e-6 && t >= -1e-9 && t <= 1 + 1e-9;
  });
  expect(on, `${p.x},${p.y}`).toBe(true);
};

const pairs = (points: Point[]) => points.flatMap((p) => [p.x, p.y]);

describe('ruteo con waypoints', () => {
  it('sin waypoints el recorrido no cambia (CA-1.7)', () => {
    const cases: Array<[Terminal, Terminal]> = [
      [right(0, 0), left(200, 100)],
      [right(200, 50), left(0, 50)],
      [{ x: 0, y: 0, dir: { x: 0, y: 1 } }, free(200, 0)],
      [free(10, 20), free(300, -40)],
    ];
    for (const [start, end] of cases) {
      for (const route of ['straight', 'elbow', 'curved'] as const) {
        const before = routePoints(start, end, route);
        expect(routePoints(start, end, route, undefined)).toEqual(before);
        expect(routePoints(start, end, route, [])).toEqual(before);
      }
    }
    expect(routePoints(right(0, 0), left(200, 100), 'elbow')).toEqual([0, 0, 100, 0, 100, 100, 200, 100]);
    expect(routePoints(free(0, 0), free(100, 50), 'curved')).toHaveLength((CURVE_SEGMENTS + 1) * 2);
  });

  it('recto: polilínea por los waypoints', () => {
    expect(routePoints(free(0, 0), free(200, 0), 'straight', [{ x: 50, y: 80 }, { x: 120, y: 10 }])).toEqual([0, 0, 50, 80, 120, 10, 200, 0]);
  });

  it('curvo: pasa por cada waypoint, con 16 tramos por vano y la tangente del ancla', () => {
    const waypoints = [
      { x: 100, y: 120 },
      { x: 220, y: -40 },
    ];
    const points = routePoints({ x: 0, y: 0, dir: { x: 0, y: 1 } }, left(300, 50), 'curved', waypoints);
    expect(points).toHaveLength((3 * CURVE_SPAN_SEGMENTS + 1) * 2);
    expect(points.slice(0, 2)).toEqual([0, 0]);
    for (const [i, p] of waypoints.entries()) {
      expect(points[(i + 1) * CURVE_SPAN_SEGMENTS * 2]).toBeCloseTo(p.x, 6);
      expect(points[(i + 1) * CURVE_SPAN_SEGMENTS * 2 + 1]).toBeCloseTo(p.y, 6);
    }
    expect(points.at(-2)).toBeCloseTo(300, 6);
    expect(points.at(-1)).toBeCloseTo(50, 6);
    // Sale hacia abajo (normal del ancla) y llega desde la izquierda del ancla izquierda, es decir, hacia +x.
    const first = { x: points[2]! - points[0]!, y: points[3]! - points[1]! };
    // La cuerda al primer waypoint se desvía 40° de la vertical; la primera muestra sigue casi la normal.
    expect(Math.abs(first.x / Math.hypot(first.x, first.y))).toBeLessThan(0.2);
    expect(first.y).toBeGreaterThan(0);
    const n = points.length;
    const last = { x: points[n - 2]! - points[n - 4]!, y: points[n - 1]! - points[n - 3]! };
    expect(Math.abs(last.y / Math.hypot(last.x, last.y))).toBeLessThan(0.2);
    expect(last.x).toBeGreaterThan(0);
  });

  it('curvo: nunca pasa de 128 puntos', () => {
    const waypoints = Array.from({ length: 64 }, (_, i) => ({ x: i * 10, y: (i % 2) * 30 }));
    const points = routePoints(free(-10, 0), free(700, 0), 'curved', waypoints);
    expect(points.length / 2).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    for (const p of waypoints) {
      const hit = segments(points).some(([x1, y1]) => Math.abs(x1 - p.x) < 1e-6 && Math.abs(y1 - p.y) < 1e-6);
      expect(hit).toBe(true);
    }
  });

  it('codo: ortogonal, pasa por los waypoints y respeta la salida y la llegada de las anclas', () => {
    const start = right(0, 0);
    const end = left(200, 100);
    const waypoints = [
      { x: 140, y: 0 },
      { x: 140, y: 100 },
    ];
    expect(routePoints(start, end, 'elbow', waypoints)).toEqual([0, 0, 140, 0, 140, 100, 200, 100]);
    // Waypoints desalineados: se enlazan con codos.
    const loose = [
      { x: 60, y: 40 },
      { x: 120, y: -30 },
    ];
    const points = routePoints(start, end, 'elbow', loose);
    orthogonal(points);
    for (const p of loose) passesThrough(points, p);
    leavesOutward(points, start, end);
  });

  it('codo: un waypoint detrás del ancla obliga a salir primero hacia fuera', () => {
    const start = right(100, 0);
    const end = left(300, 0);
    const points = routePoints(start, end, 'elbow', [{ x: 40, y: 80 }]);
    orthogonal(points);
    passesThrough(points, { x: 40, y: 80 });
    leavesOutward(points, start, end);
    expect(points.slice(0, 4)).toEqual([100, 0, 100 + ELBOW_MARGIN, 0]);
  });

  it('codo: tras desplazar el tramo central y mover un nodo, el tramo se mantiene (CA-1.4)', () => {
    const start = right(0, 0);
    const route = routePoints(start, left(200, 100), 'elbow');
    const waypoints = dragElbowSegment(route, 1, 40);
    expect(waypoints).toEqual([
      { x: 140, y: 0 },
      { x: 140, y: 100 },
    ]);
    for (const moved of [left(200, 200), left(300, 100), left(200, -80)]) {
      const points = routePoints(start, moved, 'elbow', waypoints);
      orthogonal(points);
      for (const p of waypoints) passesThrough(points, p);
      leavesOutward(points, start, moved);
    }
  });
});

describe('dragElbowSegment', () => {
  const start = right(0, 0);
  const end = left(200, 100);
  const route = [0, 0, 100, 0, 100, 100, 200, 100];

  it('primer tramo: parte a ELBOW_MARGIN del inicio y la salida sigue horizontal', () => {
    const waypoints = dragElbowSegment(route, 0, 30);
    expect(waypoints).toEqual([
      { x: 24, y: 0 },
      { x: 24, y: 30 },
      { x: 100, y: 30 },
      { x: 100, y: 100 },
    ]);
    const points = routePoints(start, end, 'elbow', waypoints);
    expect(points).toEqual([0, 0, ...pairs(waypoints), 200, 100]);
    leavesOutward(points, start, end);
  });

  it('tramo intermedio: mueve sus dos vértices en perpendicular', () => {
    expect(dragElbowSegment(route, 1, -30)).toEqual([
      { x: 70, y: 0 },
      { x: 70, y: 100 },
    ]);
  });

  it('último tramo: parte a ELBOW_MARGIN del final y la llegada sigue horizontal', () => {
    const waypoints = dragElbowSegment(route, 2, -30);
    expect(waypoints).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 70 },
      { x: 176, y: 70 },
      { x: 176, y: 100 },
    ]);
    const points = routePoints(start, end, 'elbow', waypoints);
    expect(points).toEqual([0, 0, ...pairs(waypoints), 200, 100]);
    orthogonal(points);
    leavesOutward(points, start, end);
  });

  it('tramo único: parte en los dos extremos', () => {
    const waypoints = dragElbowSegment([0, 10, 90, 10], 0, 20);
    expect(waypoints).toEqual([
      { x: 24, y: 10 },
      { x: 24, y: 30 },
      { x: 66, y: 30 },
      { x: 66, y: 10 },
    ]);
    const points = routePoints(right(0, 10), left(90, 10), 'elbow', waypoints);
    orthogonal(points);
    leavesOutward(points, right(0, 10), left(90, 10));
  });

  it('desplazar 0 deja el recorrido igual', () => {
    expect(routePoints(start, end, 'elbow', dragElbowSegment(route, 1, 0))).toEqual(route);
  });

  it('tramo único corto: sale una Z y no un waypoint alineado', () => {
    const waypoints = dragElbowSegment([0, 10, 40, 10], 0, 30);
    expect(waypoints).toHaveLength(4);
    expect(waypoints.map((p) => p.y)).toEqual([10, 40, 40, 10]);
    expect(routePoints(right(0, 10), left(40, 10), 'elbow', waypoints)).toEqual([0, 10, ...pairs(waypoints), 40, 10]);
  });

  it('la U no se mete por detrás de sus salidas: la barra se para a ELBOW_MARGIN', () => {
    const u = routePoints(right(0, 0), right(0, 100), 'elbow');
    expect(u).toEqual([0, 0, 24, 0, 24, 100, 0, 100]);
    expect(dragElbowSegment(u, 1, -10)).toEqual(dragElbowSegment(u, 1, 0));
    expect(dragElbowSegment(u, 1, -30)).toEqual([
      { x: 24, y: 0 },
      { x: 24, y: 100 },
    ]);
    expect(routePoints(right(0, 0), right(0, 100), 'elbow', dragElbowSegment(u, 1, 30))).toEqual([0, 0, 54, 0, 54, 100, 0, 100]);
  });

  it('la barra de un rodeo no se queda alineada con la salida: se para a 1 px', () => {
    const s = right(0, 0);
    const e = left(-100, 0);
    const detour = routePoints(s, e, 'elbow');
    expect(detour).toEqual([0, 0, 24, 0, 24, -24, -124, -24, -124, 0, -100, 0]);
    for (const [d, bar] of [
      [24, -1],
      [40, 16],
    ] as const) {
      const waypoints = dragElbowSegment(detour, 2, d);
      expect(waypoints.map((p) => p.y)).toEqual([0, bar, bar, 0]);
      const points = routePoints(s, e, 'elbow', waypoints);
      expect(points).toEqual([0, 0, ...pairs(waypoints), -100, 0]);
      expect(turnFree(points)).toBe(true);
    }
  });

  it('propiedad: el recorrido de los waypoints arrastrados es exactamente el arrastrado y no da medias vueltas', () => {
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const failures: string[] = [];
    let cases = 0;
    for (const ds of dirs) {
      for (const de of dirs) {
        for (let x = -100; x <= 100; x += 25) {
          for (let y = -100; y <= 100; y += 25) {
            if (x === 0 && y === 0) continue;
            const s: Terminal = { x: 0, y: 0, dir: ds };
            const e: Terminal = { x, y, dir: de };
            const auto = routePoints(s, e, 'elbow');
            // Fuera del barrido: los recorridos automáticos que ya entran o salen por detrás (dos anclas del mismo
            // lado alineadas una detrás de otra), que no son de este tramo.
            const n = auto.length;
            const outward = (auto[2]! - auto[0]!) * ds.x + (auto[3]! - auto[1]!) * ds.y > 0;
            const inward = (auto[n - 4]! - auto[n - 2]!) * de.x + (auto[n - 3]! - auto[n - 1]!) * de.y > 0;
            if (!outward || !inward) continue;
            for (let i = 0; i < auto.length / 2 - 1; i++) {
              for (const d of [15, -15, 30, -30]) {
                cases++;
                const waypoints = dragElbowSegment(auto, i, d);
                const points = routePoints(s, e, 'elbow', waypoints);
                const expected = [s.x, s.y, ...pairs(waypoints), e.x, e.y];
                if (JSON.stringify(points) !== JSON.stringify(expected) || !turnFree(points)) failures.push(`${JSON.stringify([ds, de, x, y, i, d])} → ${points.join(' ')}`);
              }
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(2000);
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

// Ningún tramo vuelve en sentido contrario al anterior.
const turnFree = (points: number[]) => {
  let previous: Point | null = null;
  for (const [x1, y1, x2, y2] of segments(points)) {
    const move = { x: Math.sign(x2 - x1), y: Math.sign(y2 - y1) };
    if (move.x === 0 && move.y === 0) continue;
    if (previous && previous.x * move.x + previous.y * move.y < 0) return false;
    previous = move;
  }
  return true;
};

describe('codo con waypoints sin medias vueltas', () => {
  const check = (start: Terminal, end: Terminal, waypoints: Point[]) => {
    const points = routePoints(start, end, 'elbow', waypoints);
    orthogonal(points);
    for (const p of waypoints) passesThrough(points, p);
    leavesOutward(points, start, end);
    expect(turnFree(points), points.join(' ')).toBe(true);
    return points;
  };

  it('el nodo de llegada, alineado detrás del último waypoint, se rodea en U', () => {
    const points = check(right(0, 0), left(100, 100), [
      { x: 140, y: 0 },
      { x: 140, y: 100 },
    ]);
    expect(points).toEqual([0, 0, 140, 0, 140, 124, 76, 124, 76, 100, 100, 100]);
  });

  it('con la caja del nodo, la U pasa por fuera de ella', () => {
    const end: Terminal = { ...left(100, 100), bounds: { minX: 100, minY: 70, maxX: 180, maxY: 130 } };
    const points = check(right(0, 0), end, [
      { x: 140, y: 0 },
      { x: 140, y: 100 },
    ]);
    expect(points).toEqual([0, 0, 140, 0, 140, 154, 76, 154, 76, 100, 100, 100]);
  });

  it('el primer waypoint, alineado detrás del ancla de salida, se rodea en U', () => {
    const points = check(right(100, 0), left(300, 100), [
      { x: 40, y: 0 },
      { x: 40, y: 100 },
    ]);
    expect(points).toEqual([100, 0, 124, 0, 124, -24, 40, -24, 40, 100, 300, 100]);
  });

  it('waypoints de la U con la barra metida detrás de las salidas', () => {
    check(right(0, 0), right(0, 100), [
      { x: -6, y: 0 },
      { x: -6, y: 100 },
    ]);
  });

  it('propiedad: con los waypoints de CA-1.4, mover el nodo de llegada a cualquier sitio no da medias vueltas', () => {
    const waypoints = [
      { x: 140, y: 0 },
      { x: 140, y: 100 },
    ];
    const failures: string[] = [];
    for (const dir of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      for (let x = -50; x <= 300; x += 25) {
        for (let y = -100; y <= 200; y += 25) {
          const end: Terminal = { x, y, dir };
          const points = routePoints(right(0, 0), end, 'elbow', waypoints);
          const first = { x: points[2]! - points[0]!, y: points[3]! - points[1]! };
          const n = points.length;
          const last = { x: points[n - 4]! - points[n - 2]!, y: points[n - 3]! - points[n - 1]! };
          const ok = turnFree(points) && first.x > 0 && last.x * dir.x + last.y * dir.y > 0;
          if (!ok) failures.push(`${JSON.stringify([dir, x, y])} → ${points.join(' ')}`);
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe('edición de waypoints', () => {
  const list = [
    { x: 10, y: 10 },
    { x: 20, y: 20 },
  ];

  it('insertar, quitar y mover son puras', () => {
    expect(insertWaypoint(list, 0, { x: 5, y: 5 })).toEqual([{ x: 5, y: 5 }, ...list]);
    expect(insertWaypoint(list, 2, { x: 30, y: 30 })).toEqual([...list, { x: 30, y: 30 }]);
    expect(insertWaypoint(list, 1, { x: 15, y: 15 })[1]).toEqual({ x: 15, y: 15 });
    expect(removeWaypoint(list, 0)).toEqual([{ x: 20, y: 20 }]);
    expect(moveWaypoint(list, 1, { x: 0, y: 0 })).toEqual([{ x: 10, y: 10 }, { x: 0, y: 0 }]);
    expect(list).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
  });
});

describe('puntas de flecha', () => {
  it('L = clamp(tramo/4, 6 + 2·grosor, 10 + 3·grosor) (CA-1.2)', () => {
    expect(arrowheadLength(100, 2)).toBe(16);
    expect(arrowheadLength(20, 2)).toBe(10);
    expect(arrowheadLength(48, 2)).toBe(12);
    expect(arrowheadLength(10_000, 12)).toBe(46);
    expect(arrowheadLength(0, 1)).toBe(8);
  });

  it('recortes del trazo según la punta', () => {
    const tip = { x: 100, y: 0 };
    const from = { x: 0, y: 0 };
    const L = arrowheadLength(100, 4);
    expect(arrowhead('none', tip, from, 4)).toEqual({ trim: 0, shape: null });
    expect(arrowhead('arrow', tip, from, 4).trim).toBe(2);
    expect(arrowhead('triangle', tip, from, 4).trim).toBeCloseTo(0.9 * L);
    expect(arrowhead('diamond', tip, from, 4).trim).toBeCloseTo(0.9 * L);
    expect(arrowhead('circle', tip, from, 4).trim).toBeCloseTo((L / 2.4) * 1.8);
    expect(arrowhead('bar', tip, from, 4).trim).toBe(0);
  });

  it('la punta queda en el final del trazo y mide L a lo largo de él', () => {
    const tip = { x: 100, y: 0 };
    const from = { x: 0, y: 0 };
    const L = arrowheadLength(100, 2);
    const triangle = arrowhead('triangle', tip, from, 2).shape!;
    expect(triangle.type).toBe('polygon');
    expect(triangle.points[0]).toEqual(tip);
    for (const p of triangle.points.slice(1)) expect(p.x).toBeCloseTo(100 - L);
    expect(Math.abs(triangle.points[1]!.y)).toBeCloseTo(L * Math.tan((28 * Math.PI) / 180));
    const arrow = arrowhead('arrow', tip, from, 2).shape!;
    expect(arrow.type).toBe('polyline');
    expect(arrow.points[1]).toEqual(tip);
    const diamond = arrowhead('diamond', tip, from, 2).shape!;
    expect(diamond.points.map((p) => [p.x, p.y])).toEqual([
      [100, 0],
      [100 - L / 2, 0.3 * L],
      [100 - L, 0],
      [100 - L / 2, -0.3 * L],
    ]);
    const circle = arrowhead('circle', tip, from, 2).shape!;
    expect(circle.radius).toBeCloseTo(L / 2.4);
    expect(circle.points[0]!.x + circle.radius!).toBeCloseTo(100);
    const bar = arrowhead('bar', tip, from, 2).shape!;
    expect(bar.type).toBe('segment');
    expect(bar.points.map((p) => p.x)).toEqual([100, 100]);
    expect(Math.abs(bar.points[0]!.y - bar.points[1]!.y)).toBeCloseTo(0.9 * L);
  });

  it('la punta sigue la dirección del último tramo', () => {
    const head = arrowhead('triangle', { x: 0, y: 100 }, { x: 0, y: 0 }, 2).shape!;
    for (const p of head.points.slice(1)) expect(p.y).toBeCloseTo(100 - arrowheadLength(100, 2));
  });

  it('el trazo recortado no asoma por las puntas rellenas', () => {
    const inside = (polygon: Point[], p: Point) => {
      let hit = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i]!;
        const b = polygon[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    for (const width of [1, 4, 12]) {
      for (const kind of ['triangle', 'diamond', 'circle'] as const) {
        const { path, heads } = decorateLine({ startCap: 'none', endCap: kind, strokeWidth: width }, [0, 0, 300, 0]);
        const end = path.at(-2)!;
        // El extremo redondo del trazo (radio grosor/2) queda detrás de la punta y dentro de ella.
        const cap = { x: end + width / 2, y: 0 };
        expect(cap.x).toBeLessThan(300);
        const head = heads[0]!;
        if (head.type === 'circle') expect(Math.hypot(cap.x - head.points[0]!.x, cap.y - head.points[0]!.y)).toBeLessThan(head.radius!);
        else expect(inside(head.points, cap), `${kind} ${width}`).toBe(true);
      }
      const arrow = decorateLine({ startCap: 'arrow', endCap: 'bar', strokeWidth: width }, [0, 0, 300, 0]);
      expect(arrow.path[0]).toBeCloseTo(width / 2);
      expect(arrow.path.at(-2)).toBe(300);
    }
  });

  it('las puntas de un conector curvo se orientan por la cuerda y miden según el vano', () => {
    const points = routePoints({ x: 0, y: 0, dir: { x: 0, y: 1 } }, free(300, 0), 'curved');
    const { path, heads } = decorateLine({ startCap: 'triangle', endCap: 'triangle', strokeWidth: 2, route: 'curved' }, points);
    expect(heads).toHaveLength(2);
    const L = arrowheadLength(polylineLength(points), 2);
    // La base de la punta del final queda a L de la punta, a lo largo de la cuerda hasta el trazo.
    const tip = heads[1]!.points[0]!;
    const base = { x: (heads[1]!.points[1]!.x + heads[1]!.points[2]!.x) / 2, y: (heads[1]!.points[1]!.y + heads[1]!.points[2]!.y) / 2 };
    expect(Math.hypot(tip.x - base.x, tip.y - base.y)).toBeCloseTo(L);
    expect(polylineLength(path)).toBeCloseTo(polylineLength(points) - 2 * 0.9 * L, 6);
  });

  it('un trazo más corto que sus puntas solo dibuja las puntas', () => {
    const { path, heads } = decorateLine({ startCap: 'triangle', endCap: 'triangle', strokeWidth: 4 }, [0, 0, 10, 0]);
    expect(path).toEqual([]);
    expect(heads).toHaveLength(2);
  });

  it('la caja pintada cubre la punta más ancha', () => {
    for (const width of [1, 4, 12]) {
      const head = arrowhead('arrow', { x: 1000, y: 0 }, { x: 0, y: 0 }, width).shape!;
      const reach = Math.max(...head.points.map((p) => Math.abs(p.y))) + width / 2;
      expect(arrowheadPadding(width)).toBeGreaterThanOrEqual(reach - 1e-9);
    }
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
