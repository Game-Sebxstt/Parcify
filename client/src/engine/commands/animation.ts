import type { AnimationPlan } from '../../shared/ai/animation.js';
import { newNodeId } from '../../shared/document/ids.js';
import { ANIMATION_LIMITS } from '../../shared/document/limits.js';
import { AnimationSchema, EasingSchema, KeyframeSchema, type Animation, type AnimProp, type Keyframe } from '../../shared/document/schema.js';
import { PRESETS, type AnimationPresetId } from '../anim/presets.ts';
import { COLOR_PROPS, compileAnimation, poseAtProgress, type Pose } from '../anim/timeline.ts';
import type { NodeRecord } from '../types.ts';
import type { OpBuilder } from '../doc/DocWriter.ts';
import type { AnimationSettings } from '../doc/protocol.ts';
import type { EditorCore } from '../EditorCore.ts';

export const DEFAULT_ANIMATION: AnimationSettings = { duration: 1000, delay: 0, loop: 1, direction: 'normal', autoplay: 'none' };

export type KeyframeInput = { t: number; v: number | string; e?: Keyframe['e'] };

// Un cambio hecho en el lienzo en modo «Grabar», según cómo se combina con el valor que la pista tiene en ese
// instante: add lo suma (posición y giro), multiply lo multiplica (escalas) y set lo sustituye (colores y opacidad).
export type RecordedChange = { id: string; prop: AnimProp; value: number | string; mode: 'add' | 'multiply' | 'set' };

// Un keyframe concreto de una pista de un nodo.
export type KeyRef = { nodeId: string; prop: AnimProp; key: string };

// Keyframes copiados: cada uno con su instante relativo al primero (offsetMs ≥ 0) en ms absolutos del timeline.
export type KeyframeClip = {
  v: 1;
  baseMs: number;
  items: Array<{ nodeId: string; prop: AnimProp; offsetMs: number; v: number | string; e: Keyframe['e'] }>;
};

// Resultado de pegar o duplicar: los keyframes nuevos (la selección pasa a ellos) o por qué no se ha escrito nada.
// track_full: alguna pista pasaría de 64 keyframes; animation_limit: haría falta animar más nodos de los permitidos;
// too_long: la iteración pasaría de la duración máxima; nothing: no queda nada que pegar.
export type KeyframePasteResult = { ok: true; refs: KeyRef[] } | { ok: false; reason: 'track_full' | 'animation_limit' | 'too_long' | 'nothing' };

// Dos keyframes de una pista a menos de esta distancia (en t, 0..1) se consideran el mismo instante.
export const SAME_TIME = 0.0005;

// Límites del factor de estirado, antes del que impone la duración máxima de la iteración.
export const STRETCH_FACTOR = { min: 0.05, max: 20 } as const;

// Separación de una copia duplicada cuando la selección está en un solo instante (y margen tras el último si no).
export const DUPLICATE_GAP_MS = 100;

// t del keyframe (0..1) que corresponde a un tiempo del timeline (ms) dentro de la primera iteración.
export function keyframeTime(animation: Pick<AnimationSettings, 'delay' | 'duration'> | undefined, time: number): number {
  const { delay, duration } = animation ?? DEFAULT_ANIMATION;
  return Math.round(Math.min(1, Math.max(0, (time - delay) / duration)) * 10000) / 10000;
}

// Instante en ms del timeline de un keyframe de la primera iteración.
export function keyframeMs(animation: Pick<AnimationSettings, 'delay' | 'duration'>, t: number): number {
  return animation.delay + t * animation.duration;
}

// Id del keyframe de la pista que cae en el instante `time` (ms) de la primera iteración, o null si no hay ninguno.
export function keyframeKeyAt(animation: Animation | undefined, prop: AnimProp, time: number): string | null {
  const track = animation?.tracks[prop];
  if (!animation || !track) return null;
  const t = (time - animation.delay) / animation.duration;
  if (t < -SAME_TIME || t > 1 + SAME_TIME) return null;
  for (const [key, keyframe] of Object.entries(track)) if (Math.abs(keyframe.t - t) < SAME_TIME) return key;
  return null;
}

// Los valores que no tienen sentido fuera de rango se recortan antes de validar: opacidad en [0, 1] y escalas ≥ 0.
export function clampAnimValue(prop: AnimProp, value: number | string): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  switch (prop) {
    case 'opacity':
      return Math.min(1, Math.max(0, value));
    case 'scale':
    case 'scaleX':
    case 'scaleY':
      return Math.max(0, value);
    default:
      return value;
  }
}

type Fitted = {
  settings: AnimationSettings;
  // La animación con los ajustes nuevos y los keyframes en los mismos instantes; undefined si el nodo no tenía.
  animation: Animation | undefined;
  changed: boolean;
};

const settingsOf = (current: Animation | undefined): AnimationSettings =>
  current ? { duration: current.duration, delay: current.delay, loop: current.loop, direction: current.direction, autoplay: current.autoplay } : DEFAULT_ANIMATION;

// Retardo y duración de la primera iteración ampliados para que lleguen de `from` a `to` (ms). Nunca la acortan.
function widen(base: AnimationSettings, from: number, to: number): Pick<AnimationSettings, 'delay' | 'duration'> {
  const delay = Math.min(base.delay, Math.max(0, Math.floor(from)));
  const end = Math.max(base.delay + base.duration, Math.ceil(to));
  const duration = Math.min(ANIMATION_LIMITS.maxDurationMs, Math.max(ANIMATION_LIMITS.minDurationMs, end - delay));
  return { delay, duration };
}

// Amplía la primera iteración (retardo y duración) para que llegue a `time`, sin mover en el tiempo los keyframes
// que ya hay. Si cambia, reescribe el t de todos los keyframes del nodo: dos clientes que a la vez amplían la misma
// animación pueden pisarse esos t (LWW por keyframe); solo pasa al salirse del rango.
function fitToTime(current: Animation | undefined, time: number): Fitted {
  const base = settingsOf(current);
  const at = Math.max(0, Math.round(time));
  const { delay, duration } = widen(base, at, at);
  if (delay === base.delay && duration === base.duration) return { settings: base, animation: current, changed: false };
  const settings = { ...base, delay, duration };
  if (!current) return { settings, animation: undefined, changed: true };
  const tracks: Animation['tracks'] = {};
  for (const [prop, track] of Object.entries(current.tracks) as Array<[AnimProp, Record<string, Keyframe>]>) {
    const moved: Record<string, Keyframe> = {};
    for (const [key, keyframe] of Object.entries(track)) {
      moved[key] = { ...keyframe, t: keyframeTime(settings, keyframeMs(base, keyframe.t)) };
    }
    tracks[prop] = moved;
  }
  return { settings, animation: { ...settings, tracks }, changed: true };
}

// Ajustes y keyframes reescalados de fitToTime, dentro de la transacción que los usa.
function writeFit(w: OpBuilder, id: string, fit: Fitted): void {
  if (!fit.changed) return;
  if (!fit.animation) {
    w.ensureAnimation(id, fit.settings);
    return;
  }
  w.patchAnimation(id, { delay: fit.settings.delay, duration: fit.settings.duration });
  for (const [prop, track] of Object.entries(fit.animation.tracks) as Array<[AnimProp, Record<string, Keyframe>]>) {
    for (const [key, keyframe] of Object.entries(track)) w.setKeyframe(id, prop, key, keyframe);
  }
}

// Valor de partida de una pista nueva: sin cambio para las relativas y el del nodo para las absolutas (en un texto,
// el relleno es el color de la letra).
export function restValue(record: NodeRecord, prop: AnimProp): number | string | null {
  switch (prop) {
    case 'scale':
    case 'scaleX':
    case 'scaleY':
      return 1;
    case 'opacity':
      return record.opacity;
    case 'fill':
    case 'stroke': {
      const value = record.type === 'text' && prop === 'fill' ? record.color : (record as Record<string, unknown>)[prop];
      return typeof value === 'string' ? value : null;
    }
    default:
      return 0;
  }
}

// Valor que la pose da a una propiedad, o null si la pista no existe.
export function poseValue(pose: Pose, prop: AnimProp): number | string | null {
  switch (prop) {
    case 'offsetX':
      return pose.dx;
    case 'offsetY':
      return pose.dy;
    case 'scaleX':
      return pose.sx;
    case 'scaleY':
      return pose.sy;
    default:
      return pose[prop] ?? null;
  }
}

// Pistas que se graban juntas: con la línea de tiempo abierta y Grabar apagado, un cambio de un grupo se graba si el
// nodo ya tiene pista en alguna de sus propiedades. En los textos, el color de la letra va en `fill`.
export const ANIM_GROUPS = {
  position: ['offsetX', 'offsetY'],
  scale: ['scale', 'scaleX', 'scaleY'],
  rotation: ['rotation'],
  opacity: ['opacity'],
  fill: ['fill'],
  stroke: ['stroke'],
} as const satisfies Record<string, readonly AnimProp[]>;

export const TRANSFORM_PROPS: readonly AnimProp[] = [...ANIM_GROUPS.position, ...ANIM_GROUPS.scale, ...ANIM_GROUPS.rotation];

// El nodo con la pose aplicada, tal como lo pinta el reproductor: desplazado, girado y, en las hojas y los marcos,
// con la escala sobre el centro llevada a su caja. Una línea guarda el giro en sus puntos y un grupo no tiene caja
// propia: solo se desplazan (y el grupo gira).
export function posedRecord(record: NodeRecord, pose: Pose): NodeRecord {
  const x = record.x + pose.dx;
  const y = record.y + pose.dy;
  if (record.type === 'line') return { ...record, x, y };
  const rotation = record.rotation + pose.rotation;
  if (record.type === 'group') return { ...record, x, y, rotation };
  const w = record.w * Math.max(0, pose.scale * pose.sx);
  const h = record.h * Math.max(0, pose.scale * pose.sy);
  return { ...record, x: x + (record.w - w) / 2, y: y + (record.h - h) / 2, w, h, rotation } as NodeRecord;
}

// ── Borrador de las pistas de un nodo para la edición en lote ──
//
// Los keyframes se editan en ms absolutos del timeline. Al cerrar el borrador, la primera iteración se amplía para
// que quepan todos (como fitToTime) y cada keyframe vuelve a t. Solo se escriben los que cambian: con los ajustes
// iguales, un keyframe que no se ha tocado conserva su t exacto y no se reescribe.

type DraftEntry = { ms: number; t: number | null; v: number | string; e: Keyframe['e']; seq: number };

// kept: claves `prop:key` de los keyframes tocados que se escriben (los que pierden contra otro del mismo instante no).
type DraftPlan = { id: string; kept: ReadonlySet<string>; write: (w: OpBuilder) => void };

class TrackDraft {
  private seq = 0;
  private readonly base: AnimationSettings;
  private settings: AnimationSettings;
  private settingsForced = false;
  readonly tracks = new Map<AnimProp, Map<string, DraftEntry>>();
  // Claves `prop:key` editadas o nuevas; las demás solo se reescriben si cambian los ajustes.
  private readonly touched = new Set<string>();
  private readonly original = new Set<string>();

  constructor(
    readonly id: string,
    readonly current: Animation | undefined,
  ) {
    this.base = settingsOf(current);
    this.settings = this.base;
    for (const [prop, track] of Object.entries(current?.tracks ?? {}) as Array<[AnimProp, Record<string, Keyframe>]>) {
      const entries = new Map<string, DraftEntry>();
      for (const [key, keyframe] of Object.entries(track)) {
        entries.set(key, { ms: keyframeMs(this.base, keyframe.t), t: keyframe.t, v: keyframe.v, e: keyframe.e, seq: 0 });
        this.original.add(`${prop}:${key}`);
      }
      this.tracks.set(prop, entries);
    }
  }

  get delay(): number {
    return this.settings.delay;
  }

  get end(): number {
    return this.settings.delay + this.settings.duration;
  }

  entry(prop: AnimProp, key: string): DraftEntry | undefined {
    return this.tracks.get(prop)?.get(key);
  }

  // Sustituye los ajustes de la animación (efectos de un clic sobre un nodo sin otras pistas).
  forceSettings(settings: AnimationSettings): void {
    this.settings = settings;
    this.settingsForced = true;
    for (const track of this.tracks.values()) for (const entry of track.values()) entry.t = null;
  }

  set(prop: AnimProp, key: string, patch: Partial<Pick<DraftEntry, 'ms' | 'v' | 'e'>>): void {
    let track = this.tracks.get(prop);
    if (!track) this.tracks.set(prop, (track = new Map()));
    const previous = track.get(key);
    const ms = patch.ms ?? previous?.ms ?? 0;
    const t = previous && patch.ms === undefined ? previous.t : null;
    track.set(key, { ms, t, v: patch.v ?? previous!.v, e: patch.e ?? previous!.e, seq: ++this.seq });
    this.touched.add(`${prop}:${key}`);
  }

  delete(prop: AnimProp, key: string): void {
    this.tracks.get(prop)?.delete(key);
    this.touched.delete(`${prop}:${key}`);
  }

  clearTrack(prop: AnimProp): void {
    for (const key of [...(this.tracks.get(prop)?.keys() ?? [])]) this.delete(prop, key);
  }

  hasOtherTracks(props: ReadonlySet<AnimProp>): boolean {
    for (const [prop, track] of this.tracks) if (!props.has(prop) && track.size) return true;
    return false;
  }

  get touchedCount(): number {
    return this.touched.size;
  }

  // Ajustes, colisiones y escrituras. Gana el keyframe tocado: uno sin tocar a menos de SAME_TIME de otro tocado de la
  // misma pista se borra, y entre dos tocados en el mismo instante queda el último.
  plan(): DraftPlan | 'track_full' | 'invalid' {
    let min = Infinity;
    let max = -Infinity;
    for (const track of this.tracks.values()) {
      for (const entry of track.values()) {
        min = Math.min(min, entry.ms);
        max = Math.max(max, entry.ms);
      }
    }
    const settings = min <= max ? { ...this.settings, ...widen(this.settings, min, max) } : this.settings;
    const settingsChanged = this.settingsForced || settings.delay !== this.base.delay || settings.duration !== this.base.duration;
    const writes: Array<[AnimProp, string, Keyframe]> = [];
    const deletes: Array<[AnimProp, string]> = [];
    const keptTouched = new Set<string>();
    for (const [prop, track] of this.tracks) {
      const timed = [...track].map(([key, entry]) => ({
        key,
        entry,
        t: !settingsChanged && entry.t !== null ? entry.t : keyframeTime(settings, entry.ms),
        touched: this.touched.has(`${prop}:${key}`),
      }));
      const winners = timed.filter((item) => item.touched).sort((a, b) => b.entry.seq - a.entry.seq);
      const kept: typeof timed = [];
      for (const item of winners) {
        if (kept.some((other) => Math.abs(other.t - item.t) < SAME_TIME)) continue;
        kept.push(item);
      }
      const touchedKept = [...kept];
      for (const item of touchedKept) keptTouched.add(`${prop}:${item.key}`);
      for (const item of timed) {
        if (item.touched) continue;
        if (touchedKept.some((other) => Math.abs(other.t - item.t) < SAME_TIME)) continue;
        kept.push(item);
      }
      if (kept.length > ANIMATION_LIMITS.maxKeyframesPerTrack) return 'track_full';
      const keptKeys = new Set(kept.map((item) => item.key));
      for (const item of kept) {
        if (!item.touched && !settingsChanged) continue;
        const keyframe = validKeyframe(prop, { t: item.t, v: item.entry.v, e: item.entry.e });
        if (!keyframe) return 'invalid';
        writes.push([prop, item.key, keyframe]);
      }
      for (const key of track.keys()) if (!keptKeys.has(key) && this.original.has(`${prop}:${key}`)) deletes.push([prop, key]);
    }
    for (const id of this.original) {
      const [prop, key] = id.split(':') as [AnimProp, string];
      if (!this.tracks.get(prop)?.has(key)) deletes.push([prop, key]);
    }
    const id = this.id;
    const current = this.current;
    return {
      id,
      kept: keptTouched,
      write: (w) => {
        if (!current) w.ensureAnimation(id, settings);
        else if (this.settingsForced) w.patchAnimation(id, settings);
        else if (settingsChanged) w.patchAnimation(id, { delay: settings.delay, duration: settings.duration });
        for (const [prop, key] of deletes) w.deleteKeyframe(id, prop, key);
        for (const [prop, key, keyframe] of writes) w.setKeyframe(id, prop, key, keyframe);
      },
    };
  }
}

const refId = (ref: Pick<KeyRef, 'prop' | 'key'>) => `${ref.prop}:${ref.key}`;

// Comandos del modelo de animación. Cada uno es una transacción y un paso de deshacer. Un keyframe vive en el
// Y.Map de su pista con su propio id: dos personas que añaden keyframes a la vez conservan los dos, y moverlo
// reemplaza su valor.
export class AnimationCommands {
  constructor(private readonly core: EditorCore) {}

  private get canEdit(): boolean {
    return !this.core.readOnly.get();
  }

  private target(nodeId: string): boolean {
    const record = this.core.record(nodeId);
    return this.canEdit && !!record && record.type !== 'connector';
  }

  private transact(run: (w: OpBuilder) => void): boolean {
    return this.core.writer.transact({ step: 'new' }, run);
  }

  animation(nodeId: string): Animation | undefined {
    this.core.syncModel();
    return this.core.store.animation(nodeId);
  }

  // Devuelve el id del keyframe nuevo, o null si no se puede (valor inválido, pista llena o límite de nodos animados).
  addKeyframe(nodeId: string, prop: AnimProp, input: KeyframeInput): string | null {
    if (!this.target(nodeId)) return null;
    const keyframe = validKeyframe(prop, { t: input.t, v: input.v, e: input.e ?? 'linear' });
    if (!keyframe) return null;
    const current = this.animation(nodeId);
    if (!current && this.core.store.animationCount >= ANIMATION_LIMITS.maxAnimatedNodes) return null;
    if (Object.keys(current?.tracks[prop] ?? {}).length >= ANIMATION_LIMITS.maxKeyframesPerTrack) return null;
    const key = newNodeId();
    this.transact((w) => {
      if (!current) w.ensureAnimation(nodeId, DEFAULT_ANIMATION);
      w.setKeyframe(nodeId, prop, key, keyframe);
    });
    return key;
  }

  // Keyframe de la pista en el instante `time` (ms): el que ya hay o uno nuevo con el valor de ese instante. Si
  // `time` cae fuera de la primera iteración, la amplía en la misma transacción. Devuelve su id, o null.
  keyframeAtTime(nodeId: string, prop: AnimProp, time: number): string | null {
    const record = this.core.record(nodeId);
    if (!record || !this.target(nodeId)) return null;
    const current = this.animation(nodeId);
    if (!current && this.core.store.animationCount >= ANIMATION_LIMITS.maxAnimatedNodes) return null;
    const fit = fitToTime(current, time);
    const t = keyframeTime(fit.settings, time);
    const entries = Object.entries(fit.animation?.tracks[prop] ?? {});
    const same = entries.find(([, keyframe]) => Math.abs(keyframe.t - t) < SAME_TIME);
    if (same) return same[0];
    if (entries.length >= ANIMATION_LIMITS.maxKeyframesPerTrack) return null;
    const sampled = fit.animation && entries.length ? poseValue(poseAtProgress(compileAnimation(fit.animation), t), prop) : null;
    const value = sampled ?? restValue(record, prop);
    const keyframe = value === null ? null : validKeyframe(prop, { t, v: value, e: 'linear' });
    if (!keyframe) return null;
    const key = newNodeId();
    this.transact((w) => {
      if (!current && !fit.changed) w.ensureAnimation(nodeId, DEFAULT_ANIMATION);
      writeFit(w, nodeId, fit);
      w.setKeyframe(nodeId, prop, key, keyframe);
    });
    return key;
  }

  // Un keyframe en el instante `time` (ms) en cada pista de `targets` que aún no lo tenga, con el valor que se ve en
  // ese instante (el del diseño si la pista no existe), todo en un paso de deshacer. Si `time` cae fuera de la primera
  // iteración, la amplía. Devuelve los keyframes nuevos.
  keyframesAtTime(targets: ReadonlyArray<{ nodeId: string; prop: AnimProp }>, time: number): KeyRef[] {
    if (!this.canEdit || !Number.isFinite(time)) return [];
    this.core.syncModel();
    const at = Math.max(0, Math.round(time));
    const drafts = new Map<string, TrackDraft>();
    const refs: KeyRef[] = [];
    let created = 0;
    for (const { nodeId, prop } of targets) {
      const record = this.core.record(nodeId);
      if (!record || !this.target(nodeId) || this.core.isLocked(nodeId)) continue;
      if (refs.some((ref) => ref.nodeId === nodeId && ref.prop === prop)) continue;
      const current = this.core.store.animation(nodeId);
      if (keyframeKeyAt(current, prop, at)) continue;
      const tracked = current && Object.keys(current.tracks[prop] ?? {}).length > 0;
      const sampled = tracked ? poseValue(poseAtProgress(compileAnimation(current), keyframeTime(current, at)), prop) : null;
      const value = sampled ?? restValue(record, prop);
      if (value === null) continue;
      let draft = drafts.get(nodeId);
      if (!draft) {
        if (!current && this.core.store.animationCount + created >= ANIMATION_LIMITS.maxAnimatedNodes) continue;
        if (!current) created++;
        draft = new TrackDraft(nodeId, current);
        drafts.set(nodeId, draft);
      }
      const key = newNodeId();
      draft.set(prop, key, { ms: at, v: value, e: 'linear' });
      refs.push({ nodeId, prop, key });
    }
    if (!refs.length) return [];
    return Array.isArray(this.writeDrafts(drafts.values())) ? refs : [];
  }

  // Cambia el tiempo, el valor o el easing de un keyframe existente.
  updateKeyframe(nodeId: string, prop: AnimProp, key: string, patch: Partial<Keyframe>): boolean {
    if (!this.target(nodeId)) return false;
    const existing = this.animation(nodeId)?.tracks[prop]?.[key];
    if (!existing) return false;
    const keyframe = validKeyframe(prop, { ...existing, ...patch });
    if (!keyframe) return false;
    return this.transact((w) => w.setKeyframe(nodeId, prop, key, keyframe));
  }

  moveKeyframe(nodeId: string, prop: AnimProp, key: string, t: number): boolean {
    return this.updateKeyframe(nodeId, prop, key, { t });
  }

  deleteKeyframe(nodeId: string, prop: AnimProp, key: string): boolean {
    if (!this.target(nodeId) || !this.animation(nodeId)?.tracks[prop]?.[key]) return false;
    return this.transact((w) => w.deleteKeyframe(nodeId, prop, key));
  }

  // ── Edición en lote ──
  //
  // Cada operación recibe KeyRef de uno o varios nodos y escribe todo en una transacción y un paso de deshacer. Los
  // KeyRef que ya no existen (otro cliente los borró) se ignoran.

  // Borradores de los nodos editables de `refs`, con solo los KeyRef que existen.
  private drafts(refs: readonly KeyRef[]): Map<string, { draft: TrackDraft; refs: KeyRef[] }> {
    this.core.syncModel();
    const out = new Map<string, { draft: TrackDraft; refs: KeyRef[] }>();
    const seen = new Set<string>();
    for (const ref of refs) {
      const unique = `${ref.nodeId}:${refId(ref)}`;
      if (seen.has(unique)) continue;
      seen.add(unique);
      if (!this.target(ref.nodeId)) continue;
      let slot = out.get(ref.nodeId);
      if (!slot) {
        const current = this.core.store.animation(ref.nodeId);
        if (!current) continue;
        slot = { draft: new TrackDraft(ref.nodeId, current), refs: [] };
        out.set(ref.nodeId, slot);
      }
      if (slot.draft.entry(ref.prop, ref.key)) slot.refs.push(ref);
    }
    for (const [id, slot] of out) if (!slot.refs.length) out.delete(id);
    return out;
  }

  // Escribe los borradores en una transacción. Devuelve los planes escritos, o por qué no se ha escrito nada.
  private writeDrafts(drafts: Iterable<TrackDraft>): DraftPlan[] | 'track_full' | 'nothing' {
    const plans: DraftPlan[] = [];
    for (const draft of drafts) {
      const plan = draft.plan();
      if (plan === 'track_full') return 'track_full';
      if (plan === 'invalid') return 'nothing';
      plans.push(plan);
    }
    if (!plans.length) return 'nothing';
    const wrote = this.transact((w) => {
      for (const plan of plans) plan.write(w);
    });
    return wrote ? plans : 'nothing';
  }

  private commitDrafts(drafts: Iterable<TrackDraft>): boolean {
    return Array.isArray(this.writeDrafts(drafts));
  }

  // Instantes (ms) de los keyframes de `refs` que existen, de menor a mayor.
  private refTimes(refs: readonly KeyRef[]): number[] {
    const times: number[] = [];
    for (const { draft, refs: list } of this.drafts(refs).values()) for (const ref of list) times.push(draft.entry(ref.prop, ref.key)!.ms);
    return times.sort((a, b) => a - b);
  }

  // Desplazamiento (ms) que admite `refs` sin pasar de 0 ni de la duración máxima de la iteración.
  moveLimits(refs: readonly KeyRef[]): { min: number; max: number } {
    let min = -Infinity;
    let max = Infinity;
    const maxSpan = ANIMATION_LIMITS.maxDurationMs;
    for (const { draft, refs: list } of this.drafts(refs).values()) {
      const times = list.map((ref) => draft.entry(ref.prop, ref.key)!.ms);
      const first = Math.min(...times);
      const last = Math.max(...times);
      min = Math.max(min, -first, draft.end - maxSpan - first);
      max = Math.min(max, maxSpan + draft.delay - last);
    }
    return min <= max ? { min, max } : { min: 0, max: 0 };
  }

  // Mueve los keyframes `deltaMs` en el tiempo, todos a la vez (el delta se recorta a moveLimits). La primera
  // iteración se amplía si se salen. Un keyframe movido que cae a menos de SAME_TIME de otro no seleccionado de la
  // misma pista lo sustituye.
  moveKeyframes(refs: readonly KeyRef[], deltaMs: number): boolean {
    if (!this.canEdit || !Number.isFinite(deltaMs)) return false;
    const limits = this.moveLimits(refs);
    const delta = Math.min(limits.max, Math.max(limits.min, deltaMs));
    if (Math.abs(delta) < 1e-6) return false;
    const drafts = this.drafts(refs);
    for (const { draft, refs: list } of drafts.values()) {
      for (const ref of list) draft.set(ref.prop, ref.key, { ms: draft.entry(ref.prop, ref.key)!.ms + delta });
    }
    return this.commitDrafts([...drafts.values()].map((slot) => slot.draft));
  }

  deleteKeyframes(refs: readonly KeyRef[]): boolean {
    if (!this.canEdit) return false;
    const drafts = this.drafts(refs);
    for (const { draft, refs: list } of drafts.values()) for (const ref of list) draft.delete(ref.prop, ref.key);
    return this.commitDrafts([...drafts.values()].map((slot) => slot.draft));
  }

  setEasing(refs: readonly KeyRef[], easing: Keyframe['e']): boolean {
    if (!this.canEdit || !EasingSchema.safeParse(easing).success) return false;
    const drafts = this.drafts(refs);
    for (const { draft, refs: list } of drafts.values()) for (const ref of list) draft.set(ref.prop, ref.key, { e: easing });
    return this.commitDrafts([...drafts.values()].map((slot) => slot.draft));
  }

  // Factores de estirado que admite `refs` con ese pivote: [0,05, 20] y, además, que la primera iteración de cada nodo
  // no pase de la duración máxima ni empiece antes de 0. Con el pivote en el primero, el máximo es
  // (maxDurationMs − (minMs − delay)) / (maxMs − minMs).
  stretchLimits(refs: readonly KeyRef[], pivotMs: number): { min: number; max: number } {
    let max: number = STRETCH_FACTOR.max;
    const maxSpan = ANIMATION_LIMITS.maxDurationMs;
    for (const { draft, refs: list } of this.drafts(refs).values()) {
      const times = list.map((ref) => draft.entry(ref.prop, ref.key)!.ms);
      const first = Math.min(...times);
      const last = Math.max(...times);
      if (last - first > 0) max = Math.min(max, maxSpan / (last - first));
      if (last > pivotMs) max = Math.min(max, (maxSpan + draft.delay - pivotMs) / (last - pivotMs));
      if (first < pivotMs) {
        max = Math.min(max, pivotMs / (pivotMs - first));
        max = Math.min(max, (maxSpan - draft.end + pivotMs) / (pivotMs - first));
      }
    }
    return { min: STRETCH_FACTOR.min, max: Math.max(1, max) };
  }

  // Estira (factor > 1) o encoge los keyframes alrededor de `pivotMs`. Hace falta que estén en al menos dos instantes.
  stretchKeyframes(refs: readonly KeyRef[], pivotMs: number, factor: number): boolean {
    if (!this.canEdit || !Number.isFinite(factor) || !Number.isFinite(pivotMs)) return false;
    const times = this.refTimes(refs);
    if (times.length < 2 || times[times.length - 1]! - times[0]! < 1e-6) return false;
    const limits = this.stretchLimits(refs, pivotMs);
    const scale = Math.min(limits.max, Math.max(limits.min, factor));
    if (Math.abs(scale - 1) < 1e-9) return false;
    const drafts = this.drafts(refs);
    for (const { draft, refs: list } of drafts.values()) {
      for (const ref of list) {
        const ms = draft.entry(ref.prop, ref.key)!.ms;
        draft.set(ref.prop, ref.key, { ms: Math.max(0, pivotMs + (ms - pivotMs) * scale) });
      }
    }
    return this.commitDrafts([...drafts.values()].map((slot) => slot.draft));
  }

  copyKeyframes(refs: readonly KeyRef[]): KeyframeClip | null {
    const items: Array<KeyframeClip['items'][number] & { ms: number }> = [];
    for (const { draft, refs: list } of this.drafts(refs).values()) {
      for (const ref of list) {
        const entry = draft.entry(ref.prop, ref.key)!;
        items.push({ nodeId: ref.nodeId, prop: ref.prop, offsetMs: 0, v: entry.v, e: entry.e, ms: entry.ms });
      }
    }
    if (!items.length) return null;
    const baseMs = Math.min(...items.map((item) => item.ms));
    return {
      v: 1,
      baseMs,
      items: items.sort((a, b) => a.ms - b.ms).map(({ ms, ...item }) => ({ ...item, offsetMs: Math.round((ms - baseMs) * 1000) / 1000 })),
    };
  }

  // Pega el clip con su primer keyframe en `atMs`. Si el clip viene de un solo nodo y hay un solo destino, se pega en
  // ese destino; si no, en los nodos de origen que sigan existiendo. Una copia a menos de SAME_TIME de un keyframe de
  // la misma pista lo sustituye. Si algo no cabe, no se pega nada.
  pasteKeyframes(clip: KeyframeClip, atMs: number, targetIds: readonly string[]): KeyframePasteResult {
    if (!this.canEdit || clip?.v !== 1 || !Array.isArray(clip.items) || !Number.isFinite(atMs)) return { ok: false, reason: 'nothing' };
    this.core.syncModel();
    const sources = new Set(clip.items.map((item) => item.nodeId));
    const remap = sources.size === 1 && targetIds.length === 1 ? targetIds[0]! : null;
    const drafts = new Map<string, TrackDraft>();
    const refs: KeyRef[] = [];
    let created = 0;
    for (const item of clip.items) {
      const nodeId = remap ?? item.nodeId;
      if (!this.target(nodeId)) continue;
      let draft = drafts.get(nodeId);
      if (!draft) {
        const current = this.core.store.animation(nodeId);
        if (!current && this.core.store.animationCount + ++created > ANIMATION_LIMITS.maxAnimatedNodes) return { ok: false, reason: 'animation_limit' };
        draft = new TrackDraft(nodeId, current);
        drafts.set(nodeId, draft);
      }
      const key = newNodeId();
      draft.set(item.prop, key, { ms: Math.max(0, atMs + Math.max(0, item.offsetMs)), v: clampAnimValue(item.prop, item.v), e: item.e });
      refs.push({ nodeId, prop: item.prop, key });
    }
    if (!refs.length) return { ok: false, reason: 'nothing' };
    for (const draft of drafts.values()) {
      let first = draft.delay;
      let last = draft.end;
      for (const track of draft.tracks.values()) {
        for (const entry of track.values()) {
          first = Math.min(first, entry.ms);
          last = Math.max(last, entry.ms);
        }
      }
      if (last - first > ANIMATION_LIMITS.maxDurationMs) return { ok: false, reason: 'too_long' };
    }
    const plans = this.writeDrafts(drafts.values());
    if (!Array.isArray(plans)) return { ok: false, reason: plans };
    // Una copia que ha perdido contra otra copia del mismo instante no existe.
    const kept = new Map(plans.map((plan) => [plan.id, plan.kept]));
    return { ok: true, refs: refs.filter((ref) => kept.get(ref.nodeId)?.has(refId(ref))) };
  }

  // Duplica los keyframes en los mismos nodos, desplazados `offsetMs`. Por defecto, justo después de la selección:
  // (maxMs − minMs) + 100 si abarca más de un instante y 100 si no.
  duplicateKeyframes(refs: readonly KeyRef[], offsetMs?: number): KeyframePasteResult {
    const clip = this.copyKeyframes(refs);
    if (!clip) return { ok: false, reason: 'nothing' };
    const span = Math.max(...clip.items.map((item) => item.offsetMs));
    const offset = offsetMs ?? (span >= 1 ? span + DUPLICATE_GAP_MS : DUPLICATE_GAP_MS);
    return this.pasteKeyframes(clip, clip.baseMs + offset, []);
  }

  // Efecto de un clic: sustituye en cada nodo solo las pistas que usa el efecto. En un nodo sin otras pistas, la
  // iteración pasa a durar lo que el efecto; si tiene otras, los keyframes del efecto se colocan desde el inicio de la
  // iteración con su duración en ms y la iteración se amplía si hace falta.
  applyPreset(ids: readonly string[], presetId: AnimationPresetId): boolean {
    const preset = PRESETS[presetId];
    if (!this.canEdit || !preset) return false;
    this.core.syncModel();
    const props = new Set(Object.keys(preset.tracks) as AnimProp[]);
    const drafts: TrackDraft[] = [];
    let created = 0;
    for (const id of new Set(ids)) {
      const record = this.core.record(id);
      if (!record || !this.target(id) || this.core.isLocked(id)) continue;
      const current = this.core.store.animation(id);
      if (!current && this.core.store.animationCount + created >= ANIMATION_LIMITS.maxAnimatedNodes) continue;
      const draft = new TrackDraft(id, current);
      for (const prop of props) draft.clearTrack(prop);
      const settings = settingsOf(current);
      const alone = !draft.hasOtherTracks(props);
      if (alone) draft.forceSettings({ ...settings, duration: preset.durationMs });
      let valid = true;
      for (const prop of props) {
        for (const keyframe of preset.tracks[prop]!) {
          const value = keyframe.v === 'base' ? restValue(record, prop) : keyframe.v;
          if (value === null) {
            valid = false;
            break;
          }
          draft.set(prop, newNodeId(), { ms: settings.delay + keyframe.t * preset.durationMs, v: value, e: keyframe.e });
        }
      }
      if (!valid) continue;
      if (!current) created++;
      drafts.push(draft);
    }
    return this.commitDrafts(drafts);
  }

  // Duración, retardo, repeticiones, dirección y autoplay. Crea la animación si el nodo aún no tiene.
  setAnimation(nodeId: string, settings: Partial<AnimationSettings>): boolean {
    if (!this.target(nodeId)) return false;
    const current = this.animation(nodeId);
    if (!current && this.core.store.animationCount >= ANIMATION_LIMITS.maxAnimatedNodes) return false;
    const next = { ...DEFAULT_ANIMATION, ...current, ...settings, tracks: current?.tracks ?? {} };
    if (!AnimationSchema.safeParse(next).success) return false;
    return this.transact((w) => {
      if (!current) w.ensureAnimation(nodeId, { ...DEFAULT_ANIMATION, ...settings });
      else w.patchAnimation(nodeId, settings);
    });
  }

  // Los mismos ajustes en las animaciones que ya tienen los nodos de `ids`, en un paso de deshacer. Los nodos sin
  // animación no cambian.
  setAnimations(ids: readonly string[], settings: Partial<AnimationSettings>): boolean {
    if (!this.canEdit) return false;
    this.core.syncModel();
    const targets: string[] = [];
    for (const id of new Set(ids)) {
      const current = this.core.store.animation(id);
      if (!current || !this.target(id) || this.core.isLocked(id)) continue;
      if (!AnimationSchema.safeParse({ ...current, ...settings }).success) return false;
      targets.push(id);
    }
    if (!targets.length) return false;
    return this.transact((w) => {
      for (const id of targets) w.patchAnimation(id, settings);
    });
  }

  // Modo «Grabar»: cada cambio crea o actualiza el keyframe de su pista en el instante `time` (ms), todo en una
  // transacción. Una pista nueva que no empieza en 0 recibe también un keyframe en 0 con el valor de partida. Si
  // `time` cae fuera de la primera iteración de un nodo, se amplía en la misma transacción. `merge`: se funde con el
  // paso de deshacer anterior (lo que el mismo cambio acaba de escribir en el diseño base).
  recordAt(time: number, changes: readonly RecordedChange[], options: { merge?: boolean } = {}): boolean {
    if (!this.canEdit || !changes.length) return false;
    const byNode = new Map<string, RecordedChange[]>();
    for (const change of changes) byNode.set(change.id, [...(byNode.get(change.id) ?? []), change]);
    const created: string[] = [];
    const fits = new Map<string, Fitted>();
    const writes: Array<{ id: string; prop: AnimProp; key: string; keyframe: Keyframe }> = [];
    for (const [id, list] of byNode) {
      const record = this.core.record(id);
      if (!record || !this.target(id)) continue;
      const current = this.animation(id);
      if (!current && this.core.store.animationCount + created.length >= ANIMATION_LIMITS.maxAnimatedNodes) continue;
      const fit = fitToTime(current, time);
      const t = keyframeTime(fit.settings, time);
      const pose = fit.animation ? poseAtProgress(compileAnimation(fit.animation), t) : null;
      let wrote = false;
      for (const change of list) {
        const entries = Object.entries(fit.animation?.tracks[change.prop] ?? {});
        let value = change.value;
        if (change.mode !== 'set' && typeof value === 'number') {
          const sampled = pose ? poseValue(pose, change.prop) : null;
          const base = typeof sampled === 'number' ? sampled : change.mode === 'multiply' ? 1 : 0;
          value = Math.round((change.mode === 'multiply' ? base * value : base + value) * 1000) / 1000;
        }
        const same = entries.find(([, keyframe]) => Math.abs(keyframe.t - t) < SAME_TIME);
        const pending: Array<{ key: string; keyframe: Keyframe | null }> = [];
        if (same) {
          pending.push({ key: same[0], keyframe: validKeyframe(change.prop, { ...same[1], v: value }) });
        } else {
          const start = !entries.length && t > 0 ? restValue(record, change.prop) : null;
          const room = ANIMATION_LIMITS.maxKeyframesPerTrack - entries.length;
          if (room < (start === null ? 1 : 2)) continue;
          if (start !== null) pending.push({ key: newNodeId(), keyframe: validKeyframe(change.prop, { t: 0, v: start, e: 'linear' }) });
          pending.push({ key: newNodeId(), keyframe: validKeyframe(change.prop, { t, v: value, e: 'linear' }) });
        }
        if (pending.some((item) => !item.keyframe)) continue;
        for (const item of pending) writes.push({ id, prop: change.prop, key: item.key, keyframe: item.keyframe! });
        wrote = true;
      }
      if (!wrote) continue;
      if (!current) created.push(id);
      fits.set(id, fit);
    }
    if (!writes.length) return false;
    return this.core.writer.transact({ step: options.merge ? 'merge' : 'new' }, (w) => {
      for (const id of created) if (!fits.get(id)?.changed) w.ensureAnimation(id, DEFAULT_ANIMATION);
      for (const [id, fit] of fits) writeFit(w, id, fit);
      for (const write of writes) w.setKeyframe(write.id, write.prop, write.key, write.keyframe);
    });
  }

  // Animaciones propuestas por la IA y aceptadas: sustituyen a las de esos nodos en una sola transacción con origen
  // IA (un paso de deshacer). Se omiten los nodos que ya no existen, están bloqueados o son conectores. Una
  // animación existente conserva su Y.Map: se cambian sus ajustes y se reemplazan sus keyframes.
  applyAiAnimations(plan: AnimationPlan): { applied: number; skipped: number } {
    if (!this.canEdit) return { applied: 0, skipped: plan.animations.length };
    this.core.syncModel();
    let created = 0;
    const writes: Array<{ id: string; current: Animation | undefined; animation: Animation }> = [];
    for (const { nodeId, animation } of plan.animations) {
      const parsed = AnimationSchema.safeParse(animation);
      if (!parsed.success || !this.target(nodeId) || this.core.isLocked(nodeId)) continue;
      const current = this.core.store.animation(nodeId);
      if (!current && this.core.store.animationCount + created >= ANIMATION_LIMITS.maxAnimatedNodes) continue;
      if (!current) created++;
      writes.push({ id: nodeId, current, animation: parsed.data });
    }
    const skipped = plan.animations.length - writes.length;
    if (!writes.length) return { applied: 0, skipped };
    this.core.writer.transact({ step: 'new', origin: 'ai' }, (w) => {
      for (const { id, current, animation } of writes) {
        const settings: AnimationSettings = {
          duration: animation.duration,
          delay: animation.delay,
          loop: animation.loop,
          direction: animation.direction,
          autoplay: current?.autoplay ?? animation.autoplay,
        };
        if (current) {
          w.patchAnimation(id, settings);
          for (const [prop, track] of Object.entries(current.tracks) as Array<[AnimProp, Record<string, Keyframe>]>) {
            for (const key of Object.keys(track)) w.deleteKeyframe(id, prop, key);
          }
        } else {
          w.ensureAnimation(id, settings);
        }
        for (const [prop, track] of Object.entries(animation.tracks) as Array<[AnimProp, Record<string, Keyframe>]>) {
          for (const keyframe of Object.values(track)) w.setKeyframe(id, prop, newNodeId(), keyframe);
        }
      }
    });
    return { applied: writes.length, skipped };
  }

  deleteAnimation(nodeId: string): boolean {
    if (!this.canEdit || !this.animation(nodeId)) return false;
    return this.transact((w) => w.deleteAnimation(nodeId));
  }
}

function validKeyframe(prop: AnimProp, keyframe: Keyframe): Keyframe | null {
  const parsed = KeyframeSchema.safeParse({ ...keyframe, v: clampAnimValue(prop, keyframe.v) });
  if (!parsed.success || (typeof parsed.data.v === 'string') !== COLOR_PROPS.has(prop)) return null;
  return parsed.data;
}
