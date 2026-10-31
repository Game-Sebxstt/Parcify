import { isContainer, type NodeRecord } from '../types.ts';

type TreeSource = {
  childrenOf(pageId: string, parentId: string | null): readonly string[];
  parent(id: string): string | null;
};

export type LayerRow = {
  id: string;
  record: NodeRecord;
  parentId: string | null;
  // aria-level empieza en 1.
  depth: number;
  posInSet: number;
  setSize: number;
  container: boolean;
  expanded: boolean;
};

export const LAYER_ROW_HEIGHT = 28;
// Con el dedo en el panel (tablet): filas más altas para acertar con el ojo y el candado.
export const LAYER_ROW_HEIGHT_TOUCH = 36;
// En la hoja de capas del móvil: filas de 44 px, como los botones que llevan.
export const LAYER_ROW_HEIGHT_SHEET = 44;
const OVERSCAN = 8;

// Filas visibles del árbol de capas: lo que está más arriba en el orden z va primero, y debajo de cada contenedor
// abierto, sus hijos. Solo se recorre lo que está desplegado.
export function layerRows(tree: TreeSource, get: (id: string) => NodeRecord | undefined, pageId: string, expanded: ReadonlySet<string>): LayerRow[] {
  const rows: LayerRow[] = [];
  const stack: Array<{ parentId: string | null; depth: number; ids: readonly string[]; next: number }> = [
    { parentId: null, depth: 1, ids: tree.childrenOf(pageId, null), next: 0 },
  ];
  while (stack.length) {
    const level = stack.at(-1)!;
    if (level.next >= level.ids.length) {
      stack.pop();
      continue;
    }
    const position = level.next++;
    const id = level.ids[level.ids.length - 1 - position]!;
    const record = get(id);
    if (!record) continue;
    const children = isContainer(record) ? tree.childrenOf(pageId, id) : [];
    const container = isContainer(record);
    const open = container && children.length > 0 && expanded.has(id);
    rows.push({ id, record, parentId: level.parentId, depth: level.depth, posInSet: position + 1, setSize: level.ids.length, container, expanded: open });
    if (open) stack.push({ parentId: id, depth: level.depth + 1, ids: children, next: 0 });
  }
  return rows;
}

// Tramo de filas que hay que pintar para la posición de scroll actual (con margen arriba y abajo).
export function rowWindow(count: number, scrollTop: number, height: number, rowHeight = LAYER_ROW_HEIGHT, overscan = OVERSCAN): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(height, rowHeight) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, first + visible + overscan) };
}

// Contenedores que hay que abrir para que se vea un nodo.
export function ancestorsOf(tree: TreeSource, id: string): string[] {
  const result: string[] = [];
  for (let parent = tree.parent(id); parent; parent = tree.parent(parent)) result.push(parent);
  return result;
}
