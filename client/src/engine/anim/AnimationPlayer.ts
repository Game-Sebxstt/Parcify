import type { Animation } from '../../shared/document/schema.js';
import { localMatrix } from '../geometry/bounds.ts';
import { invert, multiply, scaleAround, type Mat } from '../geometry/matrix.ts';
import type { ViewOverride } from '../render/sink.ts';
import { Store } from '../store.ts';
import { isContainer, isRenderable, type NodeRecord, type SceneRecord } from '../types.ts';
import { compileAnimation, poseAt, type CompiledAnimation, type Pose } from './timeline.ts';

export type AnimationStatus = 'stopped' | 'playing' | 'paused';

// time y duration en ms; duration es Infinity si alguna animación se repite sin fin y 0 si no hay ninguna.
export type AnimationState = { status: AnimationStatus; time: number; duration: number };

// Lo que el reproductor necesita del motor. Las vistas se cambian con apply; el documento no se toca.
export interface AnimationHost {
  animations(): Iterable<[string, Animation]>;
  record(id: string): NodeRecord | undefined;
  page(): string | null;
  worldMatrix(record: NodeRecord): Mat;
  parentWorld(id: string): Mat | null;
  descendants(id: string): string[];
  apply(poses: ReadonlyMap<string, ViewOverride>): void;
  // Empieza o termina la reproducción: el motor bloquea o libera la edición de los nodos animados.
  playingChanged(playing: boolean): void;
  keepAlive(active: boolean): void;
  requestFrame(): void;
}

type Entry = { source: Animation; compiled: CompiledAnimation };
// Registro de la vista del último frame, para no redibujar si opacidad y colores siguen igual.
type Painted = { base: NodeRecord; record: SceneRecord; opacity: number | undefined; fill: string | undefined; stroke: string | undefined };

const EMPTY: ReadonlyMap<string, ViewOverride> = new Map();

const isAnimatable = (record: NodeRecord | undefined): record is SceneRecord =>
  !!record && record.type !== 'connector' && (isRenderable(record) || isContainer(record));

// Reproduce localmente las animaciones de la página activa: calcula la pose de cada nodo en el tiempo actual y la
// aplica a su vista como una vista previa con su propia matriz de grupo. Al pausar o parar, las vistas vuelven al
// documento.
export class AnimationPlayer {
  readonly state = new Store<AnimationState>(
    { status: 'stopped', time: 0, duration: 0 },
    (a, b) => a.status === b.status && a.time === b.time && a.duration === b.duration,
  );
  private status: AnimationStatus = 'stopped';
  private time = 0;
  private duration = 0;
  // Tiempo del frame que corresponde a time = 0; null hasta el primer frame tras play o seek.
  private anchor: number | null = null;
  private readonly compiled = new Map<string, Entry>();
  private animated: string[] = [];
  private blocked = new Set<string>();
  private collectPending = true;
  // Hay una pose a la vista fuera de la reproducción (seek en pausa) que se recalcula si cambia el documento.
  private previewing = false;
  private previewDirty = false;
  private ending = false;
  private readonly painted = new Map<string, Painted>();
  // Velocidad de reproducción y si al llegar al final vuelve a empezar.
  private speed = 1;
  private repeat = false;
  // Modo Presentar: solo se reproduce lo que pasa el filtro y, al terminar, la pose final se queda a la vista.
  private only: ((id: string, animation: Animation) => boolean) | null = null;

  constructor(private readonly host: AnimationHost) {}

  present(filter: ((id: string, animation: Animation) => boolean) | null): void {
    this.only = filter;
    this.collectPending = true;
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0 || speed === this.speed) return;
    this.speed = speed;
    this.anchor = null;
  }

  setRepeat(repeat: boolean): void {
    this.repeat = repeat;
  }

  get playing(): boolean {
    return this.status === 'playing';
  }

  // El nodo, o alguno de sus contenedores, se está reproduciendo: no se puede editar.
  blocks(id: string): boolean {
    return this.status === 'playing' && this.blocked.has(id);
  }

  play(): void {
    if (this.status === 'playing') return;
    this.collect();
    if (!this.animated.length) return;
    if (this.time >= this.duration) this.time = 0;
    this.anchor = null;
    this.ending = false;
    this.setStatus('playing');
    this.host.keepAlive(true);
    this.host.requestFrame();
  }

  pause(): void {
    if (this.status === 'stopped') return;
    this.setStatus('paused');
    this.restore();
    this.host.requestFrame();
  }

  stop(): void {
    if (this.status === 'stopped' && !this.previewing) return;
    this.time = 0;
    this.setStatus('stopped');
    this.restore();
    this.host.requestFrame();
  }

  // Lleva el cabezal a `time` (ms). En pausa, las vistas muestran la pose de ese instante.
  seek(time: number): void {
    this.collect();
    const limit = Number.isFinite(this.duration) ? this.duration : Number.MAX_SAFE_INTEGER;
    this.time = Math.min(limit, Math.max(0, Number.isFinite(time) ? time : 0));
    this.anchor = null;
    this.ending = false;
    if (this.status === 'playing') {
      this.publish();
      return;
    }
    this.status = 'paused';
    this.previewing = true;
    this.applyPoses();
    this.publish();
    this.host.requestFrame();
  }

  // Cambiaron registros o animaciones: lo que se reproduce se recalcula en el próximo frame.
  invalidate(animationsChanged: boolean): void {
    if (animationsChanged) this.collectPending = true;
    if (this.previewing) {
      this.previewDirty = true;
      this.host.requestFrame();
    }
  }

  // Un frame del motor (time del requestAnimationFrame).
  frame(now: number): void {
    if (this.status === 'playing') {
      if (this.ending) {
        this.ending = false;
        if (this.only) {
          this.previewing = true;
          this.setStatus('paused');
          return;
        }
        this.setStatus('paused');
        this.restore();
        return;
      }
      if (this.collectPending) this.collect();
      if (this.anchor === null) this.anchor = now - this.time / this.speed;
      this.time = (now - this.anchor) * this.speed;
      if (this.time >= this.duration && this.repeat && this.duration > 0) {
        this.time %= this.duration;
        this.anchor = now - this.time / this.speed;
      } else if (this.time >= this.duration) {
        // El último frame muestra el final; el siguiente devuelve las vistas al documento.
        this.time = this.duration;
        this.ending = true;
      }
      this.applyPoses();
      this.publish();
      return;
    }
    if (this.previewing && this.previewDirty) {
      this.previewDirty = false;
      if (this.collectPending) this.collect();
      this.applyPoses();
    }
  }

  // Pose de un nodo en un instante, sin aplicarla (pruebas y timeline).
  poseAt(id: string, time: number): Pose | null {
    const animation = this.entryFor(id);
    return animation ? poseAt(animation.compiled, time) : null;
  }

  private entryFor(id: string): Entry | null {
    for (const [nodeId, source] of this.host.animations()) {
      if (nodeId !== id) continue;
      const cached = this.compiled.get(id);
      if (cached?.source === source) return cached;
      const entry = { source, compiled: compileAnimation(source) };
      this.compiled.set(id, entry);
      return entry;
    }
    return null;
  }

  private setStatus(status: AnimationStatus): void {
    const was = this.status === 'playing';
    this.status = status;
    if (status !== 'playing') this.host.keepAlive(false);
    if (was !== (status === 'playing')) this.host.playingChanged(status === 'playing');
    this.publish();
  }

  private publish(): void {
    this.state.set({ status: this.status, time: this.time, duration: this.duration });
  }

  // Nodos animados de la página activa, su duración total y lo que no se puede editar mientras se reproducen.
  private collect(): void {
    this.collectPending = false;
    const page = this.host.page();
    const seen = new Set<string>();
    const animated: string[] = [];
    let duration = 0;
    for (const [id, source] of this.host.animations()) {
      const record = this.host.record(id);
      if (!isAnimatable(record) || record.pageId !== page) continue;
      if (this.only && !this.only(id, source)) continue;
      let entry = this.compiled.get(id);
      if (entry?.source !== source) {
        entry = { source, compiled: compileAnimation(source) };
        this.compiled.set(id, entry);
      }
      if (!entry.compiled.tracks.length) continue;
      seen.add(id);
      animated.push(id);
      duration = Math.max(duration, entry.compiled.total);
    }
    for (const id of this.compiled.keys()) if (!seen.has(id)) this.compiled.delete(id);
    this.animated = animated;
    this.duration = duration;
    const blocked = new Set<string>();
    for (const id of animated) {
      blocked.add(id);
      for (const child of this.host.descendants(id)) blocked.add(child);
    }
    const changed = blocked.size !== this.blocked.size || [...blocked].some((id) => !this.blocked.has(id));
    this.blocked = blocked;
    if (changed && this.status === 'playing') this.host.playingChanged(true);
  }

  private applyPoses(): void {
    const poses = new Map<string, ViewOverride>();
    for (const id of this.animated) {
      const record = this.host.record(id);
      const entry = this.compiled.get(id);
      if (!isAnimatable(record) || !entry) continue;
      poses.set(id, this.overrideFor(record, poseAt(entry.compiled, this.time)));
    }
    for (const id of this.painted.keys()) if (!poses.has(id)) this.painted.delete(id);
    this.host.apply(poses);
  }

  // La vista se mueve con la matriz M = W' · W⁻¹ (de la matriz de mundo del documento a la animada), como el grupo
  // de un gesto: si el dibujo no cambia, cada frame solo actualiza esa matriz.
  private overrideFor(record: SceneRecord, pose: Pose): ViewOverride {
    const world = this.host.worldMatrix(record);
    let local = localMatrix(
      pose.dx || pose.dy || pose.rotation ? { ...record, x: record.x + pose.dx, y: record.y + pose.dy, rotation: record.rotation + pose.rotation } : record,
    );
    if (pose.scale !== 1) local = multiply(local, scaleAround(record.w / 2, record.h / 2, pose.scale, pose.scale));
    const parent = this.host.parentWorld(record.id);
    const animatedWorld = parent ? multiply(parent, local) : local;
    const matrix = multiply(animatedWorld, invert(world));
    const view = this.viewRecord(record, pose);
    const redraw = pose.fill !== undefined || pose.stroke !== undefined;
    return { record: view, world: multiply(matrix, world), redraw, gesture: { key: `anim:${record.id}`, matrix } };
  }

  private viewRecord(record: SceneRecord, pose: Pose): SceneRecord {
    if (pose.opacity === undefined && pose.fill === undefined && pose.stroke === undefined) return record;
    const last = this.painted.get(record.id);
    if (last && last.base === record && last.opacity === pose.opacity && last.fill === pose.fill && last.stroke === pose.stroke) return last.record;
    const next = { ...record } as Record<string, unknown>;
    if (pose.opacity !== undefined) next.opacity = pose.opacity;
    if (pose.fill !== undefined && 'fill' in record) next.fill = pose.fill;
    if (pose.stroke !== undefined && 'stroke' in record) next.stroke = pose.stroke;
    const view = next as SceneRecord;
    this.painted.set(record.id, { base: record, record: view, opacity: pose.opacity, fill: pose.fill, stroke: pose.stroke });
    return view;
  }

  private restore(): void {
    this.previewing = false;
    this.previewDirty = false;
    this.painted.clear();
    this.host.apply(EMPTY);
  }

  destroy(): void {
    if (this.status === 'playing') this.host.keepAlive(false);
    this.status = 'stopped';
  }
}
