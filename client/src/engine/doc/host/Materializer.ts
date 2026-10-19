import * as Y from 'yjs';
import { ROOT_KEYS } from '../../../shared/document/keys.js';
import { DOCUMENT_LIMITS } from '../../../shared/document/limits.js';
import { AnimationSchema, MetaSchema, NodeSchema, PageSchema, type Animation, type Meta } from '../../../shared/document/schema.js';
import { compareOrder } from '../../model/order.ts';
import type { NodeRecord } from '../../types.ts';
import { FAST_BIT, FAST_KEYS, packFast, type DocBatch, type FastEntry, type PageRecord } from '../protocol.ts';

type Logger = Pick<Console, 'warn'>;

const finiteIn = (min: number, max: number) => (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isBoolean = (value: unknown) => typeof value === 'boolean';

// Mismas restricciones que baseFields en shared/document/schema.ts para estas claves.
const FAST_CHECKS: ReadonlyArray<(value: unknown) => boolean> = FAST_KEYS.map((key) => {
  switch (key) {
    case 'x':
    case 'y':
      return finiteIn(-DOCUMENT_LIMITS.maxCoordinate, DOCUMENT_LIMITS.maxCoordinate);
    case 'rotation':
      return finiteIn(-Math.PI, Math.PI);
    case 'opacity':
      return finiteIn(0, 1);
    default:
      return isBoolean;
  }
});
// Además de los bits rápidos: cambió alguna otra clave directa del Y.Map del nodo.
const KEYS_BIT = 1 << FAST_KEYS.length;
const FAST_MASK = KEYS_BIT - 1;

export type MaterializedChanges = Pick<DocBatch, 'fast' | 'keys' | 'set' | 'del' | 'texts' | 'pages' | 'meta' | 'animations'>;

// Lee el Y.Doc y produce los parches validados que necesita el espejo del hilo principal. Guarda una copia de lo
// último que mandó de cada nodo (lo que tiene el espejo confirmado) para decidir entre parche rápido, claves y
// registro completo. Los observadores solo marcan ids; el trabajo se hace en take().
export class Materializer {
  private readonly nodesMap: Y.Map<unknown>;
  private readonly pagesMap: Y.Map<unknown>;
  private readonly metaMap: Y.Map<unknown>;
  private readonly textsMap: Y.Map<unknown>;
  private readonly animationsMap: Y.Map<unknown>;
  private readonly known = new Map<string, NodeRecord>();
  private readonly dirty = new Map<string, number>();
  private readonly whole = new Set<string>();
  private readonly changedKeys = new Map<string, Set<string>>();
  private readonly dirtyTexts = new Set<string>();
  private readonly dirtyAnimations = new Set<string>();
  private readonly warned = new Set<string>();
  private pagesDirty = false;
  private metaDirty = false;
  private fullPending = true;
  invalidCount = 0;

  constructor(
    doc: Y.Doc,
    private readonly onDirty: () => void,
    private readonly logger: Logger = console,
  ) {
    this.nodesMap = doc.getMap(ROOT_KEYS.nodes);
    this.pagesMap = doc.getMap(ROOT_KEYS.pages);
    this.metaMap = doc.getMap(ROOT_KEYS.meta);
    this.textsMap = doc.getMap(ROOT_KEYS.texts);
    this.animationsMap = doc.getMap(ROOT_KEYS.animations);
    this.nodesMap.observeDeep(this.handleNodes);
    this.pagesMap.observeDeep(this.handlePages);
    this.metaMap.observe(this.handleMeta);
    this.textsMap.observeDeep(this.handleTexts);
    this.animationsMap.observeDeep(this.handleAnimations);
  }

  get hasPending(): boolean {
    return this.fullPending || this.dirty.size > 0 || this.dirtyTexts.size > 0 || this.dirtyAnimations.size > 0 || this.pagesDirty || this.metaDirty;
  }

  // El próximo take() devuelve el documento entero (primer lote de una generación).
  get isFullPending(): boolean {
    return this.fullPending;
  }

  hasText(id: string): boolean {
    return this.textsMap.get(id) instanceof Y.Text;
  }

  private markWhole(id: string): void {
    this.whole.add(id);
    if (!this.dirty.has(id)) this.dirty.set(id, 0);
  }

  private readonly handleNodes = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    // keysChanged evita calcular event.changes, que recorre el delete set por cada clave.
    for (const event of events) {
      const target = event.target;
      if (target === this.nodesMap) {
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) if (typeof key === 'string') this.markWhole(key);
        continue;
      }
      const item = target._item;
      if (target instanceof Y.Map && item?.parent === this.nodesMap && typeof item.parentSub === 'string') {
        const id = item.parentSub;
        if (this.whole.has(id)) continue;
        let mask = this.dirty.get(id) ?? 0;
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) {
          if (typeof key !== 'string') continue;
          const bit = FAST_BIT[key];
          if (bit !== undefined) {
            mask |= bit;
            continue;
          }
          mask |= KEYS_BIT;
          let keys = this.changedKeys.get(id);
          if (!keys) this.changedKeys.set(id, (keys = new Set()));
          keys.add(key);
        }
        this.dirty.set(id, mask);
        continue;
      }
      // Un tipo anidado del nodo: se manda el registro entero.
      const id = event.path[0];
      if (typeof id === 'string') this.markWhole(id);
    }
    this.onDirty();
  };

  private readonly handleTexts = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    for (const event of events) {
      const target = event.target;
      if (target === this.textsMap) {
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) if (typeof key === 'string') this.dirtyTexts.add(key);
        continue;
      }
      const item = target._item;
      const id = item?.parent === this.textsMap && typeof item.parentSub === 'string' ? item.parentSub : event.path[0];
      if (typeof id === 'string') this.dirtyTexts.add(id);
    }
    this.onDirty();
  };

  private readonly handleAnimations = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    for (const event of events) {
      if (event.target === this.animationsMap) {
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) if (typeof key === 'string') this.dirtyAnimations.add(key);
        continue;
      }
      const id = event.path[0];
      if (typeof id === 'string') this.dirtyAnimations.add(id);
    }
    this.onDirty();
  };

  private readonly handlePages = () => {
    this.pagesDirty = true;
    this.onDirty();
  };

  private readonly handleMeta = () => {
    this.metaDirty = true;
    this.onDirty();
  };

  // Lo cambiado desde la última llamada, ya validado. Con full, el documento entero.
  take(): MaterializedChanges & { full?: true } {
    if (this.fullPending) return this.takeFull();
    const out: MaterializedChanges = {};
    const fast: FastEntry[] = [];
    const keys: NonNullable<DocBatch['keys']> = [];
    const set: NodeRecord[] = [];
    const del: string[] = [];
    for (const [id, mask] of this.dirty) {
      const known = this.known.get(id);
      if (!this.whole.has(id) && known) {
        if ((mask & KEYS_BIT) === 0) {
          const values = this.readFast(id, mask);
          if (values) {
            const target = known as Record<string, unknown>;
            for (let i = 0; i < FAST_KEYS.length; i++) if (mask & (1 << i)) target[FAST_KEYS[i]!] = values[i];
            fast.push({ id, mask, values });
            continue;
          }
        } else {
          const next = this.read(id);
          if (next) {
            const patch: Record<string, unknown> = {};
            const unset: string[] = [];
            const changed = this.changedKeys.get(id);
            const all = changed ? [...changed] : [];
            for (let i = 0; i < FAST_KEYS.length; i++) if (mask & FAST_MASK & (1 << i)) all.push(FAST_KEYS[i]!);
            const source = next as Record<string, unknown>;
            for (const key of all) {
              if (key in source && source[key] !== undefined) patch[key] = source[key];
              else unset.push(key);
            }
            this.known.set(id, next);
            keys.push({ id, set: patch, unset });
            continue;
          }
          this.known.delete(id);
          del.push(id);
          continue;
        }
      }
      const next = this.read(id);
      if (next) {
        this.known.set(id, next);
        set.push({ ...next });
      } else if (known) {
        this.known.delete(id);
        del.push(id);
      }
    }
    this.dirty.clear();
    this.whole.clear();
    this.changedKeys.clear();
    if (fast.length) out.fast = packFast(fast);
    if (keys.length) out.keys = keys;
    if (set.length) out.set = set;
    if (del.length) out.del = del;
    if (this.dirtyTexts.size) {
      out.texts = [...this.dirtyTexts].map((id) => [id, this.readText(id)]);
      this.dirtyTexts.clear();
    }
    if (this.dirtyAnimations.size) {
      out.animations = [...this.dirtyAnimations].map((id) => [id, this.readAnimation(id)]);
      this.dirtyAnimations.clear();
    }
    if (this.pagesDirty) {
      out.pages = this.readPages();
      this.pagesDirty = false;
    }
    if (this.metaDirty) {
      out.meta = this.readMeta();
      this.metaDirty = false;
    }
    return out;
  }

  private takeFull(): MaterializedChanges & { full: true } {
    this.fullPending = false;
    this.dirty.clear();
    this.whole.clear();
    this.changedKeys.clear();
    this.dirtyTexts.clear();
    this.dirtyAnimations.clear();
    this.pagesDirty = false;
    this.metaDirty = false;
    this.known.clear();
    const set: NodeRecord[] = [];
    for (const id of this.nodesMap.keys()) {
      const record = this.read(id);
      if (!record) continue;
      this.known.set(id, record);
      set.push({ ...record });
    }
    const texts: Array<[string, string | null]> = [];
    for (const id of this.textsMap.keys()) {
      const content = this.readText(id);
      if (content !== null) texts.push([id, content]);
    }
    const animations: Array<[string, Animation]> = [];
    for (const id of this.animationsMap.keys()) {
      const animation = this.readAnimation(id);
      if (animation) animations.push([id, animation]);
    }
    return { full: true, set, texts, pages: this.readPages(), meta: this.readMeta(), animations };
  }

  private readFast(id: string, mask: number): unknown[] | null {
    const map = this.nodesMap.get(id);
    if (!(map instanceof Y.Map)) return null;
    const values: unknown[] = new Array(FAST_KEYS.length);
    for (let i = 0; i < FAST_KEYS.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const value = map.get(FAST_KEYS[i]!);
      if (!FAST_CHECKS[i]!(value)) return null;
      values[i] = value;
    }
    return values;
  }

  private read(id: string): NodeRecord | undefined {
    const value = this.nodesMap.get(id);
    if (value === undefined) {
      this.warned.delete(id);
      return undefined;
    }
    const json = value instanceof Y.Map ? value.toJSON() : value;
    const parsed = NodeSchema.safeParse(json);
    if (parsed.success && parsed.data.id === id) {
      this.warned.delete(id);
      return parsed.data;
    }
    this.invalidCount++;
    if (!this.warned.has(id)) {
      this.warned.add(id);
      this.logger.warn(`Nodo ${id} inválido: no se pinta hasta que se corrija.`);
    }
    return undefined;
  }

  private readText(id: string): string | null {
    const value = this.textsMap.get(id);
    return value instanceof Y.Text ? value.toString().slice(0, DOCUMENT_LIMITS.maxTextLength) : null;
  }

  private readAnimation(id: string): Animation | null {
    const value = this.animationsMap.get(id);
    if (value === undefined) return null;
    const parsed = AnimationSchema.safeParse(value instanceof Y.Map ? value.toJSON() : value);
    return parsed.success ? parsed.data : null;
  }

  private readPages(): PageRecord[] {
    const pages: PageRecord[] = [];
    for (const [id, value] of this.pagesMap.entries()) {
      const json = value instanceof Y.Map ? value.toJSON() : value;
      const parsed = PageSchema.safeParse(json);
      if (parsed.success) pages.push({ id, ...parsed.data });
    }
    return pages.sort(compareOrder);
  }

  private readMeta(): Meta | null {
    const parsed = MetaSchema.safeParse(this.metaMap.toJSON());
    return parsed.success ? parsed.data : null;
  }

  destroy(): void {
    this.nodesMap.unobserveDeep(this.handleNodes);
    this.pagesMap.unobserveDeep(this.handlePages);
    this.metaMap.unobserve(this.handleMeta);
    this.textsMap.unobserveDeep(this.handleTexts);
    this.animationsMap.unobserveDeep(this.handleAnimations);
  }
}
