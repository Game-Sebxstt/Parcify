import type { Animation } from '../shared/document/schema.js';
import type { AnimationState } from './anim/AnimationPlayer.ts';
import type { AssetResolver } from './assets/AssetResolver.ts';
import { AnimationCommands } from './commands/animation.ts';
import type { Commands, NotAnimatedKey } from './commands/Commands.ts';
import type { Pose } from './anim/timeline.ts';
import { EditorCore, type ActiveVertex, type EngineUser, type FrameStats, type RecordedNotice, type TextEditing, type Tool } from './EditorCore.ts';
import { ClipboardController, type ClipboardSource } from './interaction/clipboard.ts';
import { bindDom, type ContextMenuRequest } from './interaction/dom.ts';
import type { CameraState, ViewInsets } from './render/Camera.ts';
import { Renderer, type ContextState } from './render/Renderer.ts';
import type { PageRecord } from './model/DocumentStore.ts';
import type { DocumentBackend } from './doc/backend.ts';
import type { Readable } from './store.ts';
import type { WheelPreference } from './interaction/input/wheel.ts';
import type { InputProfile } from './interaction/input/profile.ts';
import { TextEditor } from './text/TextEditor.ts';
import type { NodeRecord } from './types.ts';

export type { Tool, EngineUser, FrameStats, TextEditing, UiCommand, UiCommandName, ScreenRect, Hud, ActiveVertex, RecordedNotice, TouchModifiers } from './EditorCore.ts';
export type { Pose } from './anim/timeline.ts';
export { DirectBackend, LinkBackend, type DocumentBackend } from './doc/backend.ts';
export type { NodeRecord } from './types.ts';
export type { PageRecord } from './model/DocumentStore.ts';
export { FRAME_PRESETS, type FramePresetId } from './commands/defaults.ts';
export type { AnimationState, AnimationStatus } from './anim/AnimationPlayer.ts';
export {
  DEFAULT_ANIMATION,
  DUPLICATE_GAP_MS,
  SAME_TIME,
  STRETCH_FACTOR,
  clampAnimValue,
  keyframeKeyAt,
  keyframeMs,
  keyframeTime,
  poseValue,
  restValue,
  type AnimationCommands,
  type KeyframeClip,
  type KeyframeInput,
  type KeyframePasteResult,
  type KeyRef,
  type RecordedChange,
} from './commands/animation.ts';
export { ANIMATION_PRESETS, PRESETS, type AnimationPresetId } from './anim/presets.ts';
export { EASING_CURVES, easingFn } from './anim/easing.ts';
export { compileAnimation, effectiveDuration, poseAtProgress, COLOR_PROPS } from './anim/timeline.ts';
export type { StylePatch, StyleEach, InsertableImage, GeometryPatch, Geometry, AlignMode, FlipAxis, NotAnimatedKey, Recorder } from './commands/Commands.ts';
export { textSizeMode, type TextSizeMode } from './text/resize.ts';
export { AssetResolver } from './assets/AssetResolver.ts';
export { LOCAL_ORIGIN, AI_ORIGIN } from './origins.ts';
export { AI_PREVIEW_COLOR } from './ai/preview.ts';
export type { ClipboardSource } from './interaction/clipboard.ts';
export { OWN_WHEEL_ATTR, type ContextMenuRequest } from './interaction/dom.ts';
export { classifyWheel, type WheelPreference } from './interaction/input/wheel.ts';
export { TwoFingerTracker } from './interaction/input/pinch.ts';
export type { InputProfile, PointerKind } from './interaction/input/profile.ts';
export type { ViewInsets } from './render/Camera.ts';
export { RendererUnavailableError, type ContextState } from './render/Renderer.ts';

export type EngineOptions = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  // Documento de la generación actual: createEngine espera a que tenga su primer lote.
  backend: DocumentBackend;
  // Resuelve assetId → URLs firmadas (§9.5), en lotes.
  assets?: AssetResolver | null;
  // Archivos soltados sobre el lienzo, con el punto de la página donde cayeron.
  onDropFiles?: (files: File[], at: { x: number; y: number }) => void;
  user: EngineUser;
  permissions: { canEdit: boolean };
  locale?: string;
  pageId?: string;
  camera?: CameraState;
  renderer?: 'webgl' | 'webgpu';
  onFatal?: () => void;
  // Incrustado (la landing, la vista previa de versiones): el teclado y el portapapeles solo actúan con el foco dentro.
  embedded?: boolean;
  // 'page' (la landing): la rueda sin Ctrl/⌘ desplaza la página. Por defecto 'canvas'.
  wheel?: 'canvas' | 'page';
  // Preferencia de la rueda del ratón; se consulta en cada evento. Sin ella, la rueda desplaza.
  wheelPref?: () => WheelPreference;
  // Movimiento reducido; se consulta al soltar cada gesto. Sin ella, solo cuenta la preferencia del sistema.
  reducedMotion?: () => boolean;
  // Nombre accesible del editor de texto.
  labels?: { textEditor: string };
  // Origen de lo que se copia y copia de imágenes entre espacios (POST /v1/assets/copy).
  clipboard?: { source: ClipboardSource | null; copyAssets?: (ids: string[]) => Promise<Record<string, string>> };
  // Clic derecho, tecla de menú o pulsación larga sobre el lienzo.
  onContextMenu?: (request: ContextMenuRequest) => void;
};

export type EngineState = {
  tool: Readable<Tool>;
  toolLocked: Readable<boolean>;
  selection: Readable<readonly string[]>;
  selectionRecords: Readable<readonly NodeRecord[]>;
  readOnly: Readable<boolean>;
  zoom: Readable<number>;
  history: Readable<{ canUndo: boolean; canRedo: boolean }>;
  pageId: Readable<string | null>;
  nodeCount: Readable<number>;
  editingText: Readable<TextEditing | null>;
  pages: Readable<readonly PageRecord[]>;
  layersVersion: Readable<number>;
  following: Readable<number | null>;
  // Vértice marcado de la línea o el conector seleccionado (Supr o «Eliminar punto» lo quitan).
  activeVertex: Readable<ActiveVertex | null>;
  // La línea o el conector seleccionado no admite más puntos.
  pointLimit: Readable<boolean>;
  // Puntos fijados de la línea que dibuja la Pluma (0 sin línea en curso).
  penPoints: Readable<number>;
};

// Reproducción local de las animaciones de la página activa (tiempos en ms) y comandos de keyframes.
export type EngineAnimation = {
  play(): void;
  pause(): void;
  seek(time: number): void;
  stop(): void;
  setSpeed(speed: number): void;
  // Al llegar al final vuelve a empezar.
  setRepeat(repeat: boolean): void;
  // Grabación con la línea de tiempo abierta y el cabezal en `time` (ms); null la apaga (línea de tiempo cerrada).
  // 'all' (Grabar): todo lo animable crea o actualiza keyframes. 'tracked': solo lo que el nodo ya anima; el resto va
  // al diseño base. Solo se graba al confirmar un cambio.
  record(time: number | null, mode?: 'all' | 'tracked'): void;
  // Pose de un nodo en el instante `time` (ms), o null si no está animado.
  poseAt(id: string, time: number): Pose | null;
  // Un cambio que no se anima fue al diseño base durante la grabación.
  notice: Readable<{ key: NotAnimatedKey; n: number } | null>;
  // Último cambio grabado como keyframes.
  recorded: Readable<RecordedNotice | null>;
  // Modo Presentar: solo reproduce las animaciones que pasan el filtro y mantiene la pose final; null lo apaga.
  present(filter: ((id: string, animation: Animation) => boolean) | null): void;
  // Vista previa en el lienzo de las animaciones de `ids` (página activa), sin la línea de tiempo: al terminar, el
  // lienzo vuelve al estado base. Esc, un clic en el lienzo o null la detienen. false si no hay nada que reproducir.
  preview(ids: readonly string[] | null): boolean;
  state: Readable<AnimationState>;
  // Sube cuando cambian las animaciones del documento.
  version: Readable<number>;
  keyframes: AnimationCommands;
};

export type Engine = {
  commands: Commands;
  anim: EngineAnimation;
  state: EngineState;
  core: EditorCore;
  renderer: Renderer;
  // Estado del contexto WebGL del lienzo: el editor avisa mientras se restaura.
  contextState: Readable<ContextState>;
  // Perfil del puntero en uso (ratón, lápiz o dedo): umbrales, tiradores y lo que depende del hover.
  inputProfile: Readable<Readonly<InputProfile>>;
  setReadOnly(readOnly: boolean): void;
  clipboard: ClipboardController;
  // asset.ready: el servidor terminó de procesar el asset; las imágenes que no cargaron lo intentan de nuevo.
  assetReady(assetId: string): void;
  // asset.deleted (o borrado desde la galería): sus imágenes pasan al marcador de imagen rota.
  assetDeleted(assetId: string): void;
  // «Seguir a» un colaborador por su clientId de Awareness; null deja de seguir.
  follow(clientId: number | null): void;
  // Centro de la vista en coordenadas de la página (donde se insertan las imágenes de la barra).
  viewCenter(): { x: number; y: number };
  // Lo que tapan los paneles flotantes: los encuadres y el centro de la vista usan el resto del lienzo.
  setViewInsets(insets: ViewInsets): void;
  camera(): CameraState;
  onFrame(listener: (stats: FrameStats) => void): () => void;
  destroy(): void;
};

export async function createEngine(options: EngineOptions): Promise<Engine> {
  const assets = options.assets ?? null;
  const ready = options.backend.ready.then(
    () => null,
    (error: unknown) => error,
  );
  const renderer = await Renderer.create({
    canvas: options.canvas,
    container: options.container,
    preference: options.renderer ?? preferredRenderer(),
    ...(assets ? { images: { url: (id, variant) => assets.url(id, variant), invalidate: (id, variant) => assets.invalidate(id, variant) } } : {}),
    ...(options.onFatal ? { onContextFailed: options.onFatal } : {}),
  });
  const failed = await ready;
  if (failed !== null) {
    renderer.destroy();
    throw failed;
  }
  const core = new EditorCore({
    backend: options.backend,
    sink: renderer,
    user: options.user,
    readOnly: !options.permissions.canEdit,
    screen: renderer.screenSize,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    ...(options.pageId ? { pageId: options.pageId } : {}),
    ...(options.camera ? { camera: options.camera } : {}),
  });
  // Antes del primer frame pageBounds() aún no conoce la página: el encuadre lo hace el frame.
  if (!options.camera) core.fitWhenReady();
  renderer.onNeedsRender = () => core.invalidate();
  renderer.onNeedsFrame = () => core.requestFrame();
  const textEditor = new TextEditor(core, options.container, { label: options.labels?.textEditor ?? 'Texto' });
  const clipboard = new ClipboardController(core, {
    source: options.clipboard?.source ?? null,
    ...(options.clipboard?.copyAssets ? { copyAssets: options.clipboard.copyAssets } : {}),
    ...(options.onDropFiles ? { insertFiles: options.onDropFiles } : {}),
  });
  const unbind = bindDom(core, options.container, clipboard, {
    embedded: options.embedded ?? false,
    wheel: options.wheel ?? 'canvas',
    ...(options.wheelPref ? { wheelPref: options.wheelPref } : {}),
    reducedMotion: options.reducedMotion ?? systemReducedMotion,
    ...(options.onDropFiles ? { onDropFiles: options.onDropFiles } : {}),
    ...(options.onContextMenu ? { onContextMenu: options.onContextMenu } : {}),
  });
  const unresize = observeRenderer(renderer, options.container, core);

  let destroyed = false;
  const keyframes = new AnimationCommands(core);
  return {
    commands: core.commands,
    anim: {
      play: () => core.anim.play(),
      pause: () => core.anim.pause(),
      seek: (time) => core.anim.seek(time),
      stop: () => core.anim.stop(),
      setSpeed: (speed) => core.anim.setSpeed(speed),
      setRepeat: (repeat) => core.anim.setRepeat(repeat),
      record: (time, mode = 'all') => {
        if (time === null) {
          core.commands.recorder = null;
          return;
        }
        core.commands.recorder = {
          time,
          mode,
          write: (changes, options) => {
            if (!keyframes.recordAt(time, changes, options)) return;
            const props = [...new Set(changes.map((change) => change.prop))];
            core.recorded.set({ props, time, mode, n: (core.recorded.get()?.n ?? 0) + 1 });
          },
        };
      },
      poseAt: (id, time) => core.anim.poseAt(id, time),
      notice: core.notice.readonly(),
      recorded: core.recorded.readonly(),
      present: (filter) => core.anim.present(filter),
      preview: (ids) => core.anim.preview(ids),
      state: core.anim.state.readonly(),
      version: core.animationsVersion.readonly(),
      keyframes,
    },
    clipboard,
    core,
    renderer,
    contextState: renderer.contextState.readonly(),
    inputProfile: core.inputProfile.readonly(),
    state: {
      tool: core.tool.readonly(),
      toolLocked: core.toolLocked.readonly(),
      selection: core.selection.readonly(),
      selectionRecords: core.selectionRecords.readonly(),
      readOnly: core.readOnly.readonly(),
      zoom: core.zoom.readonly(),
      history: core.historyState.readonly(),
      pageId: core.pageId.readonly(),
      nodeCount: core.nodeCount.readonly(),
      editingText: core.editingText.readonly(),
      pages: core.pages.readonly(),
      layersVersion: core.layersVersion.readonly(),
      following: core.following.readonly(),
      activeVertex: core.activeVertex.readonly(),
      pointLimit: core.pointLimit.readonly(),
      penPoints: core.penPoints.readonly(),
    },
    setReadOnly: (readOnly) => core.setReadOnly(readOnly),
    assetReady: (assetId) => {
      assets?.invalidate(assetId);
      renderer.assetReady(assetId);
    },
    assetDeleted: (assetId) => {
      assets?.invalidate(assetId);
      renderer.assetDeleted(assetId);
    },
    follow: (clientId) => core.follow(clientId),
    viewCenter: () => core.viewCenter(),
    setViewInsets: (insets) => core.setViewInsets(insets),
    camera: () => core.camera.state(),
    onFrame: (listener) => core.onFrame(listener),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clipboard.destroy();
      textEditor.destroy();
      unbind();
      unresize();
      core.destroy();
      renderer.destroy();
    },
  };
}

function systemReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// WebGL2 por defecto; ?renderer=webgpu permite probar WebGPU.
function preferredRenderer(): 'webgl' | 'webgpu' {
  if (typeof location === 'undefined') return 'webgl';
  return new URLSearchParams(location.search).get('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
}

// El canvas y la cámara siguen al contenedor. Se compara con los dos cada vez (no solo con el canvas), porque si uno
// se queda atrás el encuadre, el culling y Presentar trabajan con un tamaño que no es el de la pantalla.
function observeRenderer(renderer: Renderer, container: HTMLElement, core: EditorCore): () => void {
  const check = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    // Un canvas de 0 px deja a Pixi sin búfer de dibujo: se queda en 1 px y la cámara sabe que no hay sitio.
    const resized = renderer.resize(Math.max(1, width), Math.max(1, height));
    if (core.camera.width !== width || core.camera.height !== height) core.resize(width, height);
    if (resized) core.invalidate();
  };
  check();
  const observer = new ResizeObserver(check);
  observer.observe(container);
  // Al entrar o salir de pantalla completa y con el zoom del teclado virtual, el ResizeObserver puede no llegar.
  document.addEventListener('fullscreenchange', check);
  window.visualViewport?.addEventListener('resize', check);
  return () => {
    observer.disconnect();
    document.removeEventListener('fullscreenchange', check);
    window.visualViewport?.removeEventListener('resize', check);
  };
}
