import { DefaultChatTransport, type UIMessage } from 'ai';
import type { CanvasSummaryNode } from '../shared/ai/assistant.js';
import { AiChatMetadataSchema, AiConversationDetailSchema, AiConversationListSchema } from '../shared/api/ai.js';
import { ErrorResponseSchema } from '../shared/api/errors.js';
import { API_ORIGIN, apiFetch, errorMessage } from './api.ts';

export type AiChatMessage = UIMessage<{ conversationId?: string }>;

export function listConversations(projectId: string) {
  return apiFetch(`/v1/projects/${projectId}/ai/conversations`, { schema: AiConversationListSchema });
}

// Mensajes guardados en el formato de la clase Chat.
export async function loadConversation(projectId: string, conversationId: string): Promise<AiChatMessage[]> {
  const detail = await apiFetch(`/v1/projects/${projectId}/ai/conversations/${conversationId}`, { schema: AiConversationDetailSchema });
  return detail.messages.map((message) => ({ id: message.id, role: message.role, parts: message.parts }));
}

export function conversationOf(message: AiChatMessage | undefined): string | null {
  const parsed = AiChatMetadataSchema.safeParse(message?.metadata);
  return parsed.success ? parsed.data.conversationId : null;
}

// Un error JSON de la API pasa a su mensaje traducido; la clase Chat lo muestra tal cual.
const chatFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.ok) return response;
  const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
  throw new Error(errorMessage(parsed.success ? parsed.data.error.code : response.status === 429 ? 'RATE_LIMITED' : 'INTERNAL'));
};

// Transporte a la API (otro origen) con la cookie de sesión. Solo viaja el mensaje nuevo: el historial lo pone el
// servidor desde la base de datos.
export function chatTransport(
  context: () => { projectId: string; conversationId: string | null; canvas: CanvasSummaryNode[]; imageAssetIds: string[] },
) {
  return new DefaultChatTransport<AiChatMessage>({
    credentials: 'include',
    fetch: chatFetch,
    prepareSendMessagesRequest: ({ messages }) => {
      const { projectId, conversationId, canvas, imageAssetIds } = context();
      const last = messages.at(-1)!;
      return {
        api: `${API_ORIGIN}/v1/projects/${projectId}/ai/chat`,
        body: {
          ...(conversationId ? { conversationId } : {}),
          message: { id: last.id, role: 'user', parts: last.parts.filter((part) => part.type === 'text') },
          ...(canvas.length ? { canvas } : {}),
          ...(imageAssetIds.length ? { imageAssetIds } : {}),
        },
      };
    },
  });
}
