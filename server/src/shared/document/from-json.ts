import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { newNodeId } from './ids.js';
import { DEFAULT_BACKGROUND, DEFAULT_PAGE_NAME } from './init.js';
import { META_KEYS, ROOT_KEYS, serverOrigin } from './keys.js';
import { ANIMATION_LIMITS, DOCUMENT_LIMITS } from './limits.js';
import { DocumentTooNewError, migrate } from './migrations.js';
import { createTouches, normalizeDocument, type TouchInfo } from './normalize.js';
import {
  AnimationSchema,
  ColorSchema,
  DOCUMENT_SCHEMA_VERSION,
  NodeIdSchema,
  NodeSchema,
  PageSchema,
  type NodeType,
} from './schema.js';
import { documentToJson, type DocumentJson } from './to-json.js';

export class InvalidDocumentError extends Error {
  constructor(readonly reason: string) {
    super(`document.json no es válido: ${reason}`);
    this.name = 'InvalidDocumentError';
  }
}

// Nodos cuyo contenido vive en `texts[id]`.
const TEXT_HOSTS = new Set<NodeType>(['text', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc', 'connector']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function section(value: unknown, name: string, optional = false): Record<string, unknown> {
  if (value === undefined && optional) return {};
  if (!isRecord(value)) throw new InvalidDocumentError(`falta ${name}`);
  return value;
}

// Comprueba la forma general y la versión de esquema; los nodos se validan uno a uno al construir el documento.
export function readDocumentJson(value: unknown): DocumentJson {
  if (!isRecord(value)) throw new InvalidDocumentError('no es un objeto');
  const meta = section(value.meta, 'meta');
  const schemaVersion = meta.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new InvalidDocumentError('schemaVersion');
  }
  if (schemaVersion > DOCUMENT_SCHEMA_VERSION) throw new InvalidDocumentError('schema_too_new');
  const texts = section(value.texts, 'texts', true);
  return {
    meta: { ...meta, schemaVersion },
    pages: section(value.pages, 'pages'),
    nodes: section(value.nodes, 'nodes'),
    texts: Object.fromEntries(Object.entries(texts).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    animations: section(value.animations, 'animations', true),
  };
}

// Ids de asset que citan los nodos de imagen, sin repetir.
export function referencedAssets(data: DocumentJson): string[] {
  const ids = new Set<string>();
  for (const node of Object.values(data.nodes)) {
    if (isRecord(node) && node.type === 'image' && typeof node.assetId === 'string' && UUID.test(node.assetId)) {
      ids.add(node.assetId.toLowerCase());
    }
  }
  return [...ids];
}

function mapOf(entries: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) map.set(key, value);
  return map;
}

function animationMap(animation: Record<string, unknown>): Y.Map<unknown> {
  const { tracks, ...settings } = animation;
  const map = mapOf(settings);
  const trackMaps = new Y.Map<unknown>();
  for (const [prop, track] of Object.entries(isRecord(tracks) ? tracks : {})) {
    if (isRecord(track)) trackMaps.set(prop, mapOf(track));
  }
  map.set('tracks', trackMaps);
  return map;
}

// Lleva un document.json de una versión antigua a la actual con las migraciones del documento Yjs.
function migrated(data: DocumentJson): DocumentJson {
  if (data.meta.schemaVersion === DOCUMENT_SCHEMA_VERSION) return data;
  const raw = new Y.Doc();
  try {
    raw.transact(() => {
      raw.getMap(ROOT_KEYS.meta).set(META_KEYS.schemaVersion, data.meta.schemaVersion);
      for (const [root, entries] of [
        [ROOT_KEYS.pages, data.pages],
        [ROOT_KEYS.nodes, data.nodes],
      ] as const) {
        const target = raw.getMap(root);
        for (const [id, value] of Object.entries(entries)) if (isRecord(value)) target.set(id, mapOf(value));
      }
      for (const [id, value] of Object.entries(data.texts)) raw.getMap(ROOT_KEYS.texts).set(id, new Y.Text(value));
      for (const [id, value] of Object.entries(data.animations)) {
        if (isRecord(value)) raw.getMap(ROOT_KEYS.animations).set(id, animationMap(value));
      }
    });
    migrate(raw);
    const result = documentToJson(raw);
    // El Y.Doc provisional solo lleva la versión; el resto del meta (el fondo, por ejemplo) viene del archivo.
    result.meta = { ...data.meta, ...result.meta };
    // Las entradas que no son objetos no caben en el Y.Doc, pero se cuentan como nodos descartados.
    for (const [id, value] of Object.entries(data.nodes)) if (!isRecord(value)) result.nodes[id] = value;
    return result;
  } catch (error) {
    if (error instanceof DocumentTooNewError) throw new InvalidDocumentError('schema_too_new');
    throw new InvalidDocumentError('migration');
  } finally {
    raw.destroy();
  }
}

export interface FromJsonOptions {
  // Asset de origen → asset nuevo. Las imágenes sin entrada se descartan.
  assetIds: ReadonlyMap<string, string>;
  // Autor de los nodos importados (createdBy).
  userId: string;
  now?: number;
  limits?: Partial<{ maxNodes: number; maxPages: number }>;
}

export interface FromJsonResult {
  doc: Y.Doc;
  droppedNodes: number;
}

// Construye un Y.Doc nuevo: valida cada página, nodo, texto y animación, descarta lo inválido y lo cuenta, y
// termina con la normalización del servidor (padres, conectores, límites) como si todo fuera recién creado.
export function documentFromJson(input: DocumentJson, options: FromJsonOptions): FromJsonResult {
  const data = migrated(input);
  const maxNodes = options.limits?.maxNodes ?? DOCUMENT_LIMITS.maxNodes;
  const maxPages = options.limits?.maxPages ?? DOCUMENT_LIMITS.maxPages;
  const doc = new Y.Doc();
  let droppedNodes = 0;
  const pageIds = new Set<string>();
  const nodeTypes = new Map<string, NodeType>();

  doc.transact(() => {
    const meta = doc.getMap(ROOT_KEYS.meta);
    meta.set(META_KEYS.schemaVersion, DOCUMENT_SCHEMA_VERSION);
    meta.set(META_KEYS.createdAt, options.now ?? Date.now());
    const background = ColorSchema.safeParse(data.meta.background);
    meta.set(META_KEYS.background, background.success ? background.data : DEFAULT_BACKGROUND);

    const pages = doc.getMap(ROOT_KEYS.pages);
    for (const id of Object.keys(data.pages).sort()) {
      if (pageIds.size >= maxPages || !NodeIdSchema.safeParse(id).success) continue;
      const page = PageSchema.safeParse(data.pages[id]);
      if (!page.success) continue;
      pages.set(id, mapOf(page.data));
      pageIds.add(id);
    }
    if (pageIds.size === 0) {
      const id = newNodeId();
      pages.set(id, mapOf({ name: DEFAULT_PAGE_NAME, index: generateKeyBetween(null, null) }));
      pageIds.add(id);
    }

    const nodes = doc.getMap(ROOT_KEYS.nodes);
    for (const id of Object.keys(data.nodes).sort()) {
      const value = data.nodes[id];
      if (nodeTypes.size >= maxNodes || !NodeIdSchema.safeParse(id).success || !isRecord(value)) {
        droppedNodes++;
        continue;
      }
      const candidate: Record<string, unknown> = { ...value, id, createdBy: options.userId };
      if (candidate.type === 'image') {
        const next = typeof value.assetId === 'string' ? options.assetIds.get(value.assetId.toLowerCase()) : undefined;
        if (!next) {
          droppedNodes++;
          continue;
        }
        candidate.assetId = next;
      }
      const parsed = NodeSchema.safeParse(candidate);
      if (!parsed.success || !pageIds.has(parsed.data.pageId)) {
        droppedNodes++;
        continue;
      }
      nodes.set(id, mapOf(parsed.data as Record<string, unknown>));
      nodeTypes.set(id, parsed.data.type);
    }

    const texts = doc.getMap(ROOT_KEYS.texts);
    for (const [id, value] of Object.entries(data.texts)) {
      const type = nodeTypes.get(id);
      if (type && TEXT_HOSTS.has(type)) texts.set(id, new Y.Text(value.slice(0, DOCUMENT_LIMITS.maxTextLength)));
    }

    const animations = doc.getMap(ROOT_KEYS.animations);
    for (const id of Object.keys(data.animations).sort()) {
      if (animations.size >= ANIMATION_LIMITS.maxAnimatedNodes || !nodeTypes.has(id)) continue;
      const parsed = AnimationSchema.safeParse(data.animations[id]);
      if (parsed.success) animations.set(id, animationMap(parsed.data as Record<string, unknown>));
    }
  }, serverOrigin('init'));

  const touches = createTouches();
  const touch = (): TouchInfo => ({ actor: null, userId: options.userId, created: true });
  for (const id of pageIds) touches.pages.set(id, touch());
  for (const id of nodeTypes.keys()) touches.nodes.set(id, touch());
  doc.getMap(ROOT_KEYS.texts).forEach((_value, id) => touches.texts.set(id, touch()));
  doc.getMap(ROOT_KEYS.animations).forEach((_value, id) => touches.animations.set(id, touch()));
  const { corrections } = normalizeDocument(doc, touches, serverOrigin('server-normalize'), {
    limits: { maxNodes, maxPages },
  });
  droppedNodes += corrections.filter((correction) => correction.op === 'delete' && correction.target === 'node').length;
  return { doc, droppedNodes };
}
