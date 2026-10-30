import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import { NodeSchema } from '../../shared/document/schema.js';
import type { EditorCore } from '../EditorCore.ts';
import { localMatrix } from '../geometry/bounds.ts';
import { removeWaypoint } from '../geometry/connectors.ts';
import { apply, type Mat, type Point } from '../geometry/matrix.ts';
import type { ConnectorRecord, LineRecord, NodeRecord } from '../types.ts';

type Patch = Record<string, unknown>;

// Lo que los comandos de recorridos necesitan de Commands: una transacción (un paso de deshacer) y las cajas de los
// conectores que dependen de los nodos que cambian.
export type PathHost = {
  readonly core: EditorCore;
  canEdit(): boolean;
  write(patches: ReadonlyArray<[string, Patch]>): void;
  connectorBoxPatches(changed: ReadonlyMap<string, NodeRecord>): Array<[string, Patch]>;
  cacheFor(record: ConnectorRecord): Patch;
};

const round3 = (value: number) => Math.round(Math.max(-DOCUMENT_LIMITS.maxCoordinate, Math.min(DOCUMENT_LIMITS.maxCoordinate, value)) * 1000) / 1000;

// Waypoints tal como se guardan: pares redondeados a 0,001 dentro de las coordenadas permitidas.
export function storedWaypoints(points: ReadonlyArray<Point | readonly [number, number]>): Array<[number, number]> {
  return points.map((p) => ('x' in p ? [round3(p.x), round3(p.y)] : [round3(p[0]), round3(p[1])]));
}

// Waypoints de un conector como puntos, en el sistema de su padre.
export function waypointPoints(record: ConnectorRecord): Point[] {
  return (record.waypoints ?? []).map(([x, y]) => ({ x, y }));
}

// Los waypoints con una matriz que actúa en el sistema del padre del conector.
export function transformWaypoints(waypoints: ReadonlyArray<readonly [number, number]>, matrix: Readonly<Mat>): Array<[number, number]> {
  return storedWaypoints(waypoints.map(([x, y]) => apply(matrix, x, y)));
}

// Puntos de una línea en el sistema de su padre, con su posición, giro y volteo ya aplicados.
export function linePointsInParent(record: LineRecord): Array<[number, number]> {
  const local = localMatrix(record);
  return record.points.map(([px, py]) => {
    const p = apply(local, px, py);
    return [p.x, p.y];
  });
}

// Línea con estos puntos (en el sistema del padre): la caja los ajusta y el giro y el volteo pasan a los puntos.
export function linePointsPatch(absolute: ReadonlyArray<readonly [number, number]>): Patch {
  const minX = Math.min(...absolute.map(([x]) => x));
  const minY = Math.min(...absolute.map(([, y]) => y));
  const maxX = Math.max(...absolute.map(([x]) => x));
  const maxY = Math.max(...absolute.map(([, y]) => y));
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    rotation: 0,
    flipX: false,
    flipY: false,
    points: absolute.map(([x, y]) => [x - minX, y - minY]),
  };
}

function samePairs(a: ReadonlyArray<readonly [number, number]> | undefined, b: ReadonlyArray<readonly [number, number]> | undefined): boolean {
  if (!a?.length || !b?.length) return !a?.length && !b?.length;
  return a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]);
}

// Vértices de líneas y puntos de paso de conectores. Los índices de vértice son los de los tiradores: en una línea,
// sus puntos; en un conector recto o curvo, el inicio (0), los waypoints (1…n) y el final (n + 1). Cada comando es
// un paso de deshacer y no escribe nada si dejaría el nodo inválido.
export class PathCommands {
  constructor(private readonly host: PathHost) {}

  private editable<T extends NodeRecord['type']>(id: string, type: T): Extract<NodeRecord, { type: T }> | null {
    const record = this.host.core.record(id);
    if (!this.host.canEdit() || record?.type !== type || this.host.core.isLocked(id)) return null;
    return record as Extract<NodeRecord, { type: T }>;
  }

  // `absolute`: los puntos en el sistema del padre.
  setLinePoints(id: string, absolute: ReadonlyArray<readonly [number, number]>): boolean {
    const record = this.editable(id, 'line');
    if (!record || absolute.length < 2 || absolute.length > DOCUMENT_LIMITS.maxPoints) return false;
    const patch = linePointsPatch(absolute);
    if (!NodeSchema.safeParse({ ...record, ...patch }).success) return false;
    const connectors = this.host.connectorBoxPatches(new Map([[id, { ...record, ...patch } as NodeRecord]]));
    this.host.write([[id, patch], ...connectors]);
    return true;
  }

  // Quita el punto `index` de una línea. false si quedarían menos de 2, si el índice no existe o si no es editable.
  removeLinePoint(id: string, index: number): boolean {
    const record = this.editable(id, 'line');
    if (!record || record.points.length <= 2 || index < 0 || index >= record.points.length) return false;
    const absolute = linePointsInParent(record);
    absolute.splice(index, 1);
    return this.setLinePoints(id, absolute);
  }

  // Inserta `point` (en el sistema del padre) entre los puntos `segmentIndex` y `segmentIndex + 1`. Devuelve el
  // índice del punto nuevo, o null si no cabe o no es editable.
  insertLinePoint(id: string, segmentIndex: number, point: Point): number | null {
    const record = this.editable(id, 'line');
    if (!record || record.points.length >= DOCUMENT_LIMITS.maxPoints || segmentIndex < 0 || segmentIndex >= record.points.length - 1) return null;
    const absolute = linePointsInParent(record);
    absolute.splice(segmentIndex + 1, 0, [point.x, point.y]);
    return this.setLinePoints(id, absolute) ? segmentIndex + 1 : null;
  }

  // Waypoints nuevos de un conector, en el sistema de su padre. Una lista vacía quita la clave.
  setConnectorPath(id: string, path: { waypoints: ReadonlyArray<Point | readonly [number, number]> }): boolean {
    const record = this.editable(id, 'connector');
    if (!record || path.waypoints.length > DOCUMENT_LIMITS.maxWaypoints) return false;
    const waypoints = path.waypoints.length ? storedWaypoints(path.waypoints) : undefined;
    if (samePairs(waypoints, record.waypoints)) return false;
    const next = { ...record, waypoints } as ConnectorRecord;
    if (!NodeSchema.safeParse(next).success) return false;
    this.host.write([[id, { waypoints, ...this.host.cacheFor(next) }]]);
    return true;
  }

  // «Restablecer recorrido»: vuelve al recorrido automático en todos los conectores de `ids` que tengan waypoints.
  resetConnectorPath(ids: string | readonly string[]): void {
    const patches: Array<[string, Patch]> = [];
    for (const id of typeof ids === 'string' ? [ids] : ids) {
      const record = this.editable(id, 'connector');
      if (!record?.waypoints) continue;
      patches.push([id, { waypoints: undefined, ...this.host.cacheFor({ ...record, waypoints: undefined } as ConnectorRecord) }]);
    }
    if (patches.length) this.host.write(patches);
  }

  // Se puede quitar el vértice: un punto de una línea de 3 o más, o un waypoint de un conector recto o curvo.
  canRemoveVertex(id: string, index: number): boolean {
    const record = this.host.core.record(id);
    if (!this.host.canEdit() || this.host.core.isLocked(id)) return false;
    if (record?.type === 'line') return record.points.length > 2 && index >= 0 && index < record.points.length;
    if (record?.type === 'connector') return record.route !== 'elbow' && index >= 1 && index <= (record.waypoints?.length ?? 0);
    return false;
  }

  removeVertex(id: string, index: number): boolean {
    if (!this.canRemoveVertex(id, index)) return false;
    const record = this.host.core.record(id)!;
    if (record.type === 'line') return this.removeLinePoint(id, index);
    return this.setConnectorPath(id, { waypoints: removeWaypoint(waypointPoints(record as ConnectorRecord), index - 1) });
  }
}
