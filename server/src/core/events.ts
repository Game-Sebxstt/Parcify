import { z } from 'zod';
import type { Redis } from './redis.js';

export const PROJECT_CHANNEL_PREFIX = 'parcify:evt:project:';
export const ORG_CHANNEL_PREFIX = 'parcify:evt:org:';
export const EVENT_PATTERNS = [`${PROJECT_CHANNEL_PREFIX}*`, `${ORG_CHANNEL_PREFIX}*`] as const;

const projectEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('access.changed'), userId: z.string().min(1) }),
  z.object({ type: z.literal('project.deleted') }),
  z.object({ type: z.literal('doc.readonly'), reason: z.enum(['size']) }),
  z.object({ type: z.literal('asset.ready'), assetId: z.uuid() }),
  z.object({ type: z.literal('asset.deleted'), assetId: z.uuid() }),
  z.object({ type: z.literal('chat.message'), message: z.record(z.string(), z.unknown()) }),
  z.object({
    type: z.literal('ai.job'),
    userId: z.string().min(1),
    jobId: z.string().min(1),
    status: z.enum(['queued', 'running', 'done', 'failed']),
  }),
]);

const orgEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('access.changed'), userId: z.string().min(1) }),
  z.object({ type: z.literal('workspace.deleted') }),
]);

export type ProjectEvent = z.infer<typeof projectEventSchema>;
export type OrgEvent = z.infer<typeof orgEventSchema>;

export type ReceivedEvent =
  | { scope: 'project'; projectId: string; event: ProjectEvent }
  | { scope: 'org'; organizationId: string; event: OrgEvent };

export function projectChannel(projectId: string): string {
  return PROJECT_CHANNEL_PREFIX + projectId;
}

export function orgChannel(organizationId: string): string {
  return ORG_CHANNEL_PREFIX + organizationId;
}

type Publisher = Pick<Redis, 'publish'>;

export async function publishProjectEvent(redis: Publisher, projectId: string, event: ProjectEvent): Promise<void> {
  await redis.publish(projectChannel(projectId), JSON.stringify(projectEventSchema.parse(event)));
}

export async function publishOrgEvent(redis: Publisher, organizationId: string, event: OrgEvent): Promise<void> {
  await redis.publish(orgChannel(organizationId), JSON.stringify(orgEventSchema.parse(event)));
}

export function parseEvent(channel: string, message: string): ReceivedEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }
  if (channel.startsWith(PROJECT_CHANNEL_PREFIX)) {
    const projectId = channel.slice(PROJECT_CHANNEL_PREFIX.length);
    const parsed = projectEventSchema.safeParse(payload);
    return parsed.success && projectId ? { scope: 'project', projectId, event: parsed.data } : null;
  }
  if (channel.startsWith(ORG_CHANNEL_PREFIX)) {
    const organizationId = channel.slice(ORG_CHANNEL_PREFIX.length);
    const parsed = orgEventSchema.safeParse(payload);
    return parsed.success && organizationId ? { scope: 'org', organizationId, event: parsed.data } : null;
  }
  return null;
}
