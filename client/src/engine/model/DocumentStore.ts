import { ANIMATION_LIMITS } from '../../shared/document/limits.js';
import type { Animation, Meta } from '../../shared/document/schema.js';
import { FAST_BIT, unpackFast, FAST_KEYS, type DocBatch, type MirrorOp, type PageRecord } from '../doc/protocol.ts';
import { compareOrder } from './order.ts';
import type { NodeRecord } from '../types.ts';

export type { PageRecord } from '../doc/protocol.ts';

// fast: solo cambiaron claves de FAST_KEYS (posición, giro, opacidad, visibilidad o bloqueo) o solo el contenido
// de su texto. Esas claves se parchean en el mismo objeto: en un cambio rápido, prev y next son el mismo registro.
// layer: puede cambiar lo que muestra el panel de capas (alta, baja, nombre, tipo, visibilidad o bloqueo).
export type NodeChange = { id: string; prev: NodeRecord | undefined; next: NodeRecord | undefined; fast: boolean; layer: boolean };

export type FlushResult = {
  changes: NodeChange[];
  // Altas, bajas o cambios de padre, índice, página o tipo: obligan a recalcular el árbol.
  structural: boolean;
  pagesChanged: boolean;
  metaChanged: boolean;
  animationsChanged: boolean;
};

const isStructuralChange = (prev: NodeRecord, next: NodeRecord) =>
  prev.parentId !== next.parentId || prev.index !== next.index || prev.pageId !== next.pageId || prev.type !== next.type;

const LAYER_BITS = FAST_BIT.visible! | FAST_BIT.locked!;
const layerChange = (prev: NodeRecord | undefined, next: NodeRecord | undefined) =>
  !prev || !next || prev.name !== next.name || prev.visible !== next.visible || prev.locked !== next.locked || prev.type !== next.type;
const WHOLE = 0;
// Solo cambió el contenido de su texto: el registro sigue igual.
const CONTENT_ONLY = -1;

const PAGES_KEY = 'p';
const nodeKey = (id: string) => `n:${id}`;
const textKey = (id: string) => `t:${id}`;
const animationKey = (id: string) => `a:${id}`;

const sameValue = (a: unknown, b: unknown) =>
  a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b));

function sameRecord(a: NodeRecord | null | undefined, b: NodeRecord | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) if (!sameValue(left[key], right[key])) return false;
  return true;
}

const samePages = (a: readonly PageRecord[], b: readonly PageRecord[]) =>
  a.length === b.length && a.every((page, i) => sameValue(page, b[i]));

function keysOf(op: MirrorOp): string | null {
  switch (op.k) {
    case 'node.set':
      return nodeKey(op.record.id);
    case 'node.patch':
    case 'node.delete':
      return nodeKey(op.id);
    case 'text.set':
    case 'text.delete':
    case 'text.local':
      return textKey(op.id);
    case 'page.set':
    case 'page.patch':
    case 'page.delete':
      return PAGES_KEY;
    case 'animation.ensure':
    case 'animation.patch':
    case 'animation.delete':
    case 'keyframe.set':
    case 'keyframe.delete':
      return animationKey(op.id);
    default:
      return null;
  }
}

function applyNodeOp(record: NodeRecord | undefined, op: MirrorOp): NodeRecord | undefined {
  switch (op.k) {
    case 'node.set':
      return op.record;
    case 'node.delete':
      return undefined;
    case 'node.patch': {
      if (!record) return undefined;
      const next = { ...record } as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.set)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      for (const key of op.unset ?? []) delete next[key];
      return next as NodeRecord;
    }
    default:
      return record;
  }
}

const X = FAST_KEYS.indexOf('x');
const Y = FAST_KEYS.indexOf('y');
const ROTATION = FAST_KEYS.indexOf('rotation');
const OPACITY = FAST_KEYS.indexOf('opacity');
const VISIBLE = FAST_KEYS.indexOf('visible');
const LOCKED = FAST_KEYS.indexOf('locked');

// Con el nombre de cada clave escrito, V8 no pasa por la búsqueda genérica de una clave calculada en cada nodo.
function patchFast(target: Record<string, unknown>, mask: number, values: readonly unknown[]): void {
  if (mask & (1 << X)) target.x = values[X];
  if (mask & (1 << Y)) target.y = values[Y];
  if (mask & (1 << ROTATION)) target.rotation = values[ROTATION];
  if (mask & (1 << OPACITY)) target.opacity = values[OPACITY];
  if (mask & (1 << VISIBLE)) target.visible = values[VISIBLE];
  if (mask & (1 << LOCKED)) target.locked = values[LOCKED];
}

function applyTextOp(content: string | null, op: MirrorOp): string | null {
  switch (op.k) {
    case 'text.set':
    case 'text.local':
      return op.content;
    case 'text.delete':
      return null;
    default:
      return content;
  }
}

function applyPageOp(pages: readonly PageRecord[], op: MirrorOp): PageRecord[] {
  switch (op.k) {
    case 'page.set':
      return [...pages.filter((page) => page.id !== op.id), Object.freeze({ id: op.id, ...op.page })].sort(compareOrder);
    case 'page.patch':
      return pages.map((page) => (page.id === op.id ? Object.freeze({ ...page, ...op.set }) : page)).sort(compareOrder);
    case 'page.delete':
      return pages.filter((page) => page.id !== op.id);
    default:
      return [...pages];
  }
}

// Mismas reglas que el host: la pista llena no admite claves nuevas y todo es de solo lectura.
function applyAnimationOp(animation: Animation | undefined, op: MirrorOp): Animation | undefined {
  switch (op.k) {
    case 'animation.ensure':
      return animation ?? { ...op.settings, tracks: {} };
    case 'animation.patch':
      return animation && { ...animation, ...op.set };
    case 'animation.delete':
      return undefined;
    case 'keyframe.set': {
      if (!animation) return undefined;
      const track = animation.tracks[op.prop] ?? {};
      if (!(op.key in track) && Object.keys(track).length >= ANIMATION_LIMITS.maxKeyframesPerTrack) return animation;
      return { ...animation, tracks: { ...animation.tracks, [op.prop]: { ...track, [op.key]: { t: op.keyframe.t, v: op.keyframe.v, e: op.keyframe.e } } } };
    }
    case 'keyframe.delete': {
      const track = animation?.tracks[op.prop];
      if (!animation || !track || !(op.key in track)) return animation;
      const rest = { ...track };
      delete rest[op.key];
      return { ...animation, tracks: { ...animation.tracks, [op.prop]: rest } };
    }
    default:
      return animation;
  }
}

type Pending = { seq: number; at: number; ops: MirrorOp[]; keys: string[] };

// Espejo plano del documento en el hilo principal: lo visible es lo confirmado por el host más las ops locales
// pendientes, en orden. Las ops locales se ven en el acto; los lotes del host se aplican a lo confirmado (la sombra)
// de lo que tiene pendientes, y a lo visible de lo demás. Al acusarse una op, sus claves vuelven a lo confirmado.
// Los registros son de solo lectura para quien los usa: el store los sustituye al cambiar una clave cualquiera y
// los parchea en sitio cuando solo cambian claves rápidas.
export class DocumentStore {
  private readonly records = new Map<string, NodeRecord>();
  private readonly contents = new Map<string, string>();
  private pageList: readonly PageRecord[] = [];
  private metaValue: Meta | null = null;
  private readonly anims = new Map<string, Animation>();
  // Lo confirmado por el host de cada clave con ops pendientes (null: no existe).
  private readonly confirmedNodes = new Map<string, NodeRecord | null>();
  private readonly confirmedTexts = new Map<string, string | null>();
  private confirmedPages: readonly PageRecord[] | undefined;
  private readonly confirmedAnimations = new Map<string, Animation | null>();
  private pending: Pending[] = [];
  private readonly pendingCount = new Map<string, number>();
  // Claves rápidas cambiadas por nodo desde el último flush (bits de FAST_BIT); WHOLE si se sustituyó el registro;
  // CONTENT_ONLY si solo cambió su texto.
  private readonly dirty = new Map<string, number>();
  // El registro que vio el árbol en el último flush, para los ids cuyo objeto se sustituyó desde entonces.
  private readonly flushedPrev = new Map<string, NodeRecord | undefined>();
  private pagesDirty = false;
  private metaDirty = false;
  private animationsDirty = false;
  invalidCount = 0;

  constructor(
    private readonly onDirty: () => void = () => {},
    private readonly now: () => number = () => performance.now(),
  ) {}

  get hasPending(): boolean {
    return this.dirty.size > 0 || this.pagesDirty || this.metaDirty || this.animationsDirty;
  }

  get size(): number {
    return this.records.size;
  }

  get(id: string): NodeRecord | undefined {
    return this.records.get(id);
  }

  all(): IterableIterator<NodeRecord> {
    return this.records.values();
  }

  entries(): IterableIterator<[string, NodeRecord]> {
    return this.records.entries();
  }

  pages(): readonly PageRecord[] {
    return this.pageList;
  }

  meta(): Meta | null {
    return this.metaValue;
  }

  // Contenido de `texts[id]` ('' si no hay).
  text(id: string): string {
    return this.contents.get(id) ?? '';
  }

  hasText(id: string): boolean {
    return this.contents.has(id);
  }

  animation(id: string): Animation | undefined {
    return this.anims.get(id);
  }

  animations(): IterableIterator<[string, Animation]> {
    return this.anims.entries();
  }

  get animationCount(): number {
    return this.anims.size;
  }

  // Momento de la op local más antigua sin acusar, o null.
  pendingSince(): number | null {
    return this.pending[0]?.at ?? null;
  }

  private replace(id: string, next: NodeRecord | undefined): void {
    if (!this.flushedPrev.has(id)) this.flushedPrev.set(id, this.records.get(id));
    if (next) this.records.set(id, next);
    else this.records.delete(id);
    this.dirty.set(id, WHOLE);
  }

  private setContent(id: string, content: string | null): void {
    if (content === null) this.contents.delete(id);
    else this.contents.set(id, content);
    if (!this.dirty.has(id)) this.dirty.set(id, CONTENT_ONLY);
  }

  private setAnimation(id: string, animation: Animation | null | undefined): void {
    if (animation) this.anims.set(id, animation);
    else if (!this.anims.delete(id)) return;
    this.animationsDirty = true;
  }

  private setPages(pages: readonly PageRecord[]): void {
    this.pageList = pages;
    this.pagesDirty = true;
  }

  // Cambios propios: se ven en el acto y quedan pendientes hasta que el host acuse `seq`.
  applyLocal(seq: number, ops: readonly MirrorOp[]): void {
    const keys: string[] = [];
    for (const op of ops) {
      const key = keysOf(op);
      if (!key || keys.includes(key)) continue;
      keys.push(key);
      this.shadow(key);
      this.pendingCount.set(key, (this.pendingCount.get(key) ?? 0) + 1);
    }
    for (const op of ops) this.applyVisible(op);
    this.pending.push({ seq, at: this.now(), ops: [...ops], keys });
    this.onDirty();
  }

  // Sin pendientes, lo visible es lo confirmado: se guarda una copia antes de que la op lo cambie.
  private shadow(key: string): void {
    if ((this.pendingCount.get(key) ?? 0) > 0) return;
    if (key === PAGES_KEY) {
      this.confirmedPages = this.pageList;
      return;
    }
    const id = key.slice(2);
    if (key.startsWith('n:')) {
      const record = this.records.get(id);
      this.confirmedNodes.set(id, record ? { ...record } : null);
    } else if (key.startsWith('a:')) {
      this.confirmedAnimations.set(id, this.anims.get(id) ?? null);
    } else {
      this.confirmedTexts.set(id, this.contents.get(id) ?? null);
    }
  }

  private applyVisible(op: MirrorOp): void {
    switch (op.k) {
      case 'node.set':
      case 'node.patch':
      case 'node.delete': {
        const id = op.k === 'node.set' ? op.record.id : op.id;
        const current = this.records.get(id);
        if (!current && op.k !== 'node.set') return;
        this.replace(id, applyNodeOp(current, op));
        return;
      }
      case 'text.set':
      case 'text.local':
      case 'text.delete':
        this.setContent(op.id, applyTextOp(this.contents.get(op.id) ?? null, op));
        return;
      case 'page.set':
      case 'page.patch':
      case 'page.delete':
        this.setPages(applyPageOp(this.pageList, op));
        return;
      case 'animation.ensure':
      case 'animation.patch':
      case 'animation.delete':
      case 'keyframe.set':
      case 'keyframe.delete':
        this.setAnimation(op.id, applyAnimationOp(this.anims.get(op.id), op));
        return;
    }
  }

  private shadowed(key: string): boolean {
    return (this.pendingCount.get(key) ?? 0) > 0;
  }

  // Un lote del host: ya validado y con todo lo procesado hasta `applied`.
  applyBatch(batch: DocBatch): void {
    this.invalidCount = batch.invalid;
    if (batch.full) {
      this.applyFull(batch);
      return;
    }
    const touched = new Set<string>();
    if (batch.fast) {
      // Sin ops pendientes no hay sombras: se evita formar la clave de cada nodo.
      const anyPending = this.pendingCount.size > 0;
      unpackFast(batch.fast, (id, mask, values) => {
        const shadowed = anyPending && this.shadowed(nodeKey(id));
        const target = (shadowed ? this.confirmedNodes.get(id) : this.records.get(id)) as Record<string, unknown> | null | undefined;
        if (!target) return;
        patchFast(target, mask, values);
        if (shadowed) {
          touched.add(nodeKey(id));
          return;
        }
        const current = this.dirty.get(id);
        if (current === WHOLE) return;
        this.dirty.set(id, current === undefined || current === CONTENT_ONLY ? mask : current | mask);
      });
    }
    for (const { id, set, unset } of batch.keys ?? []) {
      const key = nodeKey(id);
      if (this.shadowed(key)) {
        const target = this.confirmedNodes.get(id) as Record<string, unknown> | null | undefined;
        if (!target) continue;
        Object.assign(target, set);
        for (const name of unset) delete target[name];
        touched.add(key);
        continue;
      }
      const current = this.records.get(id);
      if (current) this.replace(id, applyNodeOp(current, { k: 'node.patch', id, set, unset }));
    }
    for (const record of batch.set ?? []) {
      const key = nodeKey(record.id);
      if (this.shadowed(key)) {
        this.confirmedNodes.set(record.id, record);
        touched.add(key);
      } else {
        this.replace(record.id, record);
      }
    }
    for (const id of batch.del ?? []) {
      const key = nodeKey(id);
      if (this.shadowed(key)) {
        this.confirmedNodes.set(id, null);
        touched.add(key);
      } else if (this.records.has(id)) {
        this.replace(id, undefined);
      }
    }
    for (const [id, content] of batch.texts ?? []) {
      const key = textKey(id);
      if (this.shadowed(key)) {
        this.confirmedTexts.set(id, content);
        touched.add(key);
      } else {
        this.setContent(id, content);
      }
    }
    if (batch.pages) {
      if (this.shadowed(PAGES_KEY)) {
        this.confirmedPages = batch.pages.map((page) => Object.freeze({ ...page }));
        touched.add(PAGES_KEY);
      } else {
        this.setPages(batch.pages.map((page) => Object.freeze({ ...page })));
      }
    }
    if (batch.meta !== undefined) {
      this.metaValue = batch.meta;
      this.metaDirty = true;
    }
    for (const [id, animation] of batch.animations ?? []) {
      const key = animationKey(id);
      if (this.shadowed(key)) {
        this.confirmedAnimations.set(id, animation);
        touched.add(key);
      } else {
        this.setAnimation(id, animation);
      }
    }

    const resolved = this.acknowledge(batch.applied);
    for (const key of resolved) this.adopt(key);
    for (const key of touched) if (!resolved.has(key) && this.shadowed(key)) this.recompute(key);
  }

  private applyFull(batch: DocBatch): void {
    const next = new Map((batch.set ?? []).map((record) => [record.id, record]));
    for (const id of [...this.records.keys()]) if (!next.has(id)) this.replace(id, undefined);
    for (const [id, record] of next) this.replace(id, record);
    const texts = new Map(batch.texts ?? []);
    for (const id of [...this.contents.keys()]) if (!texts.has(id)) this.setContent(id, null);
    for (const [id, content] of texts) this.setContent(id, content);
    this.setPages((batch.pages ?? []).map((page) => Object.freeze({ ...page })));
    this.metaValue = batch.meta ?? null;
    this.metaDirty = true;
    this.anims.clear();
    for (const [id, animation] of batch.animations ?? []) if (animation) this.anims.set(id, animation);
    this.animationsDirty = true;
    this.confirmedAnimations.clear();
    this.confirmedNodes.clear();
    this.confirmedTexts.clear();
    this.confirmedPages = undefined;
    this.pending = [];
    this.pendingCount.clear();
  }

  // Descarta los pendientes con seq ≤ applied; devuelve las claves que se quedan sin pendientes.
  private acknowledge(applied: number): Set<string> {
    const resolved = new Set<string>();
    let done = 0;
    while (done < this.pending.length && this.pending[done]!.seq <= applied) {
      for (const key of this.pending[done]!.keys) {
        const left = (this.pendingCount.get(key) ?? 1) - 1;
        if (left > 0) this.pendingCount.set(key, left);
        else {
          this.pendingCount.delete(key);
          resolved.add(key);
        }
      }
      done++;
    }
    if (done) this.pending = this.pending.slice(done);
    return resolved;
  }

  // La clave pasa a lo confirmado y pierde la sombra. Si coincide con lo visible, no se toca.
  private adopt(key: string): void {
    if (key === PAGES_KEY) {
      const confirmed = this.confirmedPages ?? this.pageList;
      this.confirmedPages = undefined;
      if (!samePages(confirmed, this.pageList)) this.setPages(confirmed);
      return;
    }
    const id = key.slice(2);
    if (key.startsWith('n:')) {
      const confirmed = this.confirmedNodes.get(id) ?? null;
      this.confirmedNodes.delete(id);
      if (!sameRecord(confirmed, this.records.get(id))) this.replace(id, confirmed ?? undefined);
      return;
    }
    if (key.startsWith('a:')) {
      const confirmed = this.confirmedAnimations.get(id) ?? null;
      this.confirmedAnimations.delete(id);
      if (!sameValue(confirmed, this.anims.get(id) ?? null)) this.setAnimation(id, confirmed);
      return;
    }
    const confirmed = this.confirmedTexts.get(id) ?? null;
    this.confirmedTexts.delete(id);
    if (confirmed !== (this.contents.get(id) ?? null)) this.setContent(id, confirmed);
  }

  // Lo confirmado cambió bajo ops pendientes: lo visible vuelve a ser lo confirmado más esas ops, en orden.
  private recompute(key: string): void {
    const ops = this.pending.flatMap((entry) => (entry.keys.includes(key) ? entry.ops.filter((op) => keysOf(op) === key) : []));
    if (key === PAGES_KEY) {
      let pages: readonly PageRecord[] = this.confirmedPages ?? [];
      for (const op of ops) pages = applyPageOp(pages, op);
      if (!samePages(pages, this.pageList)) this.setPages(pages);
      return;
    }
    const id = key.slice(2);
    if (key.startsWith('n:')) {
      const confirmed = this.confirmedNodes.get(id);
      let record: NodeRecord | undefined = confirmed ? { ...confirmed } : undefined;
      for (const op of ops) record = applyNodeOp(record, op);
      this.replace(id, record);
      return;
    }
    if (key.startsWith('a:')) {
      let animation = this.confirmedAnimations.get(id) ?? undefined;
      for (const op of ops) animation = applyAnimationOp(animation, op);
      if (!sameValue(animation ?? null, this.anims.get(id) ?? null)) this.setAnimation(id, animation ?? null);
      return;
    }
    let content = this.confirmedTexts.get(id) ?? null;
    for (const op of ops) content = applyTextOp(content, op);
    if (content !== (this.contents.get(id) ?? null)) this.setContent(id, content);
  }

  // Lleva lo cambiado al árbol: una vez por id, aunque hayan llegado varios lotes u ops en el mismo frame.
  flush(): FlushResult {
    const changes: NodeChange[] = [];
    let structural = false;
    for (const [id, mask] of this.dirty) {
      const next = this.records.get(id);
      if (mask !== WHOLE) {
        if (next) changes.push({ id, prev: next, next, fast: true, layer: mask !== CONTENT_ONLY && (mask & LAYER_BITS) !== 0 });
        continue;
      }
      const prev = this.flushedPrev.has(id) ? this.flushedPrev.get(id) : next;
      if (!prev && !next) continue;
      changes.push({ id, prev, next, fast: false, layer: layerChange(prev, next) });
      if (!prev || !next || isStructuralChange(prev, next)) structural = true;
    }
    this.dirty.clear();
    this.flushedPrev.clear();
    const pagesChanged = this.pagesDirty;
    const metaChanged = this.metaDirty;
    const animationsChanged = this.animationsDirty;
    this.pagesDirty = false;
    this.metaDirty = false;
    this.animationsDirty = false;
    return { changes, structural, pagesChanged, metaChanged, animationsChanged };
  }
}
