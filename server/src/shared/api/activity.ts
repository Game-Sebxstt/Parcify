import { z } from 'zod';
import { AuthIdSchema, IsoDateSchema, UuidSchema } from './common.js';

export const ACTIVITY_LIMITS = {
  maxRangeDays: 90,
  defaultRangeDays: 30,
  eventsPageMax: 50,
} as const;

export const ActivityParamsSchema = z.object({ id: UuidSchema });

export const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Días UTC inclusivos; sin from/to se usan los últimos 30 días.
export const ActivityRangeQuerySchema = z.object({
  from: DaySchema.optional(),
  to: DaySchema.optional(),
});

export const ActivityCountersSchema = z.object({
  editOps: z.number().int().nonnegative(),
  activeMinutes: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  nodesCreated: z.number().int().nonnegative(),
  nodesDeleted: z.number().int().nonnegative(),
  chatMessages: z.number().int().nonnegative(),
  versionsCreated: z.number().int().nonnegative(),
  aiActions: z.number().int().nonnegative(),
});

export type ActivityCounters = z.infer<typeof ActivityCountersSchema>;

export const ActivityUserSchema = z.object({
  id: AuthIdSchema,
  // null: la cuenta ya no existe.
  name: z.string().nullable(),
  avatarAssetId: UuidSchema.nullable(),
});

export const ActivityPointSchema = ActivityCountersSchema.extend({ userId: AuthIdSchema, day: DaySchema });

export const ActivityUserTotalsSchema = ActivityCountersSchema.extend({ userId: AuthIdSchema });

const ActivityReportSchema = z.object({
  from: DaySchema,
  to: DaySchema,
  users: z.array(ActivityUserSchema),
  // Solo los días con actividad, ordenados por día y usuario.
  series: z.array(ActivityPointSchema),
  byUser: z.array(ActivityUserTotalsSchema),
  totals: ActivityCountersSchema,
  // Recuento actual de elementos por tipo.
  nodeCountByType: z.record(z.string(), z.number().int().nonnegative()),
});

export const ProjectActivityResponseSchema = ActivityReportSchema;

export type ProjectActivityResponse = z.infer<typeof ProjectActivityResponseSchema>;

export const WorkspaceActivityResponseSchema = ActivityReportSchema.extend({
  projects: z.array(z.object({ id: UuidSchema, name: z.string(), totals: ActivityCountersSchema })),
});

export type WorkspaceActivityResponse = z.infer<typeof WorkspaceActivityResponseSchema>;

export const ActivityEventsQuerySchema = z.object({
  cursor: UuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_LIMITS.eventsPageMax).default(20),
});

export const ActivityEventSchema = z.object({
  id: UuidSchema,
  type: z.string(),
  // null en eventos sin autor.
  actor: ActivityUserSchema.nullable(),
  data: z.record(z.string(), z.unknown()),
  createdAt: IsoDateSchema,
});

export type ActivityEventDto = z.infer<typeof ActivityEventSchema>;

// Del más reciente al más antiguo; nextCursor es el id del último si quedan más.
export const ActivityEventsResponseSchema = z.object({ items: z.array(ActivityEventSchema), nextCursor: UuidSchema.nullable() });
