import type { Animation } from '../shared/document/schema.js';
import type { AnimationState } from './anim/AnimationPlayer.ts';
import type { AssetResolver } from './assets/AssetResolver.ts';
import { AnimationCommands } from './commands/animation.ts';
import type { Commands } from './commands/Commands.ts';
import { EditorCore, type EngineUser, type FrameStats, type TextEditing, type Tool } from './EditorCore.ts';
import { ClipboardController, type ClipboardSource } from './interaction/clipboard.ts';
import { bindDom, type ContextMenuRequest } from './interaction/dom.ts';
import type { CameraState } from './render/Camera.ts';
import { Renderer } from './render/Renderer.ts';
import type { PageRecord } from './model/DocumentStore.ts';
import type { DocumentBackend } from './doc/backend.ts';
import type { Readable } from './store.ts';
import { TextEditor } from './text/TextEditor.ts';
import type { NodeRecord } from './types.ts';

export type { Tool, EngineUser, FrameStats, TextEditing } from './EditorCore.ts';
export { DirectBackend, LinkBackend, type DocumentBackend } from './doc/backend.ts';
export type { NodeRecord } from './types.ts';
export type { PageRecord } from './model/DocumentStore.ts';
export { FRAME_PRESETS, type FramePresetId } from './commands/defaults.ts';
export type { AnimationState, AnimationStatus } from './anim/AnimationPlayer.ts';
export { DEFAULT_ANIMATION, keyframeTime, poseValue, restValue, type AnimationCommands, type KeyframeInput, type RecordedChange } from './commands/animation.ts';
export { EASING_CURVES, easingFn } from './anim/easing.ts';
export { compileAnimation, effectiveDuration, poseAtProgress, COLOR_PROPS } from './anim/timeline.ts';
export type { StylePatch, InsertableImage } from './commands/Commands.ts';
export { AssetResolver } from './assets/AssetResolver.ts';
export { LOCAL_ORIGIN, AI_ORIGIN } from './origins.ts';
export { AI_PREVIEW_COLOR } from './ai/preview.ts';
export type { ClipboardSource } from './interaction/clipboard.ts';
export type { ContextMenuRequest } from './interaction/dom.ts';

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
  // En una página (la landing): la rueda desplaza la página y el teclado solo actúa con el foco en el lienzo.
  embedded?: boolean;
  // Nombre accesible del editor de texto.
  labels?: { textEditor: string };
  // Origen de lo que se copia y copia de imágenes entre espacios (POST /v1/assets/copy).
  clipboard?: { source: ClipboardSource | null; copyAssets?: (ids: string[]) => Promise<Record<string, string>> };
  // Clic derecho o tecla de menú sobre el lienzo.
  onContextMenu?: (request: ContextMenuRequest) => void;
};

export type EngineState = {
  tool: Readable<Tool>;
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
  // Modo «Grabar» en el instante `time` (ms); null lo apaga.
  record(time: number | null): void;
  // Modo Presentar: solo reproduce las animaciones que pasan el filtro y mantiene la pose final; null lo apaga.
  present(filter: ((id: string, animation: Animation) => boolean) | null): void;
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
  if (!options.camera) core.fitAll();
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
      record: (time) => {
        core.commands.recorder = time === null ? null : (changes) => void keyframes.recordAt(time, changes);
      },
      present: (filter) => core.anim.present(filter),
      state: core.anim.state.readonly(),
      version: core.animationsVersion.readonly(),
      keyframes,
    },
    clipboard,
    core,
    renderer,
    state: {
      tool: core.tool.readonly(),
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

// WebGL2 por defecto; ?renderer=webgpu permite probar WebGPU.
function preferredRenderer(): 'webgl' | 'webgpu' {
  if (typeof location === 'undefined') return 'webgl';
  return new URLSearchParams(location.search).get('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
}

// El ResizePlugin de Pixi solo escucha la ventana: un cambio de tamaño del contenedor también tiene que llegar.
function observeRenderer(renderer: Renderer, container: HTMLElement, core: EditorCore): () => void {
  const observer = new ResizeObserver(() => {
    if (!renderer.resize()) return;
    const { width, height } = renderer.screenSize;
    core.resize(width, height);
  });
  observer.observe(container);
  return () => observer.disconnect();
}
