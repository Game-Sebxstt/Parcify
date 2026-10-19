import type { AnimationPlan } from '../../shared/ai/animation.js';
import { newNodeId } from '../../shared/document/ids.js';
import { ANIMATION_LIMITS } from '../../shared/document/limits.js';
import { AnimationSchema, KeyframeSchema, type Animation, type AnimProp, type Keyframe } from '../../shared/document/schema.js';
import { COLOR_PROPS, compileAnimation, poseAtProgress, type Pose } from '../anim/timeline.ts';
import type { NodeRecord } from '../types.ts';
import type { OpBuilder } from '../doc/DocWriter.ts';
import type { AnimationSettings } from '../doc/protocol.ts';
import type { EditorCore } from '../EditorCore.ts';

export const DEFAULT_ANIMATION: AnimationSettings = { duration: 1000, delay: 0, loop: 1, direction: 'normal', autoplay: 'none' };

export type KeyframeInput = { t: number; v: number | string; e?: Keyframe['e'] };

// Un cambio hecho en el lienzo en modo «Grabar». relative: se suma al valor que la pista tiene en ese instante.
export type RecordedChange = { id: string; prop: AnimProp; value: number | string; relative?: boolean };

// Dos keyframes de una pista a menos de esta distancia se consideran el mismo instante.
const SAME_TIME = 0.0005;

// t del keyframe (0..1) que corresponde a un tiempo del timeline (ms) dentro de la primera iteración.
export function keyframeTime(animation: Pick<AnimationSettings, 'delay' | 'duration'> | undefined, time: number): number {
  const { delay, duration } = animation ?? DEFAULT_ANIMATION;
  return Math.round(Math.min(1, Math.max(0, (time - delay) / duration)) * 10000) / 10000;
}

type Fitted = {
  settings: AnimationSettings;
  // La animación con los ajustes nuevos y los keyframes en los mismos instantes; undefined si el nodo no tenía.
  animation: Animation | undefined;
  changed: boolean;
};

// Amplía la primera iteración (retardo y duración) para que llegue a `time`, sin mover en el tiempo los keyframes
// que ya hay.
function fitToTime(current: Animation | undefined, time: number): Fitted {
  const base: AnimationSettings = current
    ? { duration: current.duration, delay: current.delay, loop: current.loop, direction: current.direction, autoplay: current.autoplay }
    : DEFAULT_ANIMATION;
  const at = Math.max(0, Math.round(time));
  const delay = Math.min(base.delay, at);
  const end = Math.max(base.delay + base.duration, at);
  const duration = Math.min(ANIMATION_LIMITS.maxDurationMs, Math.max(ANIMATION_LIMITS.minDurationMs, end - delay));
  if (delay === base.delay && duration === base.duration) return { settings: base, animation: current, changed: false };
  const settings = { ...base, delay, duration };
  if (!current) return { settings, animation: undefined, changed: true };
  const tracks: Animation['tracks'] = {};
  for (const [prop, track] of Object.entries(current.tracks) as Array<[AnimProp, Record<string, Keyframe>]>) {
    const moved: Record<string, Keyframe> = {};
    for (const [key, keyframe] of Object.entries(track)) {
      moved[key] = { ...keyframe, t: keyframeTime(settings, base.delay + keyframe.t * base.duration) };
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

// Valor de partida de una pista nueva: sin cambio para las relativas y el del nodo para las absolutas.
export function restValue(record: NodeRecord, prop: AnimProp): number | string | null {
  switch (prop) {
    case 'scale':
      return 1;
    case 'opacity':
      return record.opacity;
    case 'fill':
    case 'stroke': {
      const value = (record as Record<string, unknown>)[prop];
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
    default:
      return pose[prop] ?? null;
  }
}

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

  // Modo «Grabar»: cada cambio crea o actualiza el keyframe de su pista en el instante `time` (ms), todo en una
  // transacción. Una pista nueva que no empieza en 0 recibe también un keyframe en 0 con el valor de partida. Si
  // `time` cae fuera de la primera iteración de un nodo, se amplía en la misma transacción.
  recordAt(time: number, changes: readonly RecordedChange[]): boolean {
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
        if (change.relative && typeof value === 'number') {
          const base = pose ? poseValue(pose, change.prop) : null;
          value = Math.round(((typeof base === 'number' ? base : 0) + value) * 1000) / 1000;
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
    return this.transact((w) => {
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
  const parsed = KeyframeSchema.safeParse(keyframe);
  if (!parsed.success || (typeof parsed.data.v === 'string') !== COLOR_PROPS.has(prop)) return null;
  return parsed.data;
}
