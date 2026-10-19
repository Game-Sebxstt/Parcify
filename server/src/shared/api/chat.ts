import { z } from 'zod';
import { AuthIdSchema, IsoDateSchema, UuidSchema } from './common.js';

export const CHAT_LIMITS = {
  bodyMax: 4000,
  attachmentsMax: 4,
  mentionsMax: 20,
  pageMax: 50,
  excerptMax: 140,
} as const;

const BodySchema = z.string().trim().min(1).max(CHAT_LIMITS.bodyMax);
const MentionsSchema = z.array(AuthIdSchema).max(CHAT_LIMITS.mentionsMax);

export const ChatMessageSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  // name nulo: la cuenta ya no existe.
  author: z.object({ id: AuthIdSchema, name: z.string().nullable(), avatarAssetId: UuidSchema.nullable() }),
  // Vacío si el mensaje está borrado.
  body: z.string(),
  replyTo: z
    .object({ id: UuidSchema, authorName: z.string().nullable(), excerpt: z.string(), deleted: z.boolean() })
    .nullable(),
  attachments: z.array(UuidSchema),
  mentions: z.array(AuthIdSchema),
  editedAt: IsoDateSchema.nullable(),
  deletedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
});

export type ChatMessageDto = z.infer<typeof ChatMessageSchema>;

export const ChatParamsSchema = z.object({ id: UuidSchema });
export const ChatMessageParamsSchema = ChatParamsSchema.extend({ msgId: UuidSchema });

export const ChatListQuerySchema = z.object({
  before: UuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_LIMITS.pageMax).default(CHAT_LIMITS.pageMax),
});

// Del más antiguo al más reciente; nextCursor es el id del más antiguo si quedan anteriores.
export const ChatListResponseSchema = z.object({ items: z.array(ChatMessageSchema), nextCursor: UuidSchema.nullable() });

export const CreateChatMessageBodySchema = z
  .object({
    body: BodySchema,
    replyToId: UuidSchema.optional(),
    attachments: z.array(UuidSchema).max(CHAT_LIMITS.attachmentsMax).optional(),
    mentions: MentionsSchema.optional(),
  })
  .strict();

export const UpdateChatMessageBodySchema = z.object({ body: BodySchema, mentions: MentionsSchema.optional() }).strict();
