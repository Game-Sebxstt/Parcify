import type { EditorCore } from '../../EditorCore.ts';
import type { PointerInput } from '../PointerController.ts';
import { TwoFingerTracker, type TwoFingerStep } from './pinch.ts';
import { EMBEDDED_PROFILES, INPUT_PROFILES, type PointerKind } from './profile.ts';

// Velocidad del punto medio (px/ms) por encima de la cual la cámara sigue sola al soltar los dedos.
export const INERTIA_MIN_SPEED = 0.3;
export const INERTIA_STOP_SPEED = 0.02;
// Factor por frame de 60 Hz; con otra frecuencia se escala con el tiempo real entre frames.
export const INERTIA_DECAY = 0.92;
const FRAME_MS = 1000 / 60;
// Un frame perdido no debe lanzar la cámara de golpe.
const MAX_FRAME_GAP_MS = 64;
const LONG_PRESS_VIBRATE_MS = 10;

type Tracked = { x: number; y: number; startX: number; startY: number; kind: PointerKind };

// idle: sin punteros. single: un puntero que manda en el controlador. multi: dos dedos que mueven la cámara.
// swallow: tras un gesto de dos dedos, los que quedan se ignoran hasta que se levantan todos.
type Mode = 'idle' | 'single' | 'multi' | 'swallow';

export type FrameLoop = { request(run: (time: number) => void): number; cancel(handle: number): void };

export type GestureRouterOptions = {
  // Incrustado en una página que se desplaza (la landing): sin dos dedos ni pulsación larga; cada puntero va tal cual
  // al controlador.
  embedded?: boolean;
  // Con movimiento reducido no hay inercia.
  reducedMotion?: () => boolean;
  // Pulsación larga con el dedo o el lápiz en (x, y) del contenedor. Sin ella no se detecta.
  onLongPress?: (input: PointerInput) => void;
  // Confirma la edición de texto en curso.
  stopTextEdit: () => void;
  frames?: FrameLoop;
};

const browserFrames: FrameLoop = {
  request: (run) => requestAnimationFrame(run),
  cancel: (handle) => cancelAnimationFrame(handle),
};

const now = () => performance.now();

// Dueño único de los gestos del lienzo: reparte los punteros entre el controlador (un puntero) y la cámara (dos
// dedos). Un gesto de dos dedos nunca escribe en el documento.
export class GestureRouter {
  // Hay un gesto de Safari en marcha: la rueda con Ctrl que lo acompaña ya no hace zoom.
  gestureActive = false;
  private readonly pointers = new Map<number, Tracked>();
  private mode: Mode = 'idle';
  private primary: number | null = null;
  private pair: [number, number] | null = null;
  private readonly tracker = new TwoFingerTracker();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;
  // Con el dedo, la edición de texto se confirma al soltar o al arrastrar, no al tocar: así un pellizco o un pan con
  // dos dedos no la cierra ni esconde el teclado.
  private textStopPending = false;
  // version: la de la cámara tras el último paso; si cambia por otra vía (encajar, zoom de la UI, seguir a alguien),
  // la inercia se para para no mover la cámara recién colocada.
  private inertia: { vx: number; vy: number; last: number; handle: number; version: number } | null = null;
  private readonly frames: FrameLoop;

  constructor(
    private readonly core: EditorCore,
    private readonly options: GestureRouterOptions,
  ) {
    this.frames = options.frames ?? browserFrames;
  }

  down(input: PointerInput): void {
    this.stopInertia();
    if (this.options.embedded) {
      if (this.core.editingText.get()) this.options.stopTextEdit();
      this.core.inputProfile.set(EMBEDDED_PROFILES[input.pointerType]);
      this.core.controller.pointerDown(input);
      return;
    }
    if (this.mode === 'multi' || this.mode === 'swallow') {
      this.track(input);
      return;
    }
    // El mismo puntero otra vez: se perdió su pointerup (por ejemplo, al soltar fuera de la ventana).
    if (this.mode === 'single' && input.pointerId === this.primary) this.release(input, false);
    if (this.mode === 'single') {
      const first = this.primary === null ? undefined : this.pointers.get(this.primary);
      if (first?.kind === 'touch' && input.pointerType === 'touch' && !this.longPressFired) this.startMulti(input);
      return;
    }
    this.track(input);
    this.mode = 'single';
    this.primary = input.pointerId;
    this.longPressFired = false;
    const profile = INPUT_PROFILES[input.pointerType];
    this.core.inputProfile.set(profile);
    if (this.core.editingText.get()) {
      if (input.pointerType === 'touch') this.textStopPending = true;
      else this.options.stopTextEdit();
    }
    this.core.controller.pointerDown(input);
    // Solo sobre un nodo, en vacío o en un vértice de línea (su menú ofrece «Eliminar punto»): detenerse sobre un
    // tirador antes de girar o redimensionar, o al empezar a crear una forma, no abre el menú.
    const press = this.core.controller.pressKind;
    if (profile.longPressMs !== null && this.options.onLongPress && input.button === 0 && (press === 'node' || press === 'empty' || press === 'point')) {
      const ms = profile.longPressMs;
      this.longPressTimer = setTimeout(() => this.fireLongPress(input.pointerId), ms);
    }
  }

  move(input: PointerInput): void {
    if (this.options.embedded) {
      this.core.controller.pointerMove(input);
      return;
    }
    const tracked = this.pointers.get(input.pointerId);
    if (!tracked) {
      // Hover: solo cuenta sin otro gesto en marcha.
      if (this.mode !== 'idle') return;
      this.core.inputProfile.set(INPUT_PROFILES[input.pointerType]);
      this.core.controller.pointerMove(input);
      return;
    }
    tracked.x = input.x;
    tracked.y = input.y;
    if (this.mode === 'single') {
      if (input.pointerId !== this.primary || this.longPressFired) return;
      const profile = INPUT_PROFILES[tracked.kind];
      const distance = Math.hypot(input.x - tracked.startX, input.y - tracked.startY);
      if (this.longPressTimer !== null && distance > profile.longPressSlop) this.clearLongPress();
      if (this.textStopPending && distance > profile.dragThreshold) {
        this.textStopPending = false;
        this.options.stopTextEdit();
      }
      this.core.controller.pointerMove(input);
      return;
    }
    if (this.mode === 'multi' && this.pair?.includes(input.pointerId)) {
      const a = this.pointers.get(this.pair[0]);
      const b = this.pointers.get(this.pair[1]);
      if (a && b) this.moveCamera(this.tracker.move(a, b));
    }
  }

  up(input: PointerInput): void {
    if (this.options.embedded) {
      this.core.controller.pointerUp(input);
      return;
    }
    this.release(input, true);
  }

  cancel(input: PointerInput): void {
    if (this.options.embedded) {
      this.core.controller.cancel();
      return;
    }
    this.release(input, false);
  }

  // El puntero sale del lienzo sin botones pulsados: fuera no hay hover.
  leave(buttons: number): void {
    if (buttons === 0 && this.mode === 'idle') this.core.controller.pointerLeave();
  }

  stopInertia(): void {
    if (!this.inertia) return;
    this.frames.cancel(this.inertia.handle);
    this.inertia = null;
  }

  // Al perder la ventana el foco puede no llegar el pointerup: se olvidan los punteros para que el siguiente toque no
  // cuente como segundo dedo.
  reset(): void {
    this.clearLongPress();
    this.stopInertia();
    this.pointers.clear();
    this.mode = 'idle';
    this.primary = null;
    this.pair = null;
    this.longPressFired = false;
    this.textStopPending = false;
  }

  private track(input: PointerInput): void {
    this.pointers.set(input.pointerId, { x: input.x, y: input.y, startX: input.x, startY: input.y, kind: input.pointerType });
  }

  private release(input: PointerInput, lifted: boolean): void {
    if (!this.pointers.delete(input.pointerId)) return;
    if (this.mode === 'single') {
      if (input.pointerId !== this.primary) return;
      this.clearLongPress();
      const fired = this.longPressFired;
      const stopText = this.textStopPending;
      this.mode = 'idle';
      this.primary = null;
      this.longPressFired = false;
      this.textStopPending = false;
      // Tras la pulsación larga el menú ya está abierto: soltar no es un clic.
      if (fired) return;
      if (lifted && stopText) this.options.stopTextEdit();
      if (lifted) this.core.controller.pointerUp(input);
      else this.core.controller.cancel();
      return;
    }
    if (this.mode === 'multi' && this.pair?.includes(input.pointerId)) {
      this.pair = null;
      this.startInertia();
      this.mode = this.pointers.size > 0 ? 'swallow' : 'idle';
      return;
    }
    if (this.pointers.size === 0) this.mode = 'idle';
  }

  // Al entrar el segundo dedo, lo que hacía el primero se anula sin escribir nada y empieza el gesto de cámara.
  private startMulti(input: PointerInput): void {
    const first = this.primary === null ? undefined : this.pointers.get(this.primary);
    if (!first || this.primary === null) return;
    this.clearLongPress();
    this.textStopPending = false;
    if (this.core.controller.state !== 'idle') this.core.controller.cancel();
    this.track(input);
    this.pair = [this.primary, input.pointerId];
    this.primary = null;
    this.tracker.start(first, input);
    this.mode = 'multi';
  }

  private moveCamera(step: TwoFingerStep): void {
    if (step.state === 'unknown') return;
    this.core.stopFollowing();
    this.core.markUserCamera();
    // Primero el pan y después el zoom en el punto medio: lo que había bajo los dedos sigue bajo ellos.
    this.core.camera.panBy(step.pan.x, step.pan.y);
    if (step.zoomFactor !== 1) this.core.camera.zoomAt(step.center.x, step.center.y, step.zoomFactor);
    this.core.requestFrame();
  }

  private fireLongPress(pointerId: number): void {
    this.longPressTimer = null;
    const tracked = this.pointers.get(pointerId);
    if (this.mode !== 'single' || this.primary !== pointerId || !tracked) return;
    const onLongPress = this.options.onLongPress;
    if (!onLongPress) return;
    this.longPressFired = true;
    this.textStopPending = false;
    if (this.core.editingText.get()) this.options.stopTextEdit();
    this.core.controller.cancel();
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(LONG_PRESS_VIBRATE_MS);
    onLongPress({ x: tracked.x, y: tracked.y, button: 0, shift: false, alt: false, ctrl: false, pointerId, pointerType: tracked.kind, pressure: 0 });
  }

  private clearLongPress(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private startInertia(): void {
    if (this.tracker.state === 'unknown' || this.options.reducedMotion?.()) return;
    const velocity = this.tracker.velocity(now());
    if (Math.hypot(velocity.x, velocity.y) <= INERTIA_MIN_SPEED) return;
    this.stopInertia();
    const version = this.core.camera.version;
    this.inertia = { vx: velocity.x, vy: velocity.y, last: now(), handle: this.frames.request(this.stepInertia), version };
  }

  private readonly stepInertia = (time: number): void => {
    const inertia = this.inertia;
    if (!inertia) return;
    if (this.core.camera.version !== inertia.version || this.core.following.get() !== null) {
      this.inertia = null;
      return;
    }
    const dt = Math.min(MAX_FRAME_GAP_MS, Math.max(0, time - inertia.last));
    inertia.last = Math.max(inertia.last, time);
    this.core.markUserCamera();
    this.core.camera.panBy(inertia.vx * dt, inertia.vy * dt);
    inertia.version = this.core.camera.version;
    this.core.requestFrame();
    const decay = INERTIA_DECAY ** (dt / FRAME_MS);
    inertia.vx *= decay;
    inertia.vy *= decay;
    if (Math.hypot(inertia.vx, inertia.vy) < INERTIA_STOP_SPEED) {
      this.inertia = null;
      return;
    }
    inertia.handle = this.frames.request(this.stepInertia);
  };
}
