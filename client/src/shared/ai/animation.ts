import { z } from 'zod';
import { ANIMATION_LIMITS, DOCUMENT_LIMITS } from '../document/limits.js';
import { AnimationSchema, EASINGS, NodeIdSchema, type Animation, type AnimProp, type Keyframe, type NodeType } from '../document/schema.js';
import { ASSISTANT_LIMITS, CanvasSummaryNodeSchema, normalizeColor } from './assistant.js';

export const AI_ANIMATION_LIMITS = {
  promptMax: 2_000,
  nodeIdsMax: 50,
  canvasMax: 300,
  summaryMax: 500,
  // Tope del multiplicador de escala y del giro (grados) que se acepta del modelo.
  scaleMax: 20,
  rotationDegMax: 3_600,
} as const;

// ── Petición ──

export const AnimationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(AI_ANIMATION_LIMITS.promptMax),
  nodeIds: z.array(NodeIdSchema).min(1).max(AI_ANIMATION_LIMITS.nodeIdsMax),
  canvas: z.array(CanvasSummaryNodeSchema).max(AI_ANIMATION_LIMITS.canvasMax),
});

export type AnimationRequest = z.infer<typeof AnimationRequestSchema>;

// ── Salida del modelo ──
// Pistas como listas (más fáciles de generar que mapas con claves libres) y giro en grados. Permisiva en rangos:
// lo que se sale se recorta en sanitizeAnimationPlan.

const MODEL_PROPS = ['offsetX', 'offsetY', 'rotationDeg', 'scale', 'opacity', 'fill', 'stroke'] as const;

export const AnimationInputSchema = z.object({
  duration: z.number(),
  delay: z.number().optional(),
  loop: z.number().optional(),
  direction: z.enum(['normal', 'alternate']).optional(),
  tracks: z.array(
    z.object({
      prop: z.enum(MODEL_PROPS),
      keyframes: z.array(
        z.object({
          t: z.number(),
          v: z.union([z.number(), z.string()]),
          e: z.union([z.enum(EASINGS), z.array(z.number())]).optional(),
        }),
      ),
    }),
  ),
});

export const AnimationPlanSchema = z.object({
  summary: z.string(),
  animations: z.array(z.object({ nodeId: z.string(), animation: AnimationInputSchema })),
});

export type AnimationModelPlan = z.infer<typeof AnimationPlanSchema>;

// ── Plan ya recortado: animaciones completas del modelo del documento ──

export const AnimationPlanResultSchema = z.object({
  summary: z.string().max(AI_ANIMATION_LIMITS.summaryMax),
  animations: z
    .array(z.object({ nodeId: NodeIdSchema, animation: AnimationSchema }))
    .max(AI_ANIMATION_LIMITS.nodeIdsMax),
});

export type AnimationPlan = z.infer<typeof AnimationPlanResultSchema>;

export const AnimationResponseSchema = z.object({
  plan: AnimationPlanResultSchema,
  // Animaciones del modelo descartadas (nodos fuera de la petición, repetidos o sin pistas utilizables).
  dropped: z.number().int().min(0),
  usage: z.object({ units: z.number().int(), inputTokens: z.number().int(), outputTokens: z.number().int() }),
});

export type AnimationResponse = z.infer<typeof AnimationResponseSchema>;

// ── Recorte ──

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function easing(value: unknown): Keyframe['e'] {
  if ((EASINGS as readonly unknown[]).includes(value)) return value as Keyframe['e'];
  if (Array.isArray(value) && value.length === 4 && value.every(isNum)) {
    const [x1, y1, x2, y2] = value as [number, number, number, number];
    return [clamp(x1, 0, 1), clamp(y1, -10, 10), clamp(x2, 0, 1), clamp(y2, -10, 10)];
  }
  return 'linear';
}

// Valor del documento para una pista, o null si no sirve.
function trackValue(prop: (typeof MODEL_PROPS)[number], value: unknown): number | string | null {
  if (prop === 'fill' || prop === 'stroke') {
    const color = normalizeColor(value);
    return typeof color === 'string' ? color : null;
  }
  if (!isNum(value)) return null;
  switch (prop) {
    case 'offsetX':
    case 'offsetY':
      return clamp(value, -DOCUMENT_LIMITS.maxCoordinate, DOCUMENT_LIMITS.maxCoordinate);
    case 'rotationDeg':
      return (clamp(value, -AI_ANIMATION_LIMITS.rotationDegMax, AI_ANIMATION_LIMITS.rotationDegMax) * Math.PI) / 180;
    case 'scale':
      return clamp(value, 0, AI_ANIMATION_LIMITS.scaleMax);
    case 'opacity':
      return clamp(value, 0, 1);
  }
}

function cleanAnimation(input: z.infer<typeof AnimationInputSchema>): Animation | null {
  if (!isNum(input.duration)) return null;
  const tracks: Animation['tracks'] = {};
  for (const track of input.tracks) {
    const prop: AnimProp = track.prop === 'rotationDeg' ? 'rotation' : track.prop;
    if (tracks[prop]) continue;
    const keyframes = track.keyframes
      .flatMap((keyframe) => {
        const v = trackValue(track.prop, keyframe.v);
        if (v === null || !isNum(keyframe.t)) return [];
        return [{ t: Math.round(clamp(keyframe.t, 0, 1) * 10_000) / 10_000, v, e: easing(keyframe.e) }];
      })
      .sort((a, b) => a.t - b.t)
      .slice(0, ANIMATION_LIMITS.maxKeyframesPerTrack);
    if (!keyframes.length) continue;
    tracks[prop] = Object.fromEntries(keyframes.map((keyframe, index) => [`k${index}`, keyframe]));
  }
  if (!Object.keys(tracks).length) return null;
  const parsed = AnimationSchema.safeParse({
    duration: Math.round(clamp(input.duration, ANIMATION_LIMITS.minDurationMs, ANIMATION_LIMITS.maxDurationMs)),
    delay: Math.round(clamp(isNum(input.delay) ? input.delay : 0, 0, ANIMATION_LIMITS.maxDelayMs)),
    loop: Math.round(clamp(isNum(input.loop) ? input.loop : 1, 0, ANIMATION_LIMITS.maxLoop)),
    direction: input.direction ?? 'normal',
    autoplay: 'none',
    tracks,
  });
  return parsed.success ? parsed.data : null;
}

export type AnimationSanitizeContext = {
  // Los nodos que el usuario pidió animar.
  nodeIds: ReadonlySet<string>;
  // Tipos conocidos del lienzo enviado: los conectores no se animan.
  canvas: ReadonlyMap<string, NodeType>;
};

// Recorta la salida del modelo y descarta lo que no se puede aplicar: nodos que no estaban en la petición,
// repetidos, conectores y animaciones sin ninguna pista utilizable.
export function sanitizeAnimationPlan(raw: AnimationModelPlan, context: AnimationSanitizeContext): { plan: AnimationPlan; dropped: number } {
  const seen = new Set<string>();
  const animations: AnimationPlan['animations'] = [];
  let dropped = 0;
  for (const entry of raw.animations) {
    const nodeId = entry.nodeId.trim();
    if (!context.nodeIds.has(nodeId) || seen.has(nodeId) || context.canvas.get(nodeId) === 'connector' || animations.length >= AI_ANIMATION_LIMITS.nodeIdsMax) {
      dropped++;
      continue;
    }
    const animation = cleanAnimation(entry.animation);
    if (!animation) {
      dropped++;
      continue;
    }
    seen.add(nodeId);
    animations.push({ nodeId, animation });
  }
  const summary = raw.summary.trim().slice(0, AI_ANIMATION_LIMITS.summaryMax);
  return { plan: AnimationPlanResultSchema.parse({ summary, animations }), dropped };
}

export const ANIMATION_CANVAS_BYTES_MAX = ASSISTANT_LIMITS.canvasBytesMax;
