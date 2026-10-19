import type { DocumentNode, NodeOf, NodeType } from '../shared/document/schema.js';

export type NodeRecord = Readonly<DocumentNode>;

export type AABB = { minX: number; minY: number; maxX: number; maxY: number };

export type Box = { x: number; y: number; w: number; h: number };

export const BASIC_SHAPE_TYPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc'] as const;
export type BasicShapeType = (typeof BASIC_SHAPE_TYPES)[number];

export const RENDERABLE_TYPES = [...BASIC_SHAPE_TYPES, 'line', 'connector', 'text', 'image'] as const;
export type RenderableType = (typeof RENDERABLE_TYPES)[number];

export type ShapeRecord = Readonly<NodeOf<BasicShapeType>>;
export type LineRecord = Readonly<NodeOf<'line'>>;
export type TextRecord = Readonly<NodeOf<'text'>>;
export type ImageRecord = Readonly<NodeOf<'image'>>;
// `path` es el recorrido calculado en coordenadas de mundo ([x0, y0, x1, y1, …]); no se guarda en el documento.
export type ConnectorRecord = Readonly<NodeOf<'connector'>> & { readonly path?: readonly number[] };
export type RenderableRecord = ShapeRecord | LineRecord | ConnectorRecord | TextRecord | ImageRecord;
export type GroupRecord = Readonly<NodeOf<'group'>>;
export type FrameRecord = Readonly<NodeOf<'frame'>>;
export type ContainerRecord = GroupRecord | FrameRecord;
// Lo que recibe la capa de dibujo: las hojas y los contenedores (que agrupan las vistas de sus hijos).
export type SceneRecord = RenderableRecord | ContainerRecord;
// Registros con texto interior y propiedades label*.
export type LabelledRecord = ShapeRecord | ConnectorRecord;

const RENDERABLE = new Set<NodeType>(RENDERABLE_TYPES);
const LABELLED = new Set<NodeType>([...BASIC_SHAPE_TYPES, 'connector']);

export function isRenderable(record: NodeRecord): record is RenderableRecord {
  return RENDERABLE.has(record.type);
}

// Formas y conectores que admiten texto interior (`texts[id]` con las propiedades label*).
export function hasLabel(record: NodeRecord | undefined): record is LabelledRecord {
  return record !== undefined && LABELLED.has(record.type);
}

// Nodos cuyo contenido vive en `texts[id]`.
export function hasTextContent(record: NodeRecord | undefined): record is LabelledRecord | TextRecord {
  return record !== undefined && (record.type === 'text' || LABELLED.has(record.type));
}

export function isContainer(record: NodeRecord | undefined): record is ContainerRecord {
  return record?.type === 'group' || record?.type === 'frame';
}

export function emptyAABB(): AABB {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function isEmptyAABB(box: AABB): boolean {
  return !(box.maxX >= box.minX && box.maxY >= box.minY);
}

export function unionAABB(target: AABB, other: AABB): AABB {
  target.minX = Math.min(target.minX, other.minX);
  target.minY = Math.min(target.minY, other.minY);
  target.maxX = Math.max(target.maxX, other.maxX);
  target.maxY = Math.max(target.maxY, other.maxY);
  return target;
}

export function intersects(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function containsAABB(outer: AABB, inner: AABB): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function expandAABB(box: AABB, amount: number): AABB {
  return { minX: box.minX - amount, minY: box.minY - amount, maxX: box.maxX + amount, maxY: box.maxY + amount };
}

export function aabbFromBox(box: Box): AABB {
  return { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h };
}

export function boxFromAABB(box: AABB): Box {
  return { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
}
