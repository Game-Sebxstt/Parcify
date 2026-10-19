import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { ROOT_KEYS } from './keys.js';
import { ANIMATION_LIMITS, DOCUMENT_LIMITS } from './limits.js';
import {
  AnimationSchema,
  CONTAINER_TYPES,
  ConnectorEndSchema,
  IndexSchema,
  NODE_TYPES,
  NodeIdSchema,
  NodeSchema,
  PageSchema,
} from './schema.js';

// Quién tocó cada entrada en el lote: `actor` identifica la conexión (para los strikes) y `userId` a la persona.
export interface TouchInfo {
  actor: string | null;
  userId: string | null;
  created: boolean;
  previousCreatedBy?: unknown;
}

export interface Touches {
  nodes: Map<string, TouchInfo>;
  pages: Map<string, TouchInfo>;
  texts: Map<string, TouchInfo>;
  animations: Map<string, TouchInfo>;
  deletedNodes: Set<string>;
  deletedPages: Set<string>;
}

export function createTouches(): Touches {
  return {
    nodes: new Map(),
    pages: new Map(),
    texts: new Map(),
    animations: new Map(),
    deletedNodes: new Set(),
    deletedPages: new Set(),
  };
}

export function hasTouches(touches: Touches): boolean {
  return (
    touches.nodes.size + touches.pages.size + touches.texts.size + touches.animations.size > 0 ||
    touches.deletedNodes.size + touches.deletedPages.size > 0
  );
}

type TouchedRoot = 'nodes' | 'pages' | 'texts' | 'animations';

function mark(map: Map<string, TouchInfo>, id: string, info: TouchInfo) {
  const previous = map.get(id);
  if (!previous) {
    map.set(id, info);
    return;
  }
  previous.created ||= info.created;
  if (previous.previousCreatedBy === undefined && info.previousCreatedBy !== undefined) {
    previous.previousCreatedBy = info.previousCreatedBy;
  }
  previous.actor = info.actor ?? previous.actor;
  previous.userId = info.userId ?? previous.userId;
}

// Debe llamarse dentro del observador: Yjs solo calcula `changes` mientras dura el evento.
export function recordTouches(
  touches: Touches,
  root: TouchedRoot,
  rootType: Y.AbstractType<unknown>,
  events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
  who: { actor: string | null; userId: string | null },
): void {
  const map = touches[root];
  for (const event of events) {
    if (event.target === rootType) {
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') {
          map.delete(key);
          if (root === 'nodes') touches.deletedNodes.add(key);
          if (root === 'pages') touches.deletedPages.add(key);
          return;
        }
        if (root === 'nodes') touches.deletedNodes.delete(key);
        if (root === 'pages') touches.deletedPages.delete(key);
        mark(map, key, { ...who, created: true });
      });
      continue;
    }
    const id = event.path[0];
    if (typeof id !== 'string') continue;
    let previousCreatedBy: unknown;
    if (root === 'nodes' && event.target instanceof Y.Map) {
      const change = event.changes.keys.get('createdBy');
      if (change && change.action !== 'add') previousCreatedBy = change.oldValue;
    }
    mark(map, id, { ...who, created: false, previousCreatedBy });
  }
}

export type CorrectionTarget = 'node' | 'page' | 'text' | 'animation';

export type Correction =
  | { op: 'set'; target: 'node' | 'page'; id: string; key: string; value: unknown; actor: string | null; reason: string }
  | { op: 'unset'; target: 'node' | 'page'; id: string; key: string; actor: string | null; reason: string }
  | { op: 'delete'; target: CorrectionTarget; id: string; actor: string | null; reason: string }
  | { op: 'truncate'; target: 'text'; id: string; length: number; actor: string | null; reason: string };

export type LimitKind = 'nodes' | 'pages' | 'animations';

export interface NormalizeResult {
  corrections: Correction[];
  limits: Array<{ what: LimitKind; actor: string | null }>;
}

export interface NormalizeOptions {
  limits?: Partial<{
    maxNodes: number;
    maxNodesPerPage: number;
    maxPages: number;
    maxTextLength: number;
    maxAnimatedNodes: number;
  }>;
}

const C = DOCUMENT_LIMITS.maxCoordinate;
const S = DOCUMENT_LIMITS.maxSize;

type Range = readonly [min: number, max: number, fallback: number, integer?: boolean];

const COMMON_NUMBERS: Record<string, Range> = {
  x: [-C, C, 0],
  y: [-C, C, 0],
  w: [0, S, 0],
  h: [0, S, 0],
  opacity: [0, 1, 1],
  strokeWidth: [0, 200, 0],
  labelFontSize: [4, 800, 16],
};

const TYPE_NUMBERS: Partial<Record<string, Record<string, Range>>> = {
  star: { points: [3, 64, 5, true], innerRatio: [0.1, 0.95, 0.5] },
  polygon: { sides: [3, 64, 6, true] },
  arc: { startAngle: [-4 * Math.PI, 4 * Math.PI, 0], endAngle: [-4 * Math.PI, 4 * Math.PI, Math.PI], innerRatio: [0, 0.95, 0] },
  text: { fontSize: [4, 800, 16], lineHeight: [0.8, 3, 1.2] },
};

const CONTAINERS = new Set<string>(CONTAINER_TYPES);
const KNOWN_TYPES = new Set<string>(NODE_TYPES);

function clampValue(value: number, [min, max, fallback, integer]: Range): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = integer ? Math.round(value) : value;
  return Math.min(max, Math.max(min, rounded));
}

export function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= -Math.PI && value <= Math.PI) return value;
  const turn = 2 * Math.PI;
  const wrapped = (((value + Math.PI) % turn) + turn) % turn - Math.PI;
  return wrapped < -Math.PI ? -Math.PI : wrapped;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampPoints(value: unknown, max: number, range: Range): unknown {
  if (!Array.isArray(value)) return value;
  return value.slice(0, max).map((point) =>
    Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number')
      ? [clampValue(point[0] as number, range), clampValue(point[1] as number, range)]
      : point,
  );
}

function clampShadow(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const next = { ...value };
  for (const key of ['x', 'y'] as const) {
    if (typeof next[key] === 'number') next[key] = clampValue(next[key], [-1000, 1000, 0]);
  }
  if (typeof next.blur === 'number') next.blur = clampValue(next.blur, [0, 100, 0]);
  return next;
}

// Lectura del documento con las correcciones pendientes aplicadas encima.
class Overlay {
  readonly pending = new Map<string, Map<string, unknown>>();
  readonly removedKeys = new Map<string, Set<string>>();
  readonly deletedNodes = new Set<string>();
  readonly deletedPages = new Set<string>();

  constructor(
    readonly nodes: Y.Map<unknown>,
    readonly pages: Y.Map<unknown>,
  ) {}

  nodeMap(id: string): Y.Map<unknown> | null {
    if (this.deletedNodes.has(id)) return null;
    const value = this.nodes.get(id);
    return value instanceof Y.Map ? (value as Y.Map<unknown>) : null;
  }

  pageExists(id: string): boolean {
    return !this.deletedPages.has(id) && this.pages.get(id) instanceof Y.Map;
  }

  get(id: string, key: string): unknown {
    const pending = this.pending.get(id);
    if (pending?.has(key)) return pending.get(key);
    if (this.removedKeys.get(id)?.has(key)) return undefined;
    return this.nodeMap(id)?.get(key);
  }

  set(id: string, key: string, value: unknown) {
    let pending = this.pending.get(id);
    if (!pending) this.pending.set(id, (pending = new Map()));
    pending.set(key, value);
  }

  json(id: string): Record<string, unknown> | null {
    const map = this.nodeMap(id);
    if (!map) return null;
    const value = map.toJSON() as Record<string, unknown>;
    for (const key of this.removedKeys.get(id) ?? []) delete value[key];
    for (const [key, next] of this.pending.get(id) ?? []) value[key] = next;
    return value;
  }
}

class Planner {
  readonly corrections: Correction[] = [];
  readonly limits: NormalizeResult['limits'] = [];
  readonly overlay: Overlay;
  readonly texts: Y.Map<unknown>;
  readonly animations: Y.Map<unknown>;
  readonly limitsConfig: Required<NonNullable<NormalizeOptions['limits']>>;

  constructor(
    readonly doc: Y.Doc,
    readonly touches: Touches,
    options: NormalizeOptions,
  ) {
    this.overlay = new Overlay(doc.getMap(ROOT_KEYS.nodes), doc.getMap(ROOT_KEYS.pages));
    this.texts = doc.getMap(ROOT_KEYS.texts);
    this.animations = doc.getMap(ROOT_KEYS.animations);
    this.limitsConfig = {
      maxNodes: DOCUMENT_LIMITS.maxNodes,
      maxNodesPerPage: DOCUMENT_LIMITS.maxNodesPerPage,
      maxPages: DOCUMENT_LIMITS.maxPages,
      maxTextLength: DOCUMENT_LIMITS.maxTextLength,
      maxAnimatedNodes: ANIMATION_LIMITS.maxAnimatedNodes,
      ...options.limits,
    };
  }

  setNode(id: string, key: string, value: unknown, actor: string | null, reason: string) {
    if (sameJson(this.overlay.get(id, key), value)) return;
    this.overlay.set(id, key, value);
    this.corrections.push({ op: 'set', target: 'node', id, key, value, actor, reason });
  }

  deleteNode(id: string, actor: string | null, reason: string) {
    if (this.overlay.deletedNodes.has(id) || !this.overlay.nodes.has(id)) return;
    this.overlay.deletedNodes.add(id);
    this.corrections.push({ op: 'delete', target: 'node', id, actor, reason });
  }

  deletePage(id: string, actor: string | null, reason: string) {
    if (this.overlay.deletedPages.has(id) || !this.overlay.pages.has(id)) return;
    this.overlay.deletedPages.add(id);
    this.corrections.push({ op: 'delete', target: 'page', id, actor, reason });
  }

  run(): NormalizeResult {
    this.repairPages();
    this.enforcePageLimit();
    for (const id of [...this.touches.nodes.keys()].sort()) this.repairNode(id, this.touches.nodes.get(id)!);
    this.enforceNodeLimits();
    this.repairRelations();
    this.repairTexts();
    this.repairAnimations();
    return { corrections: this.corrections, limits: this.limits };
  }

  private repairPages() {
    const pages = this.overlay.pages;
    for (const id of [...this.touches.pages.keys()].sort()) {
      const actor = this.touches.pages.get(id)!.actor;
      const value = pages.get(id);
      if (value === undefined) continue;
      if (!(value instanceof Y.Map) || !NodeIdSchema.safeParse(id).success) {
        this.deletePage(id, actor, 'invalid_page');
        continue;
      }
      const page = value as Y.Map<unknown>;
      const name = page.get('name');
      if (typeof name !== 'string' || name.trim().length === 0) {
        this.pushPageSet(id, 'name', 'Página', actor, 'page_name');
      } else if (name.trim().length > DOCUMENT_LIMITS.maxNameLength || name !== name.trim()) {
        this.pushPageSet(id, 'name', name.trim().slice(0, DOCUMENT_LIMITS.maxNameLength), actor, 'page_name');
      }
      if (!IndexSchema.safeParse(page.get('index')).success) {
        this.pushPageSet(id, 'index', this.nextPageIndex(), actor, 'page_index');
      }
      const background = page.get('background');
      if (background !== undefined && !PageSchema.shape.background.safeParse(background).success) {
        this.corrections.push({ op: 'unset', target: 'page', id, key: 'background', actor, reason: 'page_background' });
      }
    }
  }

  private pushPageSet(id: string, key: string, value: unknown, actor: string | null, reason: string) {
    this.corrections.push({ op: 'set', target: 'page', id, key, value, actor, reason });
  }

  private nextPageIndex(): string {
    let max: string | null = null;
    this.overlay.pages.forEach((value) => {
      const index = value instanceof Y.Map ? value.get('index') : undefined;
      if (IndexSchema.safeParse(index).success && (max === null || (index as string) > max)) max = index as string;
    });
    return generateKeyBetween(max, null);
  }

  private enforcePageLimit() {
    const live = [...this.overlay.pages.keys()].filter((id) => this.overlay.pageExists(id));
    let excess = live.length - this.limitsConfig.maxPages;
    if (excess <= 0) return;
    const created = [...this.touches.pages.entries()]
      .filter(([id, info]) => info.created && this.overlay.pageExists(id))
      .map(([id]) => id)
      .sort()
      .reverse();
    for (const id of created) {
      if (excess <= 0) break;
      const actor = this.touches.pages.get(id)!.actor;
      this.deletePage(id, actor, 'page_limit');
      this.limits.push({ what: 'pages', actor });
      excess--;
    }
  }

  private repairNode(id: string, touch: TouchInfo) {
    const actor = touch.actor;
    const raw = this.overlay.nodes.get(id);
    if (raw === undefined) return;
    if (!(raw instanceof Y.Map) || !NodeIdSchema.safeParse(id).success) {
      this.deleteNode(id, actor, 'invalid_node');
      return;
    }
    const map = raw as Y.Map<unknown>;
    const type = map.get('type');
    if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) {
      this.deleteNode(id, actor, 'unknown_type');
      return;
    }
    const pageId = map.get('pageId');
    if (typeof pageId !== 'string' || !this.overlay.pageExists(pageId)) {
      this.deleteNode(id, actor, 'missing_page');
      return;
    }

    if (map.get('id') !== id) this.setNode(id, 'id', id, actor, 'id');

    const ranges = { ...COMMON_NUMBERS, ...TYPE_NUMBERS[type] };
    for (const [key, range] of Object.entries(ranges)) {
      const value = map.get(key);
      if (typeof value === 'number') this.setNode(id, key, clampValue(value, range), actor, 'clamp');
    }
    if (type === 'group') {
      this.setNode(id, 'w', 0, actor, 'clamp');
      this.setNode(id, 'h', 0, actor, 'clamp');
    }
    const rotation = map.get('rotation');
    if (typeof rotation === 'number') this.setNode(id, 'rotation', normalizeRotation(rotation), actor, 'rotation');

    if (type === 'rect' || type === 'image') {
      const radius = map.get('cornerRadius');
      const w = this.overlay.get(id, 'w');
      const h = this.overlay.get(id, 'h');
      if (typeof radius === 'number' && typeof w === 'number' && typeof h === 'number') {
        this.setNode(id, 'cornerRadius', clampValue(radius, [0, Math.min(w, h) / 2, 0]), actor, 'clamp');
      }
    }
    if (type === 'line') {
      this.setNode(id, 'points', clampPoints(map.get('points'), DOCUMENT_LIMITS.maxPoints, [-C, C, 0]), actor, 'points');
    }
    if (type === 'polygon' && map.has('vertices')) {
      this.setNode(id, 'vertices', clampPoints(map.get('vertices'), DOCUMENT_LIMITS.maxPolygonVertices, [0, 1, 0]), actor, 'points');
    }
    if (map.has('shadow')) this.setNode(id, 'shadow', clampShadow(map.get('shadow')), actor, 'clamp');
    for (const [key, max] of [
      ['name', DOCUMENT_LIMITS.maxNameLength],
      ['alt', DOCUMENT_LIMITS.maxAltLength],
    ] as const) {
      const value = map.get(key);
      if (typeof value === 'string' && value.length > max) this.setNode(id, key, value.slice(0, max), actor, 'truncate');
    }

    const parentId = map.get('parentId');
    if (parentId !== null && !NodeIdSchema.safeParse(parentId).success) this.setNode(id, 'parentId', null, actor, 'parent');

    if (type === 'connector') {
      for (const end of ['from', 'to'] as const) {
        if (!ConnectorEndSchema.safeParse(map.get(end)).success) {
          this.setNode(id, end, this.freeEnd(id, end), actor, 'connector');
        }
      }
    }

    this.repairCreatedBy(id, map, touch);

    if (!NodeSchema.safeParse(this.overlay.json(id)).success) this.deleteNode(id, actor, 'invalid_node');
  }

  private repairCreatedBy(id: string, map: Y.Map<unknown>, touch: TouchInfo) {
    if (!touch.userId) return;
    const current = map.get('createdBy');
    if (touch.created) {
      if (current !== touch.userId) this.setNode(id, 'createdBy', touch.userId, touch.actor, 'created_by');
      return;
    }
    if (touch.previousCreatedBy !== undefined && current !== touch.previousCreatedBy) {
      const restored = typeof touch.previousCreatedBy === 'string' ? touch.previousCreatedBy : touch.userId;
      this.setNode(id, 'createdBy', restored, touch.actor, 'created_by');
    }
  }

  // El servidor no conoce la caja del nodo borrado: el cliente guarda en x, y, w, h la caja de los dos extremos
  // del conector y en flipX y flipY su sentido (el inicio a la derecha o abajo), así que de ahí sale el último
  // punto calculado del extremo que queda colgando.
  private freeEnd(id: string, end: 'from' | 'to'): { x: number; y: number } {
    const read = (key: string) => {
      const value = this.overlay.get(id, key);
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    const x = read('x');
    const y = read('y');
    const right = clampValue(x + read('w'), [-C, C, 0]);
    const bottom = clampValue(y + read('h'), [-C, C, 0]);
    const flipX = this.overlay.get(id, 'flipX') === true;
    const flipY = this.overlay.get(id, 'flipY') === true;
    const atRight = end === 'from' ? flipX : !flipX;
    const atBottom = end === 'from' ? flipY : !flipY;
    return { x: atRight ? right : x, y: atBottom ? bottom : y };
  }

  private livePageOf(id: string): string | null {
    const pageId = this.overlay.get(id, 'pageId');
    return typeof pageId === 'string' ? pageId : null;
  }

  private enforceNodeLimits() {
    const created = [...this.touches.nodes.entries()]
      .filter(([id, info]) => info.created && this.overlay.nodeMap(id))
      .map(([id]) => id)
      .sort()
      .reverse();
    if (created.length === 0) return;

    const perPage = new Map<string, number>();
    let total = 0;
    this.overlay.nodes.forEach((_value, id) => {
      if (!this.overlay.nodeMap(id)) return;
      total++;
      const pageId = this.livePageOf(id);
      if (pageId) perPage.set(pageId, (perPage.get(pageId) ?? 0) + 1);
    });

    for (const id of created) {
      const pageId = this.livePageOf(id);
      const pageCount = pageId ? (perPage.get(pageId) ?? 0) : 0;
      if (total <= this.limitsConfig.maxNodes && pageCount <= this.limitsConfig.maxNodesPerPage) continue;
      const actor = this.touches.nodes.get(id)!.actor;
      this.deleteNode(id, actor, 'node_limit');
      this.limits.push({ what: 'nodes', actor });
      total--;
      if (pageId) perPage.set(pageId, pageCount - 1);
    }
  }

  // Padres y conectores. Si hubo borrados o se tocó un contenedor, se revisa todo el documento.
  private repairRelations() {
    const touchedIds = [...this.touches.nodes.keys()].filter((id) => this.overlay.nodeMap(id));
    const wide =
      this.touches.deletedNodes.size > 0 ||
      this.touches.deletedPages.size > 0 ||
      this.overlay.deletedNodes.size > 0 ||
      this.overlay.deletedPages.size > 0 ||
      touchedIds.some((id) => CONTAINERS.has(this.overlay.get(id, 'type') as string));
    const candidates = wide ? [...this.overlay.nodes.keys()].sort() : touchedIds.sort();

    for (const id of candidates) {
      if (!this.overlay.nodeMap(id)) continue;
      const actor = this.touches.nodes.get(id)?.actor ?? null;
      const pageId = this.livePageOf(id);
      if (!pageId || !this.overlay.pageExists(pageId)) {
        this.deleteNode(id, actor, 'missing_page');
        continue;
      }
      const parentId = this.overlay.get(id, 'parentId');
      if (typeof parentId === 'string' && !this.validParent(id, parentId, pageId)) {
        this.setNode(id, 'parentId', null, actor, 'parent');
      }
      if (this.overlay.get(id, 'type') === 'connector') {
        for (const end of ['from', 'to'] as const) {
          const value = this.overlay.get(id, end);
          if (!isRecord(value) || typeof value.nodeId !== 'string') continue;
          const target = value.nodeId;
          if (target === id || !this.overlay.nodeMap(target) || this.livePageOf(target) !== pageId) {
            this.setNode(id, end, this.freeEnd(id, end), actor, 'connector');
          }
        }
      }
    }
  }

  private validParent(id: string, parentId: string, pageId: string): boolean {
    if (parentId === id || !this.overlay.nodeMap(parentId)) return false;
    if (!CONTAINERS.has(this.overlay.get(parentId, 'type') as string)) return false;
    if (this.livePageOf(parentId) !== pageId) return false;
    const seen = new Set<string>([id]);
    let current: unknown = parentId;
    while (typeof current === 'string') {
      // Un ciclo que no pasa por este nodo se corrige al revisar sus miembros.
      if (seen.has(current)) return current !== id;
      seen.add(current);
      if (!this.overlay.nodeMap(current)) return true;
      current = this.overlay.get(current, 'parentId');
    }
    return true;
  }

  private repairTexts() {
    const ids = new Set<string>([...this.touches.texts.keys(), ...this.overlay.deletedNodes, ...this.touches.deletedNodes]);
    for (const id of [...ids].sort()) {
      const value = this.texts.get(id);
      if (value === undefined) continue;
      const touch = this.touches.texts.get(id);
      const actor = touch?.actor ?? null;
      if (!(value instanceof Y.Text)) {
        this.corrections.push({ op: 'delete', target: 'text', id, actor, reason: 'invalid_text' });
        continue;
      }
      if (!this.overlay.nodeMap(id)) {
        // Escribir en el texto de un nodo que otra persona acaba de borrar no es un error del cliente.
        this.corrections.push({ op: 'delete', target: 'text', id, actor: touch?.created ? actor : null, reason: 'orphan_text' });
        continue;
      }
      if (value.length > this.limitsConfig.maxTextLength) {
        this.corrections.push({ op: 'truncate', target: 'text', id, length: this.limitsConfig.maxTextLength, actor, reason: 'text_length' });
      }
    }
  }

  private repairAnimations() {
    const ids = new Set<string>([
      ...this.touches.animations.keys(),
      ...this.overlay.deletedNodes,
      ...this.touches.deletedNodes,
    ]);
    const removed = new Set<string>();
    for (const id of [...ids].sort()) {
      const value = this.animations.get(id);
      if (value === undefined) continue;
      const touch = this.touches.animations.get(id);
      const actor = touch?.actor ?? null;
      if (!this.overlay.nodeMap(id)) {
        this.corrections.push({ op: 'delete', target: 'animation', id, actor: touch?.created ? actor : null, reason: 'orphan_animation' });
        removed.add(id);
        continue;
      }
      const json = value instanceof Y.Map ? value.toJSON() : value;
      if (!AnimationSchema.safeParse(json).success) {
        this.corrections.push({ op: 'delete', target: 'animation', id, actor, reason: 'invalid_animation' });
        removed.add(id);
      }
    }

    let excess = this.animations.size - removed.size - this.limitsConfig.maxAnimatedNodes;
    if (excess <= 0) return;
    const created = [...this.touches.animations.entries()]
      .filter(([id, info]) => info.created && !removed.has(id) && this.animations.has(id))
      .map(([id]) => id)
      .sort()
      .reverse();
    for (const id of created) {
      if (excess <= 0) break;
      const actor = this.touches.animations.get(id)!.actor;
      this.corrections.push({ op: 'delete', target: 'animation', id, actor, reason: 'animation_limit' });
      this.limits.push({ what: 'animations', actor });
      excess--;
    }
  }
}

// Calcula las correcciones de lo tocado en un lote sin modificar el documento.
export function planNormalization(doc: Y.Doc, touches: Touches, options: NormalizeOptions = {}): NormalizeResult {
  return new Planner(doc, touches, options).run();
}

export function applyCorrections(doc: Y.Doc, corrections: readonly Correction[], origin: unknown): void {
  if (corrections.length === 0) return;
  const roots = {
    node: doc.getMap(ROOT_KEYS.nodes),
    page: doc.getMap(ROOT_KEYS.pages),
    text: doc.getMap(ROOT_KEYS.texts),
    animation: doc.getMap(ROOT_KEYS.animations),
  };
  doc.transact(() => {
    for (const correction of corrections) {
      const root = roots[correction.target];
      switch (correction.op) {
        case 'set':
        case 'unset': {
          const entry = root.get(correction.id);
          if (!(entry instanceof Y.Map)) break;
          if (correction.op === 'set') entry.set(correction.key, correction.value);
          else entry.delete(correction.key);
          break;
        }
        case 'delete':
          root.delete(correction.id);
          break;
        case 'truncate': {
          const text = root.get(correction.id);
          if (text instanceof Y.Text && text.length > correction.length) {
            text.delete(correction.length, text.length - correction.length);
          }
          break;
        }
      }
    }
  }, origin);
}

export function normalizeDocument(
  doc: Y.Doc,
  touches: Touches,
  origin: unknown,
  options: NormalizeOptions = {},
): NormalizeResult {
  const result = planNormalization(doc, touches, options);
  applyCorrections(doc, result.corrections, origin);
  return result;
}
