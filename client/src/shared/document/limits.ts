const KiB = 1024;
const MiB = 1024 * KiB;

export const DOCUMENT_LIMITS = {
  maxNodes: 20_000,
  createDisabledAtNodes: 19_500,
  maxNodesPerPage: 10_000,
  maxPages: 100,
  maxTextLength: 20_000,
  maxPoints: 512,
  maxWaypoints: 64,
  maxPolygonVertices: 512,
  sizeWarnBytes: 15 * MiB,
  sizeReadOnlyBytes: 25 * MiB,
  maxMessageBytes: 2 * MiB,
  maxAwarenessBytes: 32 * KiB,
  maxSelectionIds: 500,
  maxIndexLength: 64,
  maxNameLength: 80,
  maxAltLength: 300,
  maxCoordinate: 1e6,
  maxSize: 1e5,
} as const;

export const COLLAB_LIMITS = {
  defaultMaxConnectionsPerDocument: 100,
  maxConnectionsPerUserPerDocument: 8,
  maxDocumentsPerInstance: 2_000,
  readyDocumentRatio: 0.9,
  updatesPerSecond: 60,
  updatesBurst: 300,
  awarenessPerSecond: 40,
  strikeLimit: 20,
  strikeWindowMs: 60_000,
  normalizeBatchMs: 200,
} as const;

export const ANIMATION_LIMITS = {
  minDurationMs: 100,
  maxDurationMs: 60_000,
  maxDelayMs: 60_000,
  maxLoop: 100,
  maxKeyframesPerTrack: 64,
  maxAnimatedNodes: 2_000,
} as const;
