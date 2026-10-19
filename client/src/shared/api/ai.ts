import { z } from 'zod';
import { ASSISTANT_LIMITS, CanvasSummaryNodeSchema } from '../ai/assistant.js';
import { AuthIdSchema, IsoDateSchema, UuidSchema } from './common.js';

export const AiUsageFeatureSchema = z.enum(['assistant', 'image', 'animation', 'chat']);

export const AiUsageQuerySchema = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
  .strict();

const UnitsByFeatureSchema = z.object({
  assistant: z.number().int(),
  image: z.number().int(),
  animation: z.number().int(),
  chat: z.number().int(),
});

export const AiUsageResponseSchema = z.object({
  // YYYY-MM en UTC.
  month: z.string(),
  limits: z.object({ workspaceMonthlyUnits: z.number().int(), userDailyUnits: z.number().int() }),
  totalUnits: z.number().int(),
  users: z.array(
    z.object({
      userId: AuthIdSchema,
      // Nulo si la cuenta ya no existe.
      name: z.string().nullable(),
      units: z.number().int(),
      requests: z.number().int(),
      byFeature: UnitsByFeatureSchema,
    }),
  ),
});

export type AiUsageResponse = z.infer<typeof AiUsageResponseSchema>;

export const AiQuotaExceededDetailsSchema = z.object({
  scope: z.enum(['workspace', 'user']),
  resetsAt: z.iso.datetime({ offset: true }),
});

// ── Chat de IA ──

export const AI_CHAT_LIMITS = {
  messageMax: 4_000,
  // Tope de un mensaje guardado: cubre de sobra una respuesta completa del modelo.
  storedMessageMax: 32_000,
  historyMessages: 30,
  conversationsListed: 50,
  messagesListed: 100,
  titleMax: 120,
} as const;

export const AiTextPartSchema = z.object({ type: z.literal('text'), text: z.string().max(AI_CHAT_LIMITS.messageMax) });

// El mensaje nuevo del usuario en formato UIMessage; solo partes de texto. Las claves desconocidas se ignoran.
export const AiChatUserMessageSchema = z
  .object({
    id: z.string().min(1).max(128),
    role: z.literal('user'),
    parts: z.array(AiTextPartSchema).min(1).max(8),
  })
  .refine(
    (message) => {
      const text = message.parts.map((part) => part.text).join('').trim();
      return text.length > 0 && text.length <= AI_CHAT_LIMITS.messageMax;
    },
    { message: `el mensaje debe tener entre 1 y ${AI_CHAT_LIMITS.messageMax} caracteres`, path: ['parts'] },
  );

export const AiChatBodySchema = z.object({
  conversationId: UuidSchema.optional(),
  message: AiChatUserMessageSchema,
  canvas: z.array(CanvasSummaryNodeSchema).max(ASSISTANT_LIMITS.chatCanvasMax).optional(),
  // Imágenes del proyecto que acompañan a este mensaje (solo a este turno; no se guardan en el historial).
  imageAssetIds: z.array(UuidSchema).max(ASSISTANT_LIMITS.imagesMax).optional(),
});

export type AiChatBody = z.infer<typeof AiChatBodySchema>;

export const AiConversationParamsSchema = z.object({ id: UuidSchema, conversationId: UuidSchema });

export const AiConversationSchema = z.object({
  id: UuidSchema,
  title: z.string().nullable(),
  updatedAt: IsoDateSchema,
});

export const AiConversationListSchema = z.object({ items: z.array(AiConversationSchema) });

export const AiStoredTextPartSchema = z.object({ type: z.literal('text'), text: z.string().max(AI_CHAT_LIMITS.storedMessageMax) });

export const AiStoredMessageSchema = z.object({
  id: UuidSchema,
  role: z.enum(['user', 'assistant']),
  parts: z.array(AiStoredTextPartSchema),
  createdAt: IsoDateSchema,
});

export type AiStoredMessage = z.infer<typeof AiStoredMessageSchema>;

export const AiConversationDetailSchema = AiConversationSchema.extend({ messages: z.array(AiStoredMessageSchema) });

// Metadatos del mensaje del asistente en el stream: el cliente aprende el id de una conversación nueva.
export const AiChatMetadataSchema = z.object({ conversationId: UuidSchema });

// ── Generación de imágenes ──

export const AI_IMAGE_LIMITS = { promptMax: 2_000, countMax: 4 } as const;

export const AI_IMAGE_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
export type AiImageAspect = (typeof AI_IMAGE_ASPECTS)[number];

export const AiImageRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(AI_IMAGE_LIMITS.promptMax),
    count: z.number().int().min(1).max(AI_IMAGE_LIMITS.countMax),
    aspect: z.enum(AI_IMAGE_ASPECTS),
  })
  .strict();

export type AiImageRequest = z.infer<typeof AiImageRequestSchema>;

export const AiJobAcceptedSchema = z.object({ jobId: UuidSchema });

export const AI_JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const AiJobParamsSchema = z.object({ jobId: UuidSchema });

export const AiJobSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  status: z.enum(AI_JOB_STATUSES),
  count: z.number().int(),
  // Imágenes guardadas en la galería del proyecto (pueden ser menos que count).
  assetIds: z.array(UuidSchema),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export type AiJob = z.infer<typeof AiJobSchema>;
