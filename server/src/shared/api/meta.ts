import { z } from 'zod';

export const AuthProviderSchema = z.enum(['email', 'google']);

export const MetaResponseSchema = z.object({
  sharedHash: z.string().regex(/^[0-9a-f]{64}$/),
  documentSchemaVersion: z.number().int().min(1),
  minClientSchemaVersion: z.number().int().min(1),
  authProviders: z.array(AuthProviderSchema),
  aiFeatures: z.object({
    assistant: z.boolean(),
    animation: z.boolean(),
    chat: z.boolean(),
    image: z.boolean(),
    vision: z.boolean(),
  }),
  limits: z.object({
    maxNodes: z.number().int(),
    createDisabledAtNodes: z.number().int(),
    maxNodesPerPage: z.number().int(),
    maxPages: z.number().int(),
    maxTextLength: z.number().int(),
    maxUploadBytes: z.number().int(),
    maxSmallUploadBytes: z.number().int(),
  }),
});

export type MetaResponse = z.infer<typeof MetaResponseSchema>;

export const HealthResponseSchema = z.object({ status: z.literal('ok') });

export const ReadyResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.record(z.string(), z.enum(['ok', 'fail'])),
});
