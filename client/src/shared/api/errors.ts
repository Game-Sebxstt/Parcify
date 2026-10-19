import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'INVALID_ASSET',
  'INVALID_ATTACHMENT',
  'INVALID_ARCHIVE',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'BAD_ORIGIN',
  'EMAIL_NOT_VERIFIED',
  'SESSION_NOT_FRESH',
  'NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'WORKSPACE_NOT_FOUND',
  'ASSET_NOT_FOUND',
  'INVITE_NOT_FOUND',
  'INVITE_EMAIL_MISMATCH',
  'CONFLICT',
  'LAST_OWNER',
  'PERSONAL_WORKSPACE',
  'WORKSPACE_IN_TRASH',
  'MUST_TRANSFER_OWNERSHIP',
  'MEMBERSHIP_LIMIT',
  'INVITE_ALREADY_HANDLED',
  'DOCUMENT_RELOADED',
  'RESTORE_IN_PROGRESS',
  'INVITE_EXPIRED',
  'INVITE_REVOKED',
  'INVITE_USED_UP',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_FILE',
  'PROCESSING_TIMEOUT',
  'AI_REFUSED',
  'RATE_LIMITED',
  'AI_QUOTA_EXCEEDED',
  'INTERNAL',
  'AI_BAD_OUTPUT',
  'AI_PROVIDER_ERROR',
  'STORAGE_ERROR',
  'SERVICE_UNAVAILABLE',
  'COLLAB_UNAVAILABLE',
  'AI_BUSY',
  'AI_JOB_LOST',
  'AI_PROVIDER_BUSY',
  'AI_TIMEOUT',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ValidationIssueSchema = z.object({ path: z.string(), message: z.string() });

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
    requestId: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
