import { Prisma } from '../generated/prisma/client.js';
import type { Db } from './db.js';

export type ActivityType =
  | 'project.created'
  | 'project.deleted'
  | 'project.restored'
  | 'project.duplicated'
  | 'member.added'
  | 'member.role_changed'
  | 'member.removed'
  | 'member.left'
  | 'version.created'
  | 'version.restored';

type ActivityClient = Pick<Db, 'activityEvent'> | Prisma.TransactionClient;

// Los datos nunca llevan tokens, códigos ni contraseñas: solo ids y roles.
export async function recordActivity(
  db: ActivityClient,
  event: { type: ActivityType; actorId: string; projectId?: string | null; data?: Record<string, string> },
): Promise<void> {
  await db.activityEvent.create({
    data: { type: event.type, actorId: event.actorId, projectId: event.projectId ?? null, data: event.data ?? {} },
  });
}

export type DailyCounter = 'chatMessages' | 'versionsCreated' | 'aiActions';

// Lista cerrada de columnas: el nombre nunca sale de la entrada.
const DAILY_COLUMNS: Record<DailyCounter, Prisma.Sql> = {
  chatMessages: Prisma.raw('"chatMessages"'),
  versionsCreated: Prisma.raw('"versionsCreated"'),
  aiActions: Prisma.raw('"aiActions"'),
};

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// Upsert del contador del día (UTC) dentro de la transacción de la acción.
export async function incrementDaily(
  db: Pick<Db, '$executeRaw'> | Prisma.TransactionClient,
  input: { projectId: string; userId: string; counter: DailyCounter; by?: number; at?: Date },
): Promise<void> {
  const column = DAILY_COLUMNS[input.counter];
  const by = input.by ?? 1;
  const day = utcDay(input.at ?? new Date());
  await db.$executeRaw`
    INSERT INTO "ActivityDaily" ("projectId", "userId", "day", ${column})
    VALUES (${input.projectId}::uuid, ${input.userId}, ${day}::date, ${by})
    ON CONFLICT ("projectId", "userId", "day")
    DO UPDATE SET ${column} = "ActivityDaily".${column} + EXCLUDED.${column}`;
}

export interface EditCounters {
  editOps: number;
  nodesCreated: number;
  nodesDeleted: number;
  activeMinutes: number;
  sessions: number;
}

// Upsert aditivo de los contadores que acumula collab; day en formato yyyy-mm-dd (UTC).
export async function addEditCounters(
  db: Pick<Db, '$executeRaw'>,
  input: { projectId: string; userId: string; day: string; counters: EditCounters },
): Promise<void> {
  const { editOps, nodesCreated, nodesDeleted, activeMinutes, sessions } = input.counters;
  await db.$executeRaw`
    INSERT INTO "ActivityDaily" ("projectId", "userId", "day", "editOps", "nodesCreated", "nodesDeleted", "activeMinutes", "sessions")
    VALUES (${input.projectId}::uuid, ${input.userId}, ${input.day}::date, ${editOps}, ${nodesCreated}, ${nodesDeleted}, ${activeMinutes}, ${sessions})
    ON CONFLICT ("projectId", "userId", "day") DO UPDATE SET
      "editOps" = "ActivityDaily"."editOps" + EXCLUDED."editOps",
      "nodesCreated" = "ActivityDaily"."nodesCreated" + EXCLUDED."nodesCreated",
      "nodesDeleted" = "ActivityDaily"."nodesDeleted" + EXCLUDED."nodesDeleted",
      "activeMinutes" = "ActivityDaily"."activeMinutes" + EXCLUDED."activeMinutes",
      "sessions" = "ActivityDaily"."sessions" + EXCLUDED."sessions"`;
}
