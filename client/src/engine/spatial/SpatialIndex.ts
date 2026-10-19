import RBush from 'rbush';
import { containsAABB, intersects, type AABB } from '../types.ts';

// En el árbol cada nodo ocupa su caja ampliada (minX…maxY); `box` es la caja real. Mientras la caja real no
// salga de la ampliada, mover el nodo no toca el árbol.
export type SpatialItem = AABB & { id: string; box: AABB };

// Con 9 entradas por nodo, remove + insert cuesta ~40 % menos que con 16 y las consultas no cambian.
const MAX_ENTRIES = 9;
// Margen de la caja ampliada, en fracción del lado mayor.
const FAT_MARGIN = 0.25;
// Por encima de esta fracción de nodos cambiados en un frame sale más barato reconstruir con bulkLoad.
export const REBUILD_RATIO = 0.3;

export class SpatialIndex {
  private tree = new RBush<SpatialItem>(MAX_ENTRIES);
  private readonly items = new Map<string, SpatialItem>();
  // Cambios del árbol que esperan a la siguiente consulta: entre consultas, un nodo que se mueve varias veces
  // se reinserta una sola vez. `get` y `bounds` leen las cajas reales y no dependen del árbol.
  private readonly pendingRemove: SpatialItem[] = [];
  private readonly pendingInsert = new Map<string, SpatialItem>();
  rebuilds = 0;
  // Nodos reinsertados en el árbol al consultar.
  reinserts = 0;

  get size(): number {
    return this.items.size;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): AABB | undefined {
    return this.items.get(id)?.box;
  }

  load(entries: Iterable<[string, AABB]>): void {
    this.items.clear();
    for (const [id, box] of entries) this.items.set(id, fatItem(id, box));
    this.rebuild();
  }

  private rebuild(): void {
    this.pendingRemove.length = 0;
    this.pendingInsert.clear();
    this.tree = new RBush<SpatialItem>(MAX_ENTRIES);
    this.tree.load([...this.items.values()]);
    this.rebuilds++;
  }

  // Aplica los cambios de un frame: null borra. Devuelve si fueron tantos que se reconstruyó el árbol entero.
  update(changes: ReadonlyMap<string, AABB | null>): boolean {
    if (changes.size === 0) return false;
    if (changes.size > Math.max(1, this.items.size) * REBUILD_RATIO && changes.size > 32) {
      for (const [id, box] of changes) {
        if (box) this.items.set(id, fatItem(id, box));
        else this.items.delete(id);
      }
      this.rebuild();
      return true;
    }
    for (const [id, box] of changes) {
      const previous = this.items.get(id);
      if (previous && box && containsAABB(previous, box) && !oversized(previous, box)) {
        const own = previous.box;
        own.minX = box.minX;
        own.minY = box.minY;
        own.maxX = box.maxX;
        own.maxY = box.maxY;
        continue;
      }
      // Lo que aún no entró en el árbol se sustituye sin más; lo que ya está se quita en la próxima consulta.
      if (previous && !this.pendingInsert.delete(id)) this.pendingRemove.push(previous);
      if (box) {
        const item = fatItem(id, box);
        this.items.set(id, item);
        this.pendingInsert.set(id, item);
      } else {
        this.items.delete(id);
      }
    }
    return false;
  }

  private settle(): void {
    const pending = this.pendingRemove.length + this.pendingInsert.size;
    if (pending === 0) return;
    if (pending > Math.max(1, this.items.size) * REBUILD_RATIO * 2 && pending > 64) {
      this.rebuild();
      return;
    }
    for (const item of this.pendingRemove) this.tree.remove(item);
    for (const item of this.pendingInsert.values()) this.tree.insert(item);
    this.reinserts += this.pendingInsert.size;
    this.pendingRemove.length = 0;
    this.pendingInsert.clear();
  }

  clear(): void {
    this.items.clear();
    this.pendingRemove.length = 0;
    this.pendingInsert.clear();
    this.tree.clear();
  }

  search(box: AABB): string[] {
    this.settle();
    const ids: string[] = [];
    for (const item of this.tree.search(box)) if (intersects(item.box, box)) ids.push(item.id);
    return ids;
  }

  searchPoint(x: number, y: number, tolerance: number): string[] {
    return this.search({ minX: x - tolerance, minY: y - tolerance, maxX: x + tolerance, maxY: y + tolerance });
  }

  forEach(visit: (box: AABB) => void): void {
    for (const { box } of this.items.values()) visit(box);
  }

  bounds(): AABB | null {
    if (this.items.size === 0) return null;
    const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const { box } of this.items.values()) {
      if (box.minX < out.minX) out.minX = box.minX;
      if (box.minY < out.minY) out.minY = box.minY;
      if (box.maxX > out.maxX) out.maxX = box.maxX;
      if (box.maxY > out.maxY) out.maxY = box.maxY;
    }
    return out;
  }
}

function copy(box: AABB): AABB {
  return { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY };
}

function fatItem(id: string, box: AABB): SpatialItem {
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY) * FAT_MARGIN;
  return { id, box: copy(box), minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin };
}

// Si el nodo encoge mucho, la caja ampliada vieja haría el árbol menos selectivo: se reinserta.
function oversized(fat: AABB, box: AABB): boolean {
  return fat.maxX - fat.minX + (fat.maxY - fat.minY) > 2 * (box.maxX - box.minX + (box.maxY - box.minY)) + 1e-9;
}
