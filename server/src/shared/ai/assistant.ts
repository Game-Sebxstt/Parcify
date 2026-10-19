import { z } from 'zod';
import { UuidSchema } from '../api/common.js';
import { DOCUMENT_LIMITS } from '../document/limits.js';
import {
  AlignSchema,
  CapSchema,
  ColorSchema,
  FONT_FAMILIES,
  FONT_WEIGHTS,
  NODE_TYPES,
  NodeIdSchema,
  StrokeDashSchema,
  type NodeType,
} from '../document/schema.js';

export const ASSISTANT_LIMITS = {
  promptMax: 2_000,
  selectionMax: 300,
  canvasMax: 300,
  canvasBytesMax: 200 * 1024,
  chatCanvasMax: 100,
  imagesMax: 4,
  summaryMax: 500,
  opsMax: 200,
  textMax: 2_000,
  canvasTextMax: 200,
  bodyLimitBytes: 1024 * 1024,
} as const;

// Tipos que el asistente puede crear: sin imágenes (no puede inventar assets) ni conectores.
export const AI_CREATE_TYPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'line', 'text', 'frame'] as const;
export type AiCreateType = (typeof AI_CREATE_TYPES)[number];

const finite = z.number().finite();

// ── Petición ──

export const CanvasSummaryNodeSchema = z.object({
  id: NodeIdSchema,
  type: z.enum(NODE_TYPES),
  parentId: NodeIdSchema.nullable(),
  x: finite,
  y: finite,
  w: finite,
  h: finite,
  rotation: finite,
  name: z.string().max(DOCUMENT_LIMITS.maxNameLength).optional(),
  fill: ColorSchema.nullable().optional(),
  stroke: ColorSchema.nullable().optional(),
  color: ColorSchema.optional(),
  text: z.string().max(ASSISTANT_LIMITS.canvasTextMax).optional(),
});

export type CanvasSummaryNode = z.infer<typeof CanvasSummaryNodeSchema>;

export const ViewportSchema = z.object({ x: finite, y: finite, w: finite.min(0), h: finite.min(0) });

export const AssistantRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(ASSISTANT_LIMITS.promptMax),
  pageId: NodeIdSchema,
  viewport: ViewportSchema,
  selection: z.array(NodeIdSchema).max(ASSISTANT_LIMITS.selectionMax),
  canvas: z.array(CanvasSummaryNodeSchema).max(ASSISTANT_LIMITS.canvasMax),
  imageAssetIds: z.array(UuidSchema).max(ASSISTANT_LIMITS.imagesMax).optional(),
});

export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;

// ── Salida del modelo ──
// Permisiva a propósito: los valores fuera de rango se recortan después (sanitizeAssistantPlan) en vez de tirar
// la respuesta entera. Lo que no encaja en la forma sí es AI_BAD_OUTPUT.

const modelNodeFields = {
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotationDeg: z.number().optional(),
  opacity: z.number().optional(),
  visible: z.boolean().optional(),
  name: z.string().optional(),
  fill: z.string().nullable().optional(),
  stroke: z.string().nullable().optional(),
  strokeWidth: z.number().optional(),
  strokeDash: StrokeDashSchema.optional(),
  cornerRadius: z.number().optional(),
  starPoints: z.number().optional(),
  sides: z.number().optional(),
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  endCap: CapSchema.optional(),
  text: z.string().optional(),
  fontFamily: z.enum(FONT_FAMILIES).optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  color: z.string().optional(),
  align: AlignSchema.optional(),
};

const modelPatchFields = Object.fromEntries(
  Object.entries(modelNodeFields).map(([key, schema]) => [key, schema.optional()]),
) as { [K in keyof typeof modelNodeFields]: z.ZodOptional<(typeof modelNodeFields)[K]> };

export const AssistantPlanSchema = z.object({
  summary: z.string(),
  ops: z.array(
    z.discriminatedUnion('op', [
      z.object({
        op: z.literal('create'),
        tempId: z.string(),
        node: z.object({ type: z.enum(AI_CREATE_TYPES), parentId: z.string().nullable().optional(), ...modelNodeFields }),
      }),
      z.object({ op: z.literal('update'), id: z.string(), patch: z.object(modelPatchFields) }),
      z.object({ op: z.literal('delete'), id: z.string() }),
    ]),
  ),
});

export type AssistantModelPlan = z.infer<typeof AssistantPlanSchema>;

// ── Plan ya recortado (respuesta y lo que aplica el cliente) ──

const coordinate = finite.min(-DOCUMENT_LIMITS.maxCoordinate).max(DOCUMENT_LIMITS.maxCoordinate);
const size = finite.min(0).max(DOCUMENT_LIMITS.maxSize);
const TempIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const nodeFields = {
  x: coordinate,
  y: coordinate,
  w: size,
  h: size,
  rotation: finite.min(-Math.PI).max(Math.PI).optional(),
  opacity: finite.min(0).max(1).optional(),
  visible: z.boolean().optional(),
  name: z.string().max(DOCUMENT_LIMITS.maxNameLength).optional(),
  fill: ColorSchema.nullable().optional(),
  stroke: ColorSchema.nullable().optional(),
  strokeWidth: finite.min(0).max(200).optional(),
  strokeDash: StrokeDashSchema.optional(),
  cornerRadius: finite.min(0).max(DOCUMENT_LIMITS.maxSize / 2).optional(),
  starPoints: z.number().int().min(3).max(64).optional(),
  sides: z.number().int().min(3).max(64).optional(),
  points: z.array(z.tuple([coordinate, coordinate])).min(2).max(DOCUMENT_LIMITS.maxPoints).optional(),
  endCap: CapSchema.optional(),
  text: z.string().max(ASSISTANT_LIMITS.textMax).optional(),
  fontFamily: z.enum(FONT_FAMILIES).optional(),
  fontSize: finite.min(4).max(800).optional(),
  fontWeight: z.literal(FONT_WEIGHTS).optional(),
  color: ColorSchema.optional(),
  align: AlignSchema.optional(),
};

export const AiNodeInputSchema = z.object({
  type: z.enum(AI_CREATE_TYPES),
  // Id de un contenedor del lienzo o tempId de un frame creado antes en el mismo plan.
  parentId: z.string().max(64).nullable(),
  ...nodeFields,
});

export const AiNodePatchSchema = z.object(nodeFields).partial();

export type AiNodeInput = z.infer<typeof AiNodeInputSchema>;
export type AiNodePatch = z.infer<typeof AiNodePatchSchema>;

export const AssistantOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), tempId: TempIdSchema, node: AiNodeInputSchema }),
  z.object({ op: z.literal('update'), id: NodeIdSchema, patch: AiNodePatchSchema }),
  z.object({ op: z.literal('delete'), id: NodeIdSchema }),
]);

export type AssistantOp = z.infer<typeof AssistantOpSchema>;

export const AssistantPlanResultSchema = z.object({
  summary: z.string().max(ASSISTANT_LIMITS.summaryMax),
  ops: z.array(AssistantOpSchema).max(ASSISTANT_LIMITS.opsMax),
});

export type AssistantPlan = z.infer<typeof AssistantPlanResultSchema>;

export const AssistantResponseSchema = z.object({
  plan: AssistantPlanResultSchema,
  // Operaciones del modelo descartadas al recortar (ids que no estaban en el lienzo, valores inservibles).
  dropped: z.number().int().min(0),
  usage: z.object({ units: z.number().int(), inputTokens: z.number().int(), outputTokens: z.number().int() }),
});

export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;

// ── Recorte ──

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const CONTAINERS = new Set<NodeType>(['group', 'frame']);

// #RGB, #RRGGBB o #RRGGBBAA a #RRGGBBAA en mayúsculas; cualquier otra cosa no es un color.
export function normalizeColor(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  let full: string;
  if (hex.length === 3) full = [...hex].map((c) => c + c).join('') + 'FF';
  else if (hex.length === 6) full = `${hex}FF`;
  else if (hex.length === 8) full = hex;
  else return undefined;
  return `#${full.toUpperCase()}`;
}

function nearestWeight(value: number): (typeof FONT_WEIGHTS)[number] {
  let best: (typeof FONT_WEIGHTS)[number] = FONT_WEIGHTS[0];
  for (const weight of FONT_WEIGHTS) if (Math.abs(weight - value) < Math.abs(best - value)) best = weight;
  return best;
}

function degreesToRadians(deg: number): number {
  const turn = ((((deg + 180) % 360) + 360) % 360) - 180;
  return clamp((turn * Math.PI) / 180, -Math.PI, Math.PI);
}

type ModelFields = Partial<Record<keyof typeof modelNodeFields, unknown>>;

// Solo las claves presentes y utilizables; un valor inservible se omite (no invalida el op).
function cleanFields(raw: ModelFields, box: boolean): AiNodePatch {
  const out: AiNodePatch = {};
  const { maxCoordinate, maxSize, maxNameLength, maxPoints } = DOCUMENT_LIMITS;
  if (isNum(raw.x)) out.x = clamp(raw.x, -maxCoordinate, maxCoordinate);
  if (isNum(raw.y)) out.y = clamp(raw.y, -maxCoordinate, maxCoordinate);
  if (isNum(raw.w)) out.w = clamp(raw.w, box ? 1 : 0, maxSize);
  if (isNum(raw.h)) out.h = clamp(raw.h, box ? 1 : 0, maxSize);
  if (isNum(raw.rotationDeg)) out.rotation = degreesToRadians(raw.rotationDeg);
  if (isNum(raw.opacity)) out.opacity = clamp(raw.opacity, 0, 1);
  if (typeof raw.visible === 'boolean') out.visible = raw.visible;
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, maxNameLength);
  for (const key of ['fill', 'stroke'] as const) {
    const color = normalizeColor(raw[key]);
    if (color !== undefined) out[key] = color;
  }
  const color = normalizeColor(raw.color);
  if (typeof color === 'string') out.color = color;
  if (isNum(raw.strokeWidth)) out.strokeWidth = clamp(raw.strokeWidth, 0, 200);
  if (StrokeDashSchema.safeParse(raw.strokeDash).success) out.strokeDash = raw.strokeDash as AiNodePatch['strokeDash'];
  if (isNum(raw.cornerRadius)) out.cornerRadius = clamp(raw.cornerRadius, 0, maxSize / 2);
  if (isNum(raw.starPoints)) out.starPoints = clamp(Math.round(raw.starPoints), 3, 64);
  if (isNum(raw.sides)) out.sides = clamp(Math.round(raw.sides), 3, 64);
  if (Array.isArray(raw.points)) {
    const points = raw.points
      .filter((p): p is [number, number] => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))
      .slice(0, maxPoints)
      .map(([px, py]) => [clamp(px, -maxCoordinate, maxCoordinate), clamp(py, -maxCoordinate, maxCoordinate)] as [number, number]);
    if (points.length >= 2) out.points = points;
  }
  if (CapSchema.safeParse(raw.endCap).success) out.endCap = raw.endCap as AiNodePatch['endCap'];
  if (typeof raw.text === 'string') out.text = raw.text.slice(0, ASSISTANT_LIMITS.textMax);
  if ((FONT_FAMILIES as readonly unknown[]).includes(raw.fontFamily)) out.fontFamily = raw.fontFamily as AiNodePatch['fontFamily'];
  if (isNum(raw.fontSize)) out.fontSize = clamp(raw.fontSize, 4, 800);
  if (isNum(raw.fontWeight)) out.fontWeight = nearestWeight(raw.fontWeight);
  if (AlignSchema.safeParse(raw.align).success) out.align = raw.align as AiNodePatch['align'];
  return out;
}

export type SanitizeContext = {
  // Nodos que el cliente mandó como contexto (o los que existen ahora, al aplicar): id → tipo.
  canvas: ReadonlyMap<string, NodeType>;
};

// Recorta la salida del modelo y descarta lo que no se puede aplicar: update/delete sobre ids que no estaban en
// el lienzo, padres que no son contenedores conocidos, tempIds repetidos y ops sin efecto.
export function sanitizeAssistantPlan(raw: AssistantModelPlan, context: SanitizeContext): { plan: AssistantPlan; dropped: number } {
  const ops: AssistantOp[] = [];
  const tempFrames = new Set<string>();
  const tempIds = new Set<string>();
  const deleted = new Set<string>();
  const updated = new Set<string>();
  let dropped = Math.max(0, raw.ops.length - ASSISTANT_LIMITS.opsMax);

  for (const op of raw.ops.slice(0, ASSISTANT_LIMITS.opsMax)) {
    if (op.op === 'create') {
      const tempId = op.tempId.trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(tempId) || tempIds.has(tempId) || context.canvas.has(tempId)) {
        dropped++;
        continue;
      }
      const fields = cleanFields(op.node as ModelFields, true);
      if (fields.x === undefined || fields.y === undefined || fields.w === undefined || fields.h === undefined) {
        dropped++;
        continue;
      }
      if (op.node.type === 'line' && !fields.points) {
        dropped++;
        continue;
      }
      const parent = op.node.parentId ?? null;
      const parentType = parent ? context.canvas.get(parent) : undefined;
      const parentId = parent && ((parentType && CONTAINERS.has(parentType)) || tempFrames.has(parent)) ? parent : null;
      tempIds.add(tempId);
      if (op.node.type === 'frame') tempFrames.add(tempId);
      ops.push({ op: 'create', tempId, node: { type: op.node.type, parentId, ...fields } as AiNodeInput });
      continue;
    }
    const id = op.id.trim();
    if (!context.canvas.has(id) || deleted.has(id)) {
      dropped++;
      continue;
    }
    if (op.op === 'delete') {
      deleted.add(id);
      ops.push({ op: 'delete', id });
      continue;
    }
    const patch = cleanFields(op.patch as ModelFields, false);
    if (updated.has(id) || Object.keys(patch).length === 0) {
      dropped++;
      continue;
    }
    updated.add(id);
    ops.push({ op: 'update', id, patch });
  }

  // Un update sobre un id que el mismo plan borra después no tiene efecto.
  const result = ops.filter((op) => {
    const gone = op.op === 'update' && deleted.has(op.id);
    if (gone) dropped++;
    return !gone;
  });
  const summary = raw.summary.trim().slice(0, ASSISTANT_LIMITS.summaryMax);
  return { plan: AssistantPlanResultSchema.parse({ summary, ops: result }), dropped };
}
