import { z } from 'zod';
import { ANIMATION_LIMITS, DOCUMENT_LIMITS } from './limits.js';

export const DOCUMENT_SCHEMA_VERSION = 1;
export const MIN_CLIENT_SCHEMA_VERSION = 1;

export const NODE_TYPES = [
  'rect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'polygon',
  'arc',
  'line',
  'connector',
  'text',
  'image',
  'group',
  'frame',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// Familias autoalojadas en el cliente: el texto se ve igual en todos los equipos.
export const FONT_FAMILIES = ['Manrope', 'Inter', 'Source Serif 4', 'JetBrains Mono', 'Caveat', 'Montserrat', 'Lora', 'Space Grotesk'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];
export const FONT_WEIGHTS = [400, 500, 600, 700] as const;

export const NodeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{21}$/, 'id de nodo inválido');
export const ColorSchema = z.string().regex(/^#[0-9A-Fa-f]{8}$/, 'color #RRGGBBAA inválido');
export const IndexSchema = z
  .string()
  .min(1)
  .max(DOCUMENT_LIMITS.maxIndexLength * 2)
  .regex(/^[0-9A-Za-z]+$/, 'índice fraccional inválido');

const coordinate = z.number().finite().min(-DOCUMENT_LIMITS.maxCoordinate).max(DOCUMENT_LIMITS.maxCoordinate);
const size = z.number().finite().min(0).max(DOCUMENT_LIMITS.maxSize);
const unit = z.number().finite().min(0).max(1);
const point = z.tuple([coordinate, coordinate]);
const unitPoint = z.tuple([unit, unit]);

export const StrokeDashSchema = z.enum(['solid', 'dashed', 'dotted']);
export const CapSchema = z.enum(['none', 'arrow', 'triangle', 'circle', 'bar']);
export const AlignSchema = z.enum(['left', 'center', 'right']);
export const VAlignSchema = z.enum(['top', 'middle', 'bottom']);

export const ShadowSchema = z.object({
  x: z.number().finite().min(-1000).max(1000),
  y: z.number().finite().min(-1000).max(1000),
  blur: z.number().finite().min(0).max(100),
  color: ColorSchema,
});

const baseFields = {
  id: NodeIdSchema,
  pageId: NodeIdSchema,
  parentId: NodeIdSchema.nullable(),
  index: IndexSchema,
  x: coordinate,
  y: coordinate,
  w: size,
  h: size,
  rotation: z.number().finite().min(-Math.PI).max(Math.PI),
  opacity: unit,
  visible: z.boolean(),
  locked: z.boolean(),
  name: z.string().max(DOCUMENT_LIMITS.maxNameLength).optional(),
  createdBy: z.string().min(1).max(64),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
};

const styleFields = {
  fill: ColorSchema.nullable(),
  stroke: ColorSchema.nullable(),
  strokeWidth: z.number().finite().min(0).max(200),
  strokeDash: StrokeDashSchema,
  shadow: ShadowSchema.nullable(),
};

const labelFields = {
  labelFontSize: z.number().finite().min(4).max(800).optional(),
  labelColor: ColorSchema.optional(),
  labelAlign: AlignSchema.optional(),
  labelVAlign: VAlignSchema.optional(),
};

const shapeFields = { ...baseFields, ...styleFields, ...labelFields };

const cornerRadius = z.number().finite().min(0).max(DOCUMENT_LIMITS.maxSize / 2);

function cornerFits(node: { w: number; h: number; cornerRadius: number }) {
  return node.cornerRadius <= Math.min(node.w, node.h) / 2;
}

const cornerMessage = { message: 'cornerRadius no puede superar min(w, h) / 2', path: ['cornerRadius'] };

export const RectNodeSchema = z
  .object({ ...shapeFields, type: z.literal('rect'), cornerRadius })
  .refine(cornerFits, cornerMessage);

export const EllipseNodeSchema = z.object({ ...shapeFields, type: z.literal('ellipse') });
export const TriangleNodeSchema = z.object({ ...shapeFields, type: z.literal('triangle') });
export const DiamondNodeSchema = z.object({ ...shapeFields, type: z.literal('diamond') });

export const StarNodeSchema = z.object({
  ...shapeFields,
  type: z.literal('star'),
  points: z.number().int().min(3).max(64),
  innerRatio: z.number().finite().min(0.1).max(0.95),
});

export const PolygonNodeSchema = z
  .object({
    ...shapeFields,
    type: z.literal('polygon'),
    sides: z.number().int().min(3).max(64).optional(),
    vertices: z.array(unitPoint).min(3).max(DOCUMENT_LIMITS.maxPolygonVertices).optional(),
  })
  .refine((node) => (node.sides === undefined) !== (node.vertices === undefined), {
    message: 'un polígono lleva sides o vertices, no los dos',
    path: ['sides'],
  });

export const ArcNodeSchema = z.object({
  ...shapeFields,
  type: z.literal('arc'),
  startAngle: z.number().finite().min(-4 * Math.PI).max(4 * Math.PI),
  endAngle: z.number().finite().min(-4 * Math.PI).max(4 * Math.PI),
  innerRatio: z.number().finite().min(0).max(0.95),
});

export const LineNodeSchema = z.object({
  ...shapeFields,
  type: z.literal('line'),
  points: z.array(point).min(2).max(DOCUMENT_LIMITS.maxPoints),
  startCap: CapSchema,
  endCap: CapSchema,
});

export const AnchorSchema = z.union([
  z.enum(['top', 'right', 'bottom', 'left', 'center']),
  z.object({ u: unit, v: unit }),
]);

export const ConnectorEndSchema = z.union([
  z.object({ nodeId: NodeIdSchema, anchor: AnchorSchema }),
  z.object({ x: coordinate, y: coordinate }),
]);

export const ConnectorNodeSchema = z.object({
  ...shapeFields,
  type: z.literal('connector'),
  from: ConnectorEndSchema,
  to: ConnectorEndSchema,
  route: z.enum(['straight', 'elbow', 'curved']),
  startCap: CapSchema,
  endCap: CapSchema,
});

export const TextNodeSchema = z.object({
  ...baseFields,
  type: z.literal('text'),
  fontFamily: z.enum(FONT_FAMILIES),
  fontSize: z.number().finite().min(4).max(800),
  fontWeight: z.literal(FONT_WEIGHTS),
  italic: z.boolean(),
  underline: z.boolean(),
  strike: z.boolean(),
  color: ColorSchema,
  align: AlignSchema,
  lineHeight: z.number().finite().min(0.8).max(3),
  autoWidth: z.boolean(),
});

export const ImageNodeSchema = z
  .object({
    ...baseFields,
    type: z.literal('image'),
    assetId: z.uuid(),
    crop: z.object({ x: unit, y: unit, w: unit, h: unit }).optional(),
    fit: z.enum(['fill', 'contain', 'cover']),
    cornerRadius,
    alt: z.string().max(DOCUMENT_LIMITS.maxAltLength).optional(),
  })
  .refine(cornerFits, cornerMessage);

export const GroupNodeSchema = z.object({
  ...baseFields,
  type: z.literal('group'),
  w: z.literal(0),
  h: z.literal(0),
});

export const FrameNodeSchema = z.object({
  ...baseFields,
  type: z.literal('frame'),
  fill: ColorSchema.nullable(),
  clip: z.boolean(),
  presetName: z.string().max(32).optional(),
});

export const NodeSchema = z.discriminatedUnion('type', [
  RectNodeSchema,
  EllipseNodeSchema,
  TriangleNodeSchema,
  DiamondNodeSchema,
  StarNodeSchema,
  PolygonNodeSchema,
  ArcNodeSchema,
  LineNodeSchema,
  ConnectorNodeSchema,
  TextNodeSchema,
  ImageNodeSchema,
  GroupNodeSchema,
  FrameNodeSchema,
]);

export type DocumentNode = z.infer<typeof NodeSchema>;
export type NodeOf<T extends NodeType> = Extract<DocumentNode, { type: T }>;

export const CONTAINER_TYPES = ['group', 'frame'] as const satisfies readonly NodeType[];
export const TEXT_CONTENT_TYPES = ['text'] as const satisfies readonly NodeType[];

export const TextContentSchema = z.string().max(DOCUMENT_LIMITS.maxTextLength);

export const PageSchema = z.object({
  name: z.string().trim().min(1).max(DOCUMENT_LIMITS.maxNameLength),
  index: IndexSchema,
  background: ColorSchema.optional(),
});

export type Page = z.infer<typeof PageSchema>;

export const MetaSchema = z.object({
  schemaVersion: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  background: ColorSchema,
});

export type Meta = z.infer<typeof MetaSchema>;

export const ANIM_PROPS = ['offsetX', 'offsetY', 'rotation', 'scale', 'opacity', 'fill', 'stroke'] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];

export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack', 'step'] as const;

export const EasingSchema = z.union([
  z.enum(EASINGS),
  z.tuple([unit, z.number().finite().min(-10).max(10), unit, z.number().finite().min(-10).max(10)]),
]);

const COLOR_PROPS = new Set<AnimProp>(['fill', 'stroke']);

export const KeyframeSchema = z.object({
  t: unit,
  v: z.union([z.number().finite(), ColorSchema]),
  e: EasingSchema,
});

export type Keyframe = z.infer<typeof KeyframeSchema>;

const KeyframeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const TrackSchema = z
  .record(KeyframeIdSchema, KeyframeSchema)
  .refine((track) => Object.keys(track).length <= ANIMATION_LIMITS.maxKeyframesPerTrack, {
    message: `una pista admite como mucho ${ANIMATION_LIMITS.maxKeyframesPerTrack} keyframes`,
  });

export const AnimationSchema = z
  .object({
    duration: z.number().int().min(ANIMATION_LIMITS.minDurationMs).max(ANIMATION_LIMITS.maxDurationMs),
    delay: z.number().int().min(0).max(ANIMATION_LIMITS.maxDelayMs),
    loop: z.number().int().min(0).max(ANIMATION_LIMITS.maxLoop),
    direction: z.enum(['normal', 'alternate']),
    autoplay: z.enum(['none', 'present']),
    tracks: z.partialRecord(z.enum(ANIM_PROPS), TrackSchema),
  })
  .superRefine((animation, ctx) => {
    for (const [prop, track] of Object.entries(animation.tracks) as Array<[AnimProp, Record<string, Keyframe>]>) {
      const wantsColor = COLOR_PROPS.has(prop);
      for (const [id, keyframe] of Object.entries(track)) {
        if ((typeof keyframe.v === 'string') !== wantsColor) {
          ctx.addIssue({
            code: 'custom',
            message: wantsColor ? 'esta pista espera un color' : 'esta pista espera un número',
            path: ['tracks', prop, id, 'v'],
          });
        }
      }
    }
  });

export type Animation = z.infer<typeof AnimationSchema>;

export function parseNode(value: unknown) {
  return NodeSchema.safeParse(value);
}
