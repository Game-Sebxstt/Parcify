import { localMatrix } from '../geometry/bounds.ts';
import { multiply, type Mat } from '../geometry/matrix.ts';
import { isContainer, type NodeRecord } from '../types.ts';
import { compareOrder } from './order.ts';

type RecordSource = { get(id: string): NodeRecord | undefined; all(): IterableIterator<NodeRecord> };

const ROOT = '\u0000root:';

// Árbol derivado de `parentId`. Un padre inexistente, que no es contenedor, de otra página o en ciclo
// hace que el nodo cuente como raíz de su página. La regla es la misma en todos los clientes.
export class SceneTree {
  private readonly parentOf = new Map<string, string | null>();
  private readonly children = new Map<string, string[]>();
  private readonly orderCache = new Map<string, string[]>();
  private readonly containerWorld = new Map<string, Mat>();
  // Nodos que declaran un padre que no vale (borrado, de otra página o en ciclo): cuentan como raíz, pero si
  // ese padre cambia también cambian ellos.
  private readonly orphans = new Map<string, string[]>();

  constructor(private readonly source: RecordSource) {}

  rebuild(): void {
    this.parentOf.clear();
    this.children.clear();
    this.orderCache.clear();
    this.containerWorld.clear();
    this.orphans.clear();
    for (const record of this.source.all()) {
      const parent = this.resolveParent(record);
      this.parentOf.set(record.id, parent);
      const key = parent ?? ROOT + record.pageId;
      let list = this.children.get(key);
      if (!list) this.children.set(key, (list = []));
      list.push(record.id);
      if (record.parentId && !parent) {
        let orphans = this.orphans.get(record.parentId);
        if (!orphans) this.orphans.set(record.parentId, (orphans = []));
        orphans.push(record.id);
      }
    }
    for (const list of this.children.values()) {
      list.sort((a, b) => compareOrder(this.source.get(a)!, this.source.get(b)!));
    }
  }

  // Un cambio de geometría de un contenedor invalida las matrices de mundo de su subárbol.
  invalidateContainers(): void {
    this.containerWorld.clear();
  }

  private resolveParent(record: NodeRecord): string | null {
    const parentId = record.parentId;
    if (!parentId) return null;
    const parent = this.source.get(parentId);
    if (!parent || !isContainer(parent) || parent.pageId !== record.pageId) return null;
    // En ciclo si, subiendo por los padres declarados, se vuelve al propio nodo.
    const seen = new Set<string>([record.id]);
    let current: NodeRecord | undefined = parent;
    while (current?.parentId) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      if (current.parentId === record.id) return null;
      current = this.source.get(current.parentId);
    }
    return parentId;
  }

  parent(id: string): string | null {
    return this.parentOf.get(id) ?? null;
  }

  childrenOf(pageId: string, parentId: string | null): readonly string[] {
    return this.children.get(parentId ?? ROOT + pageId) ?? [];
  }

  // Orden de pintado de la página: recorrido en profundidad con los hijos por (index, id).
  paintOrder(pageId: string): readonly string[] {
    const cached = this.orderCache.get(pageId);
    if (cached) return cached;
    const order: string[] = [];
    const visit = (ids: readonly string[]) => {
      for (const id of ids) {
        order.push(id);
        const kids = this.children.get(id);
        if (kids) visit(kids);
      }
    };
    visit(this.childrenOf(pageId, null));
    this.orderCache.set(pageId, order);
    return order;
  }

  // Matriz de mundo del sistema de coordenadas de los hijos de `parentId` (null en la raíz).
  parentWorld(parentId: string | null): Mat | null {
    if (!parentId) return null;
    const cached = this.containerWorld.get(parentId);
    if (cached) return cached;
    const record = this.source.get(parentId);
    if (!record) return null;
    const local = localMatrix(record);
    const above = this.parentWorld(this.parent(parentId));
    const world = above ? multiply(above, local) : local;
    this.containerWorld.set(parentId, world);
    return world;
  }

  worldMatrix(record: NodeRecord): Mat {
    const parent = this.parentWorld(this.parent(record.id));
    const local = localMatrix(record);
    return parent ? multiply(parent, local) : local;
  }

  descendants(id: string): string[] {
    const result: string[] = [];
    const visit = (parent: string) => {
      for (const child of this.children.get(parent) ?? []) {
        result.push(child);
        visit(child);
      }
    };
    visit(id);
    return result;
  }

  hasChildren(id: string): boolean {
    return (this.children.get(id)?.length ?? 0) > 0;
  }

  // Nodos cuya matriz de mundo o visibilidad dependen de `id`: sus descendientes y los que lo declaran como padre
  // sin poder serlo (con los suyos).
  dependents(id: string): string[] {
    const result = this.descendants(id);
    for (const orphan of this.orphans.get(id) ?? []) {
      result.push(orphan);
      for (const child of this.descendants(orphan)) result.push(child);
    }
    return result;
  }

  isDescendant(id: string, ancestor: string): boolean {
    let current = this.parent(id);
    while (current) {
      if (current === ancestor) return true;
      current = this.parent(current);
    }
    return false;
  }

  // Un nodo dentro de un contenedor oculto o bloqueado se comporta como él.
  hiddenAbove(id: string): boolean {
    for (let current = this.parent(id); current; current = this.parent(current)) {
      if (this.source.get(current)?.visible === false) return true;
    }
    return false;
  }

  lockedAbove(id: string): boolean {
    for (let current = this.parent(id); current; current = this.parent(current)) {
      if (this.source.get(current)?.locked) return true;
    }
    return false;
  }
}
