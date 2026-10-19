import { localMatrix } from '../geometry/bounds.ts';
import { apply, multiply, type Mat } from '../geometry/matrix.ts';
import { hasTextContent, isContainer, isRenderable, type SceneRecord } from '../types.ts';
import type { ResolvedPlan } from './plan.ts';

export const AI_PREVIEW_COLOR = '#A78BFA';
export const AI_PREVIEW_DELETE_COLOR = '#F07167';
// Los nodos nuevos se ven al 70 % hasta que se aplican.
export const AI_PREVIEW_NEW_ALPHA = 0.7;

export type PreviewItem = { id: string; record: SceneRecord; world: Mat; text: string; outline: number[] };

// Capa `preview` del lienzo: lo que el plan cambiaría, sin tocar el documento.
export type PreviewModel = {
  created: PreviewItem[];
  edited: PreviewItem[];
  // Contorno en mundo de cada nodo que se borraría.
  deleted: number[][];
};

export type PreviewDeps = {
  parentWorld(parentId: string | null): Mat | null;
  // Contorno actual en mundo de un nodo del documento.
  outline(id: string): number[] | null;
  text(id: string): string;
};

function corners(world: Readonly<Mat>, w: number, h: number): number[] {
  return [apply(world, 0, 0), apply(world, w, 0), apply(world, w, h), apply(world, 0, h)].flatMap((p) => [p.x, p.y]);
}

function drawable(record: SceneRecord | { type: string }): record is SceneRecord {
  return isRenderable(record as SceneRecord) || isContainer(record as SceneRecord);
}

export function buildPreview(resolved: ResolvedPlan, deps: PreviewDeps): PreviewModel {
  const model: PreviewModel = { created: [], edited: [], deleted: [] };
  const createdWorld = new Map<string, Mat>();
  const worldOf = (record: SceneRecord) => {
    const parent = record.parentId ? (createdWorld.get(record.parentId) ?? deps.parentWorld(record.parentId)) : null;
    const local = localMatrix(record);
    return parent ? multiply(parent, local) : local;
  };
  // Los frames nuevos van primero en `creates`: sus hijos ya encuentran su matriz.
  for (const { record, text } of resolved.creates) {
    if (!drawable(record)) continue;
    const world = worldOf(record);
    createdWorld.set(record.id, world);
    model.created.push({ id: record.id, record, world, text: text ?? '', outline: corners(world, record.w, record.h) });
  }
  for (const update of resolved.updates) {
    const record = update.record;
    if (!drawable(record) || record.type === 'connector') continue;
    const world = worldOf(record);
    const text = update.text ?? (hasTextContent(record) ? deps.text(update.id) : '');
    const outline = record.type === 'group' ? (deps.outline(update.id) ?? []) : corners(world, record.w, record.h);
    model.edited.push({ id: update.id, record, world, text, outline });
  }
  for (const id of resolved.deletes) {
    const outline = deps.outline(id);
    if (outline?.length) model.deleted.push(outline);
  }
  return model;
}
