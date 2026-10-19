import type { AiNodeInput, AiNodePatch, AssistantPlan, CanvasSummaryNode } from '../../shared/ai/assistant.js';
import { ASSISTANT_LIMITS } from '../../shared/ai/assistant.js';
import { newNodeId } from '../../shared/document/ids.js';
import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import { NodeSchema } from '../../shared/document/schema.js';
import { newFrame, newShape, newText } from '../commands/defaults.ts';
import { compareOrder, keysOnTop } from '../model/order.ts';
import { hasLabel, hasTextContent, isContainer, type AABB, type NodeRecord } from '../types.ts';

// Lo que el plan necesita leer del documento actual.
export type PlanView = {
  pageId: string;
  userId: string;
  get(id: string): NodeRecord | undefined;
  isLocked(id: string): boolean;
  // Hijos de `parentId` en la página activa, ordenados.
  children(parentId: string | null): readonly NodeRecord[];
  descendants(id: string): readonly string[];
};

export type ResolvedPlan = {
  creates: Array<{ record: NodeRecord; text: string | null }>;
  updates: Array<{ id: string; before: NodeRecord; record: NodeRecord; patch: Record<string, unknown>; text: string | null }>;
  // Raíces que se borran (sus descendientes se borran con ellas al aplicar).
  deletes: string[];
  // Índices nuevos de hermanos cuando las claves no caben sin reindexar.
  reindexed: Map<string, string>;
  // Ops que ya no se pueden aplicar contra el documento actual.
  skipped: number;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

// Línea con sus puntos relativos a la esquina de su caja.
function lineFrom(base: Record<string, unknown>, at: { x: number; y: number }, points: readonly (readonly [number, number])[]) {
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const maxY = Math.max(...points.map((p) => p[1]));
  return {
    ...base,
    type: 'line',
    x: round3(at.x + minX),
    y: round3(at.y + minY),
    w: round3(maxX - minX),
    h: round3(maxY - minY),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: null,
    stroke: '#EEF2F6FF',
    strokeWidth: 2,
    strokeDash: 'solid',
    shadow: null,
    points: points.map(([px, py]) => [round3(px - minX), round3(py - minY)]),
    startCap: 'none',
    endCap: 'none',
  };
}

// Claves del plan → claves del registro de ese tipo; lo que no aplica al tipo se ignora.
function recordPatch(record: Record<string, unknown> & { type: NodeRecord['type'] }, input: AiNodePatch): { patch: Record<string, unknown>; text: string | null } {
  const patch: Record<string, unknown> = {};
  const has = (key: string) => key in record;
  for (const key of ['x', 'y', 'w', 'h', 'rotation', 'opacity', 'visible', 'name'] as const) {
    if (input[key] !== undefined && (record.type !== 'group' || (key !== 'w' && key !== 'h'))) patch[key] = input[key];
  }
  for (const key of ['fill', 'stroke', 'strokeWidth', 'strokeDash', 'cornerRadius', 'endCap'] as const) {
    if (input[key] !== undefined && has(key)) patch[key] = input[key];
  }
  if (record.type === 'star' && input.starPoints !== undefined) patch.points = input.starPoints;
  if (record.type === 'polygon' && input.sides !== undefined) {
    patch.sides = input.sides;
    patch.vertices = undefined;
  }
  if (record.type === 'text') {
    for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'color', 'align'] as const) if (input[key] !== undefined) patch[key] = input[key];
  } else if (hasLabel(record as NodeRecord)) {
    if (input.fontSize !== undefined) patch.labelFontSize = input.fontSize;
    if (input.color !== undefined) patch.labelColor = input.color;
    if (input.align !== undefined) patch.labelAlign = input.align;
  }
  const text = input.text !== undefined && hasTextContent(record as NodeRecord) ? input.text.slice(0, DOCUMENT_LIMITS.maxTextLength) : null;
  return { patch, text };
}

function merged(record: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  // El radio no puede pasar de la mitad del lado menor: se ajusta en vez de descartar el cambio.
  if (typeof next.cornerRadius === 'number' && typeof next.w === 'number' && typeof next.h === 'number') {
    next.cornerRadius = Math.min(next.cornerRadius, Math.min(next.w, next.h) / 2);
  }
  return next;
}

function createRecord(input: AiNodeInput, base: { id: string; pageId: string; parentId: string | null; index: string; createdBy: string }): { record: NodeRecord; text: string | null } | null {
  const box = { x: input.x, y: input.y, w: input.w, h: input.h };
  let start: Record<string, unknown>;
  switch (input.type) {
    case 'text':
      start = { ...newText(base, box, input.w), x: input.x, y: input.y, h: input.h };
      break;
    case 'frame':
      start = newFrame(base, box);
      break;
    case 'line':
      if (!input.points) return null;
      start = lineFrom(base, box, input.points);
      break;
    default:
      start = newShape(input.type, base, box);
  }
  // La caja ya está puesta (en las líneas sale de sus puntos).
  const { x: _x, y: _y, w: _w, h: _h, points: _points, ...rest } = input;
  const { patch, text } = recordPatch(start as Record<string, unknown> & { type: NodeRecord['type'] }, rest);
  const parsed = NodeSchema.safeParse(merged(start, patch));
  return parsed.success ? { record: parsed.data, text } : null;
}

// Revalida el plan contra el documento actual: lo que apunta a nodos que ya no existen, bloqueados o de otra
// página se omite; los tempIds pasan a ids reales y los nodos nuevos van encima de sus hermanos.
export function resolvePlan(plan: AssistantPlan, view: PlanView): ResolvedPlan {
  const result: ResolvedPlan = { creates: [], updates: [], deletes: [], reindexed: new Map(), skipped: 0 };
  const editable = (id: string) => {
    const record = view.get(id);
    return record && record.pageId === view.pageId && !view.isLocked(id) ? record : undefined;
  };
  const deleted = new Set<string>();
  for (const op of plan.ops) {
    if (op.op !== 'delete') continue;
    if (!editable(op.id)) {
      result.skipped++;
      continue;
    }
    deleted.add(op.id);
    for (const child of view.descendants(op.id)) deleted.add(child);
  }
  for (const id of deleted) {
    const parent = view.get(id)?.parentId;
    if (!parent || !deleted.has(parent)) result.deletes.push(id);
  }

  for (const op of plan.ops) {
    if (op.op !== 'update') continue;
    const record = editable(op.id);
    if (!record || deleted.has(op.id)) {
      result.skipped++;
      continue;
    }
    const { patch, text } = recordPatch(record as NodeRecord & Record<string, unknown>, op.patch);
    const parsed = NodeSchema.safeParse(merged(record, patch));
    if (!parsed.success || (Object.keys(patch).length === 0 && text === null)) {
      result.skipped++;
      continue;
    }
    const finalPatch: Record<string, unknown> = { ...patch };
    if ('cornerRadius' in finalPatch && 'cornerRadius' in parsed.data) finalPatch.cornerRadius = parsed.data.cornerRadius;
    result.updates.push({ id: op.id, before: record, record: parsed.data, patch: finalPatch, text });
  }

  // Padre de cada nodo nuevo: un contenedor vivo de la página o un frame creado antes en el plan.
  const created = new Map<string, string>();
  const createdFrames = new Set<string>();
  const byParent = new Map<string | null, Array<{ input: AiNodeInput; id: string }>>();
  for (const op of plan.ops) {
    if (op.op !== 'create') continue;
    const id = newNodeId();
    let parentId: string | null = null;
    if (op.node.parentId) {
      const tempParent = created.get(op.node.parentId);
      if (tempParent && createdFrames.has(tempParent)) parentId = tempParent;
      else {
        const parent = editable(op.node.parentId);
        if (parent && isContainer(parent) && !deleted.has(parent.id)) parentId = parent.id;
      }
    }
    created.set(op.tempId, id);
    if (op.node.type === 'frame') createdFrames.add(id);
    const list = byParent.get(parentId) ?? [];
    list.push({ input: op.node, id });
    byParent.set(parentId, list);
  }
  for (const [parentId, list] of byParent) {
    const fresh = parentId !== null && createdFrames.has(parentId);
    const siblings = fresh ? [] : [...view.children(parentId)].filter((record) => !deleted.has(record.id)).sort(compareOrder);
    const { keys, reindexed } = keysOnTop(siblings, list.length);
    if (reindexed) for (const [id, index] of reindexed) result.reindexed.set(id, index);
    list.forEach(({ input, id }, i) => {
      const made = createRecord(input, { id, pageId: view.pageId, parentId, index: keys[i]!, createdBy: view.userId });
      if (made) result.creates.push(made);
      else result.skipped++;
    });
  }
  // Un hijo cuyo frame nuevo no se pudo crear queda fuera.
  const createdIds = new Set(result.creates.map((item) => item.record.id));
  result.creates = result.creates.filter((item) => {
    const ok = !item.record.parentId || !createdFrames.has(item.record.parentId) || createdIds.has(item.record.parentId);
    if (!ok) result.skipped++;
    return ok;
  });
  // Los frames nuevos se escriben antes que sus hijos.
  result.creates.sort((a, b) => Number(createdFrames.has(b.record.id)) - Number(createdFrames.has(a.record.id)));
  return result;
}

export type SummaryView = {
  records(): Iterable<NodeRecord>;
  text(id: string): string;
  geometry(id: string): AABB | undefined;
};

function summaryOf(record: NodeRecord, text: string): CanvasSummaryNode {
  const node: CanvasSummaryNode = {
    id: record.id,
    type: record.type,
    parentId: record.parentId,
    x: round3(record.x),
    y: round3(record.y),
    w: round3(record.w),
    h: round3(record.h),
    rotation: record.rotation,
  };
  if (record.name) node.name = record.name;
  if ('fill' in record) node.fill = record.fill;
  if ('stroke' in record) node.stroke = record.stroke;
  if (record.type === 'text') node.color = record.color;
  if (text) node.text = text.slice(0, ASSISTANT_LIMITS.canvasTextMax);
  return node;
}

// Contexto para la IA: la selección primero y después lo que se ve, con sus contenedores, hasta `max` nodos y el
// tope de tamaño del servidor.
export function canvasSummary(view: SummaryView, pageId: string, selection: readonly string[], viewport: AABB, max: number = ASSISTANT_LIMITS.canvasMax): CanvasSummaryNode[] {
  const records = new Map<string, NodeRecord>();
  for (const record of view.records()) if (record.pageId === pageId) records.set(record.id, record);
  const picked = new Map<string, CanvasSummaryNode>();
  let bytes = 2;
  const add = (record: NodeRecord) => {
    if (picked.has(record.id) || picked.size >= max) return;
    const node = summaryOf(record, hasTextContent(record) ? view.text(record.id) : '');
    const size = JSON.stringify(node).length + 1;
    if (bytes + size > ASSISTANT_LIMITS.canvasBytesMax) return;
    bytes += size;
    picked.set(record.id, node);
  };
  for (const id of selection) {
    const record = records.get(id);
    if (record) add(record);
  }
  for (const record of records.values()) {
    const box = view.geometry(record.id);
    const visible = box ? box.minX <= viewport.maxX && box.maxX >= viewport.minX && box.minY <= viewport.maxY && box.maxY >= viewport.minY : record.type === 'group';
    if (visible) add(record);
  }
  // Un nodo con padre fuera del resumen lo pierde: la IA no conoce ese id.
  return [...picked.values()].map((node) => (node.parentId && !picked.has(node.parentId) ? { ...node, parentId: null } : node));
}
