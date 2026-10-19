import { z } from 'zod';
import { DOCUMENT_LIMITS } from './limits.js';

export const ROOT_KEYS = {
  meta: 'meta',
  pages: 'pages',
  nodes: 'nodes',
  texts: 'texts',
  animations: 'animations',
} as const;

export type RootKey = (typeof ROOT_KEYS)[keyof typeof ROOT_KEYS];

export const META_KEYS = {
  schemaVersion: 'schemaVersion',
  createdAt: 'createdAt',
  background: 'background',
} as const;

const DOCUMENT_PREFIX = 'project:';

export function documentNameFor(projectId: string): string {
  return DOCUMENT_PREFIX + projectId;
}

export function projectIdFromDocumentName(documentName: string): string | null {
  if (!documentName.startsWith(DOCUMENT_PREFIX)) return null;
  const id = documentName.slice(DOCUMENT_PREFIX.length);
  return id.length > 0 ? id : null;
}

export type ServerOriginKind = 'init' | 'migration' | 'server-normalize' | 'restore';

export type ServerOrigin = { source: 'local'; context: { kind: ServerOriginKind } };

export function serverOrigin(kind: ServerOriginKind): ServerOrigin {
  return { source: 'local', context: { kind } };
}

const finite = z.number().finite();
const rect = z.object({ x: finite, y: finite, w: finite.min(0), h: finite.min(0) });
const nodeIdList = z.array(z.string().min(1).max(64)).max(DOCUMENT_LIMITS.maxSelectionIds);

export const PresenceStateSchema = z.object({
  user: z.object({
    id: z.string().min(1).max(64),
    name: z.string().max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    avatarAssetId: z.uuid().nullable(),
  }),
  pageId: z.string().min(1).max(64),
  cursor: z.object({ x: finite, y: finite }).nullable(),
  viewport: z.object({ x: finite, y: finite, zoom: finite.positive() }),
  selection: nodeIdList,
  selectionBox: rect.nullable(),
  marquee: rect.nullable(),
  gesture: z
    .object({
      ids: z.union([z.literal('selection'), nodeIdList]),
      matrix: z.tuple([finite, finite, finite, finite, finite, finite]),
      style: z
        .partialRecord(z.enum(['fill', 'stroke', 'opacity', 'strokeWidth', 'cornerRadius']), z.unknown())
        .optional(),
    })
    .nullable(),
  editingText: z
    .object({ nodeId: z.string().min(1).max(64), anchor: z.string().max(512), head: z.string().max(512) })
    .nullable(),
  chatTyping: z.boolean(),
  aiBusy: z.boolean(),
});

export type PresenceState = z.infer<typeof PresenceStateSchema>;
