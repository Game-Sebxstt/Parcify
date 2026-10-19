import { AnimationResponseSchema, type AnimationRequest, type AnimationResponse } from '../shared/ai/animation.js';
import { AssistantResponseSchema, type AssistantRequest, type AssistantResponse } from '../shared/ai/assistant.js';
import { AiJobAcceptedSchema, AiJobSchema, type AiImageRequest, type AiJob } from '../shared/api/ai.js';
import { MetaResponseSchema, type MetaResponse } from '../shared/api/meta.js';
import { apiFetch, cached } from './api.ts';

export type AiFeatures = MetaResponse['aiFeatures'];

export async function loadAiFeatures(): Promise<AiFeatures> {
  const meta = await cached('meta', () => apiFetch('/v1/meta', { schema: MetaResponseSchema, redirectOn401: false }));
  return meta.aiFeatures;
}

// La respuesta se valida con el esquema antes de llegar a la vista previa: nada sin validar se aplica.
export function requestAssistant(projectId: string, body: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
  return apiFetch(`/v1/projects/${projectId}/ai/assistant`, {
    method: 'POST',
    body,
    schema: AssistantResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

// Como el asistente: la propuesta llega validada y solo se escribe si el usuario la aplica.
export function requestAnimation(projectId: string, body: AnimationRequest, signal?: AbortSignal): Promise<AnimationResponse> {
  return apiFetch(`/v1/projects/${projectId}/ai/animation`, {
    method: 'POST',
    body,
    schema: AnimationResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function requestImages(projectId: string, body: AiImageRequest): Promise<string> {
  const accepted = await apiFetch(`/v1/projects/${projectId}/ai/images`, { method: 'POST', body, schema: AiJobAcceptedSchema });
  return accepted.jobId;
}

export function fetchAiJob(jobId: string): Promise<AiJob> {
  return apiFetch(`/v1/ai/jobs/${jobId}`, { schema: AiJobSchema });
}
