import * as Y from 'yjs';
import { AssetResolver, createEngine, LinkBackend, type Engine, type FrameStats } from '../src/engine/index.ts';
import type { BenchMessage, BenchReply } from './bench.worker.ts';
import { generateBenchDoc } from './fixtures/generate.ts';
import { imageFile } from './fixtures/random.ts';

// Las 200 imÃƒÂ¡genes versionadas, servidas como recursos del propio build: el benchmark no usa la red ni el servidor.
const IMAGE_URLS = import.meta.glob('./fixtures/images/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
// Sin GPU y con la CPU limitada las miniaturas tardan mucho mÃƒÂ¡s: se esperan para que no se mezclen con los gestos.
const THUMB_TIMEOUT_MS = 90_000;

export type Percentiles = { count: number; p50: number; p95: number; p99: number; max: number };

export type ScenarioResult = {
  scenario: string;
  frame: Percentiles;
  work: Percentiles;
  render: Percentiles;
  longTasks: number;
  // Porcentaje de frames perdidos (delta > 25 ms).
  droppedPct?: number;
  drawCallsMax: number;
  idleRenders: number;
  // Frames del planificador con el lienzo quieto, haya o no render.
  idleFrames: number;
  // Coste de cada evento de entrada sintÃƒÂ©tico.
  input?: Percentiles;
  // p95 de cada fase del frame (ms).
  phases?: Record<string, number>;
  extra?: Record<string, number>;
};

export type BenchInfo = { renderer: string; nodes: number; dpr: number; width: number; height: number; userAgent: string; idleCauses: string[]; resizes: number };

const WARMUP_MS = 2_000;
const DURATION_MS = 10_000;
const INPUT_HZ = 120;

function percentiles(values: number[]): Percentiles {
  if (!values.length) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1)!) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// El documento vive en un worker, como en el editor: el benchmark mide lo que paga el hilo principal.
class BenchWorker {
  readonly worker = new Worker(new URL('./bench.worker.ts', import.meta.url), { type: 'module' });
  readonly backend = new LinkBackend(1, (message) => this.send(message));
  readonly booted: Promise<void>;
  private statsWaiter: ((stats: Extract<BenchReply, { t: 'bench-stats' }>) => void) | null = null;

  constructor() {
    this.booted = new Promise((resolve) => {
      this.worker.addEventListener('message', (event: MessageEvent<BenchReply>) => {
        const started = performance.now();
        const message = event.data;
        const readMs = performance.now() - started;
        if (message.t === 'booted') resolve();
        else if (message.t === 'batch') this.backend.receive(message, readMs);
        else if (message.t === 'pong') this.backend.receivePong();
        else if (message.t === 'bench-stats') this.statsWaiter?.(message);
      });
    });
  }

  send(message: BenchMessage, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, { transfer });
  }

  stopBurst(): Promise<Extract<BenchReply, { t: 'bench-stats' }>> {
    return new Promise((resolve) => {
      this.statsWaiter = resolve;
      this.send({ t: 'stop-burst' });
    });
  }
}

class Bench {
  private engine!: Engine;
  private readonly host = new BenchWorker();
  private readonly fixture = generateBenchDoc();
  private readonly assets = new AssetResolver(async (ids, variant) => {
    const byAsset = new Map(this.fixture.images.map((image) => [image.assetId, image.image]));
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const result: Record<string, { url: string; expiresAt: string }> = {};
    for (const id of ids) {
      const index = byAsset.get(id);
      const url = index === undefined ? undefined : IMAGE_URLS[`./fixtures/images/${imageFile(index, variant)}`];
      if (url) result[id] = { url, expiresAt };
    }
    return result;
  });
  private readonly container: HTMLElement;
  private drawCalls = 0;
  private loaded = false;
  readonly ready: Promise<void>;

  constructor() {
    this.container = document.getElementById('bench-stage')!;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const canvas = this.container.querySelector('canvas')!;
    await this.host.booted;
    this.engine = await createEngine({
      canvas,
      container: this.container,
      backend: this.host.backend,
      user: { id: 'bench', name: 'Bench', color: '#FB8F5A', avatarAssetId: null },
      permissions: { canEdit: true },
      assets: this.assets,
    });
    this.countDrawCalls();
    // La ventana del benchmark es visible: el ratÃƒÂ³n real no debe mezclarse con los gestos sintÃƒÂ©ticos.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      this.container.addEventListener(type, (event) => event.isTrusted && event.stopImmediatePropagation(), { capture: true });
    }
  }

  // Cuenta las llamadas de dibujo de WebGL; solo existe en esta pÃƒÂ¡gina.
  private countDrawCalls(): void {
    const renderer = this.engine.renderer.app.renderer as unknown as { gl?: WebGL2RenderingContext };
    const gl = renderer.gl;
    if (!gl) return;
    const wrap = <K extends 'drawElements' | 'drawArrays' | 'drawElementsInstanced' | 'drawArraysInstanced'>(name: K) => {
      const original = gl[name].bind(gl) as (...args: unknown[]) => void;
      (gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        this.drawCalls++;
        original(...args);
      };
    };
    wrap('drawElements');
    wrap('drawArrays');
    wrap('drawElementsInstanced');
    wrap('drawArraysInstanced');
  }

  info(): BenchInfo {
    const { width, height } = this.engine.renderer.screenSize;
    return {
      renderer: this.engine.renderer.rendererName,
      nodes: this.engine.state.nodeCount.get(),
      dpr: window.devicePixelRatio,
      width,
      height,
      userAgent: navigator.userAgent,
      idleCauses: this.idleCauses,
      resizes: this.engine.renderer.resizes,
    };
  }

  private async open(): Promise<ScenarioResult> {
    const state = Y.encodeStateAsUpdate(this.fixture.doc);
    const work: number[] = [];
    let openMs = 0;
    let openStarted = 0;
    const done = new Promise<void>((resolve) => {
      const started = performance.now();
      const off = this.engine.onFrame((stats) => {
        work.push(stats.work);
        if (this.engine.state.nodeCount.get() >= this.fixture.ids.length) {
          openMs = performance.now() - started;
          off();
          resolve();
        }
      });
      openStarted = started;
      this.host.send({ t: 'bench-load', state }, [state.buffer]);
    });
    await done;
    this.loaded = true;
    this.engine.commands.fitAll();
    // Hasta que todas las imÃƒÂ¡genes (todas visibles al encajar) pintan al menos su miniatura.
    const thumbMs = await this.untilImagesReady(openStarted);
    await sleep(500);
    const idle = await this.idleRenders();
    const textures = this.engine.renderer.textures;
    return {
      scenario: 'open',
      frame: percentiles([openMs]),
      work: percentiles(work),
      render: percentiles([]),
      longTasks: 0,
      drawCallsMax: 0,
      ...idle,
      extra: { openMs: Math.round(openMs), thumbMs: Math.round(thumbMs), textureMB: Math.round(textures.bytes / 1024 / 102.4) / 10, loads: textures.counters.loads },
    };
  }

  private untilImagesReady(started: number): Promise<number> {
    const textures = this.engine.renderer.textures;
    const ids = this.fixture.images.map((image) => image.id);
    return new Promise((resolve) => {
      const check = () => {
        const elapsed = performance.now() - started;
        if (ids.every((id) => textures.stateFor(id).kind === 'ready') || elapsed > THUMB_TIMEOUT_MS) {
          resolve(elapsed);
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  // Renders en 2 s con el lienzo quieto (tras 1 s para que termine lo pendiente).
  // Si hay renders, guarda quiÃƒÂ©n pidiÃƒÂ³ el frame para poder corregirlo.
  idleCauses: string[] = [];

  private async idleRenders(): Promise<{ idleRenders: number; idleFrames: number }> {
    await sleep(1_000);
    let renders = 0;
    const core = this.engine.core;
    const framesBefore = core.scheduler.frames;
    const original = core.requestFrame.bind(core);
    core.requestFrame = () => {
      if (this.idleCauses.length < 5) this.idleCauses.push((new Error().stack ?? '').split('\n').slice(2, 7).map((l) => l.trim()).join(' < '));
      original();
    };
    const off = this.engine.onFrame(() => renders++);
    await sleep(2_000);
    off();
    core.requestFrame = original;
    return { idleRenders: renders, idleFrames: core.scheduler.frames - framesBefore };
  }

  async run(name: string, options: { warmupMs?: number; durationMs?: number } = {}): Promise<ScenarioResult> {
    await this.ready;
    if (name === 'open') return this.open();
    if (!this.loaded) await this.open();
    const warmup = options.warmupMs ?? WARMUP_MS;
    const duration = options.durationMs ?? DURATION_MS;
    this.engine.commands.clearSelection();
    this.engine.commands.fitAll();
    await sleep(300);

    const driver = this.driver(name);
    driver.start();
    await sleep(warmup);
    driver.begin?.();
    const measured = await this.measure(duration, driver.isMeasuredFrame);
    driver.stop();
    await sleep(300);
    const idle = await this.idleRenders();
    driver.dispose?.();
    return { scenario: name, ...measured, ...idle, ...(driver.extra ? { extra: driver.extra() } : {}) };
  }

  private async measure(duration: number, isMeasured?: (stats: FrameStats) => boolean) {
    const frames: number[] = [];
    const work: number[] = [];
    const render: number[] = [];
    let drawCallsMax = 0;
    let longTasks = 0;
    const observer = new PerformanceObserver((list) => {
      longTasks += list.getEntries().length;
    });
    try {
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      // Sin soporte de longtask en este navegador.
    }
    this.inputTimes = [];
    const phases: Record<string, number[]> = {};
    const off = this.engine.onFrame((stats) => {
      if (isMeasured && !isMeasured(stats)) return;
      work.push(stats.work);
      render.push(stats.render);
      for (const [name, value] of Object.entries(stats.phases)) (phases[name] ??= []).push(value);
    });
    let last = performance.now();
    let running = true;
    const tick = (now: number) => {
      if (!running) return;
      frames.push(now - last);
      last = now;
      drawCallsMax = Math.max(drawCallsMax, this.drawCalls);
      this.drawCalls = 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame((now) => {
      last = now;
      this.drawCalls = 0;
      requestAnimationFrame(tick);
    });
    await sleep(duration);
    running = false;
    off();
    observer.disconnect();
    const phaseP95 = Object.fromEntries(Object.entries(phases).map(([name, values]) => [name, percentiles(values).p95]));
    // Un delta de mÃƒÂ¡s de 25 ms en una pantalla de 60 Hz es un frame perdido.
    const dropped = frames.length ? Math.round((frames.filter((delta) => delta > 25).length / frames.length) * 1000) / 10 : 0;
    return { frame: percentiles(frames), work: percentiles(work), render: percentiles(render), longTasks, drawCallsMax, droppedPct: dropped, phases: phaseP95, input: percentiles(this.inputTimes) };
  }

  // Tiempo de cada evento sintÃƒÂ©tico, del despacho a la vuelta (incluye los listeners del motor).
  private inputTimes: number[] = [];

  private dispatchPointer(type: string, x: number, y: number, buttons: number): void {
    const started = performance.now();
    const rect = this.container.getBoundingClientRect();
    this.container.dispatchEvent(
      new PointerEvent(type, { clientX: rect.left + x, clientY: rect.top + y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', bubbles: true }),
    );
    this.inputTimes.push(performance.now() - started);
  }

  private dispatchWheel(x: number, y: number, deltaX: number, deltaY: number, ctrlKey: boolean): void {
    const started = performance.now();
    const rect = this.container.getBoundingClientRect();
    this.container.dispatchEvent(new WheelEvent('wheel', { clientX: rect.left + x, clientY: rect.top + y, deltaX, deltaY, ctrlKey, bubbles: true, cancelable: true }));
    this.inputTimes.push(performance.now() - started);
  }

  private driver(name: string): {
    start(): void;
    // Se llama al acabar el calentamiento, justo antes de medir.
    begin?(): void;
    stop(): void;
    // Se llama despuÃƒÂ©s de medir el lienzo quieto.
    dispose?(): void;
    isMeasuredFrame?: (stats: FrameStats) => boolean;
    extra?: () => Record<string, number>;
  } {
    const core = this.engine.core;
    const interval = 1000 / INPUT_HZ;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopTimer = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    // Lienzo quieto: el delta entre rAF solo refleja el refresco de la pantalla y la fluctuaciÃƒÂ³n del temporizador.
    if (name === 'baseline') return { start: () => {}, stop: () => {} };

    // Redibuja la escena completa en cada frame sin cambiar nada visible: mide el coste de GPU de la vista.
    if (name === 'redraw') {
      let sign = 1;
      return {
        start: () => {
          timer = setInterval(() => {
            sign = -sign;
            core.camera.panBy(sign * 0.001, 0);
            core.requestFrame();
          }, interval);
        },
        stop: stopTimer,
      };
    }

    if (name === 'drag-100' || name === 'drag-all') {
      const ids = name === 'drag-all' ? [...this.fixture.ids] : this.fixture.ids.slice(200, 300);
      return {
        start: () => {
          this.engine.commands.select(ids);
          core.frame();
          // Un punto que de verdad toque un nodo seleccionado, para que el gesto sea un arrastre.
          let origin = { x: core.camera.width / 2, y: core.camera.height / 2 };
          for (const id of ids) {
            const box = core.geometryOf(id);
            if (!box) continue;
            const screen = core.worldToScreen((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
            if (core.hitTest(screen.x, screen.y) === id) {
              origin = screen;
              break;
            }
          }
          this.dispatchPointer('pointerdown', origin.x, origin.y, 1);
          const started = performance.now();
          timer = setInterval(() => {
            const t = (performance.now() - started) / 1000;
            this.dispatchPointer('pointermove', origin.x + Math.sin(t * 2) * 220, origin.y + Math.sin(t * 3) * 120, 1);
          }, interval);
        },
        stop: () => {
          stopTimer();
          this.dispatchPointer('pointerup', core.camera.width / 2, core.camera.height / 2, 0);
          this.engine.commands.undo();
        },
      };
    }

    if (name === 'pan-zoom') {
      return {
        start: () => {
          const started = performance.now();
          let step = 0;
          timer = setInterval(() => {
            const t = (performance.now() - started) / 1000;
            step++;
            const cx = core.camera.width / 2 + Math.sin(t) * 300;
            const cy = core.camera.height / 2 + Math.cos(t * 0.7) * 200;
            if (step % 2 === 0) this.dispatchWheel(cx, cy, 0, Math.sin(t * 1.5) * 18, true);
            else this.dispatchWheel(cx, cy, Math.cos(t * 1.1) * 14, Math.sin(t * 0.9) * 10, false);
          }, interval);
        },
        stop: stopTimer,
      };
    }

    // 500 nodos animados sin fin: desplazamiento, giro, escala y opacidad en todos, y relleno en uno de cada cinco.
    if (name === 'anim-500') {
      const ids = this.fixture.ids.slice(0, 500);
      const keyframe = (t: number, v: number | string, e: 'linear' | 'easeInOut' | 'easeOutBack' = 'easeInOut') => ({ t, v, e });
      return {
        start: () => {
          core.writer.transact({ step: 'new' }, (w) => {
            ids.forEach((id, i) => {
              w.ensureAnimation(id, { duration: 2_000, delay: (i % 10) * 50, loop: 0, direction: 'alternate', autoplay: 'none' });
              w.setKeyframe(id, 'offsetY', 'y0', keyframe(0, 0));
              w.setKeyframe(id, 'offsetY', 'y1', keyframe(0.5, -40));
              w.setKeyframe(id, 'offsetY', 'y2', keyframe(1, 0));
              w.setKeyframe(id, 'rotation', 'r0', keyframe(0, 0, 'linear'));
              w.setKeyframe(id, 'rotation', 'r1', keyframe(1, Math.PI / 4, 'linear'));
              w.setKeyframe(id, 'scale', 's0', keyframe(0, 1, 'easeOutBack'));
              w.setKeyframe(id, 'scale', 's1', keyframe(1, 1.3));
              w.setKeyframe(id, 'opacity', 'o0', keyframe(0, 1));
              w.setKeyframe(id, 'opacity', 'o1', keyframe(1, 0.5));
              if (i % 5 === 0) {
                w.setKeyframe(id, 'fill', 'f0', keyframe(0, '#FB8F5AFF'));
                w.setKeyframe(id, 'fill', 'f1', keyframe(1, '#3D7BFFFF'));
              }
            });
          });
          this.engine.anim.play();
        },
        stop: () => this.engine.anim.stop(),
        dispose: () => this.engine.commands.undo(),
        extra: () => ({ animated: ids.length }),
      };
    }

    if (name === 'remote-burst') {
      const ids = this.fixture.ids.slice(500, 600);
      const burst: number[] = [];
      let stats: Extract<BenchReply, { t: 'bench-stats' }> | null = null;
      return {
        // El par remoto vive en el worker: 30 updates por segundo de 100 nodos y un cursor que se mueve a la vez.
        start: () => {
          this.host.send({ t: 'start-burst', ids, seed: 7, view: core.camera.viewport(), local: { ...core.presence.state } });
        },
        // Lo aplicado durante el calentamiento no cuenta en la primera muestra.
        begin: () => {
          burst.length = 0;
          this.host.send({ t: 'burst-begin' });
        },
        stop: () => {
          void this.host.stopBurst().then((result) => {
            stats = result;
          });
        },
        // Trabajo del frame que aplica el lote (incluida su lectura) y lo pinta.
        isMeasuredFrame: (frame) => {
          if (frame.changed === 0) return false;
          burst.push(frame.work);
          return true;
        },
        extra: () => {
          const burstP = percentiles(burst);
          const worker = stats as Extract<BenchReply, { t: 'bench-stats' }> | null;
          return {
            updates: worker?.updates ?? 0,
            workerApplyP50: worker?.applyP50 ?? 0,
            workerApplyP95: worker?.applyP95 ?? 0,
            burstP50: burstP.p50,
            burstP95: burstP.p95,
            burstMax: burstP.max,
          };
        },
      };
    }

    throw new Error(`Escenario desconocido: ${name}`);
  }
}

declare global {
  interface Window {
    __bench?: { ready: Promise<void>; run(name: string, options?: { warmupMs?: number; durationMs?: number }): Promise<ScenarioResult>; info(): BenchInfo };
  }
}

const bench = new Bench();
window.__bench = { ready: bench.ready, run: (name, options) => bench.run(name, options), info: () => bench.info() };
