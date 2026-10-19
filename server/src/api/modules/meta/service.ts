import type { Config } from '../../../core/config.js';
import { sharedHash } from '../../../core/shared-hash.js';
import { MAX_SMALL_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from '../../../shared/api/assets.js';
import type { MetaResponse } from '../../../shared/api/meta.js';
import { DOCUMENT_LIMITS } from '../../../shared/document/limits.js';
import { DOCUMENT_SCHEMA_VERSION, MIN_CLIENT_SCHEMA_VERSION } from '../../../shared/document/schema.js';

export function buildMeta(config: Config): MetaResponse {
  const models = config.ai.models;
  return {
    sharedHash: sharedHash(),
    documentSchemaVersion: DOCUMENT_SCHEMA_VERSION,
    minClientSchemaVersion: MIN_CLIENT_SCHEMA_VERSION,
    authProviders: config.google ? ['email', 'google'] : ['email'],
    aiFeatures: {
      assistant: Boolean(models.assistant),
      animation: Boolean(models.animation),
      chat: Boolean(models.chat),
      image: Boolean(models.image),
      vision: Boolean(models.vision ?? models.assistant),
    },
    limits: {
      maxNodes: DOCUMENT_LIMITS.maxNodes,
      createDisabledAtNodes: DOCUMENT_LIMITS.createDisabledAtNodes,
      maxNodesPerPage: DOCUMENT_LIMITS.maxNodesPerPage,
      maxPages: DOCUMENT_LIMITS.maxPages,
      maxTextLength: DOCUMENT_LIMITS.maxTextLength,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxSmallUploadBytes: MAX_SMALL_UPLOAD_BYTES,
    },
  };
}
