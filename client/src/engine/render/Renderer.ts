import 'pixi.js/unsafe-eval';
import 'pixi.js/prepare';
import { Application, Container, Graphics, ImageSource, Matrix, RenderTexture, Texture } from 'pixi.js';
import type { AssetVariant } from '../assets/AssetResolver.ts';
import { ImageDecoder } from '../assets/ImageDecoder.ts';
import { defaultBudget, TextureManager, type LoadedTexture } from '../assets/TextureManager.ts';
import type { Mat } from '../geometry/matrix.ts';
import { OverlayLayer } from '../overlay/OverlayLayer.ts';
import { RemoteLayer } from '../overlay/RemoteLayer.ts';
import { Store } from '../store.ts';
import { isContainer, type ContainerRecord, type RenderableRecord, type SceneRecord } from '../types.ts';
import type { CameraState } from './Camera.ts';
import { DEFAULT_DOCUMENT_BACKGROUND, parseColor } from './color.ts';
import type { OverlayModel, RemoteModel, RenderSink, TextRefresh, ViewOverride } from './sink.ts';
import type { PreviewModel } from '../ai/preview.ts';
import { PreviewLayer } from './PreviewLayer.ts';
import { FrameView } from './views/FrameView.ts';
import { ImageView, type ImageSlot } from './views/ImageView.ts';
import { ShapeView } from './views/ShapeView.ts';

// URLs firmadas de las variantes de cada asset (ver AssetResolver).
export type ImageUrls = {
  url(assetId: string, variant: AssetVariant): Promise<string | null>;
  invalidate(assetId: string, variant: AssetVariant): void;
};

export type RendererOptions = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  preference?: 'webgl' | 'webgpu';
  images?: ImageUrls;
  // Se llama si el contexto WebGL se pierde y no vuelve en 5 s.
  onContextFailed?: () => void;
  onContextRestored?: () => void;
};

// 'lost' mientras el navegador no devuelve el contexto WebGL; 'failed' si no lo devuelve en 5 s.
export type ContextState = 'ok' | 'lost' | 'failed';

// El navegador no dio un contexto gráfico para el lienzo (WebGL desactivado o sin GPU disponible).
export class RendererUnavailableError extends Error {
  constructor(cause: unknown) {
    super('No se pudo crear el renderer del lienzo', { cause });
    this.name = 'RendererUnavailableError';
  }
}

// Textura de una imagen cargada con createImageBitmap, que se decodifica fuera del hilo principal.
export type LoadedImage = LoadedTexture & { readonly texture: Texture };

export async function loadImageTexture(url: string, signal: AbortSignal, decoder: ImageDecoder): Promise<LoadedImage> {
  const bitmap = await decoder.decode(url, signal);
  // Los mipmaps evitan el parpadeo al ver reducidas las imágenes grandes. Pixi cambia a «repeat» las texturas
  // de un relleno en «clamp-to-edge»; con «mirror-repeat» el borde no toma color del lado contrario.
  const source = new ImageSource({
    resource: bitmap,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
    mipmapFilter: 'linear',
    alphaMode: 'premultiplied-alpha',
    addressMode: 'mirror-repeat',
  });
  const texture = new Texture({ source });
  return {
    texture,
    width: bitmap.width,
    height: bitmap.height,
    destroy: () => {
      texture.destroy(true);
      bitmap.close();
    },
  };
}

type Entry = {
  record: SceneRecord;
  world: Mat;
  visible: boolean;
  inView: boolean;
  view: ShapeView | null;
  // Vista de un grupo o un frame (los contenedores no usan el pool).
  box: FrameView | null;
  override: ViewOverride | null;
  group: string | null;
  // La vista está ahora dentro de un tramo de un gesto.
  inRun: boolean;
  // Contenido de texts[id] ('' si no tiene).
  text: string;
  // Hasta cuándo un conector recalculado sigue en su grupo propio.
  liveUntil: number;
};

// Vistas que un mismo gesto mueve sin redibujar. Cada tramo consecutivo en orden z es un render group con la
// matriz del gesto: mover cuesta un uniforme por tramo y el resto del contenido no vuelve a subir vértices.
// Un contenedor del gesto lleva dentro las vistas de sus hijos.
type GestureRun = { container: Container; ids: string[] };
type GestureGroup = { matrix: Mat; members: Set<string>; runs: GestureRun[] };

// Un grupo o frame con más hijos que esto, quieto 2 s y sin nada en edición, se pinta desde una textura.
export const CACHE_MIN_CHILDREN = 200;
export const CACHE_QUIET_MS = 2_000;
export const CACHE_MAX_TEXTURE = 4096;
const CACHE_ZOOM_DRIFT = 1.5;

const rootOf = (entry: Entry): Container | null => entry.view?.root ?? entry.box?.root ?? null;

const POOL_LIMIT = 2_000;
const ROUTES_GROUP = 'routes';
const ROUTE_LIVE_MS = 2_000;
// Vistas que el documento acaba de mover (un update de otro cliente, por ejemplo). Si cambia la posición de una vista
// del contenido, Pixi vuelve a subir los vértices de todo el render group del mundo; en su propio grupo solo se suben
// los suyos. Si las vistas movidas están repartidas en muchos tramos del orden z, se quedan en el contenido para no
// multiplicar las llamadas de dibujo.
const LIVE_GROUP = 'live';
const LIVE_MAX_RUNS = 8;
const IMAGE_REPAINT_MS = 100;
const IDENTITY_MAT: Mat = [1, 0, 0, 1, 0, 0];
const HIDDEN_TTL_MS = 30_000;
const CONTEXT_TIMEOUT_MS = 5_000;
const scratch = new Matrix();

export class Renderer implements RenderSink {
  // Instancias vivas (el editor, una vista previa de versión, la landing). Los pools globales de Pixi son de todas.
  static live = 0;
  readonly app: Application;
  readonly contextState = new Store<ContextState>('ok');
  private destroyed = false;
  readonly world = new Container({ isRenderGroup: true });
  readonly pageBackground = new Container();
  readonly content = new Container();
  readonly remote = new RemoteLayer();
  readonly overlay = new OverlayLayer();
  readonly preview = new PreviewLayer();
  private readonly entries = new Map<string, Entry>();
  private readonly pool: ShapeView[] = [];
  private readonly rank = new Map<string, number>();
  private readonly groups = new Map<string, GestureGroup>();
  private groupsDirty = false;
  // Contenedor de cada nodo de la página (null en la raíz) y contenedores candidatos a cachearse como textura.
  private readonly parents = new Map<string, string | null>();
  private readonly cacheCandidates = new Set<string>();
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private viewCount = 0;
  private contextTimer: ReturnType<typeof setTimeout> | null = null;
  private contextLost = false;
  private editing: string | null = null;
  private textResolution = 1;
  // Vistas de texto pendientes de pasar a la resolución actual tras un zoom.
  private textQueue: string[] = [];
  // Textos cuya fuente acaba de cargar.
  private readonly fontsReady = new Set<string>();
  // Se llama cuando hay que volver a pintar algo sin que el documento haya cambiado (una fuente o una imagen que carga).
  onNeedsRender: (() => void) | null = null;
  // Hace falta un frame (cargas o liberaciones pendientes) aunque quizá no haya nada nuevo que pintar.
  onNeedsFrame: (() => void) | null = null;
  readonly textures: TextureManager<LoadedImage>;
  private readonly decoder = new ImageDecoder();
  private lastImagePaint = -Infinity;
  private imageTimer: ReturnType<typeof setTimeout> | null = null;
  // Vistas de imagen por asset, para repintarlas cuando llega su textura.
  private readonly imagesByAsset = new Map<string, Set<string>>();
  private readonly imagesDirty = new Set<string>();
  private camera: CameraState = { x: 0, y: 0, zoom: 1 };
  // Último modelo del overlay que se dibujó (lo leen los e2e).
  lastOverlay: OverlayModel | null = null;

  private constructor(
    app: Application,
    private readonly options: RendererOptions,
  ) {
    this.app = app;
    const images = options.images;
    this.textures = new TextureManager<LoadedImage>({
      url: (assetId, variant) => (images ? images.url(assetId, variant) : Promise.resolve(null)),
      invalidateUrl: (assetId, variant) => images?.invalidate(assetId, variant),
      load: (url, signal) => loadImageTexture(url, signal, this.decoder),
      budgetBytes: defaultBudget((navigator as Navigator & { deviceMemory?: number }).deviceMemory),
      onChange: (assetId) => {
        for (const id of this.imagesByAsset.get(assetId) ?? []) this.imagesDirty.add(id);
        this.onNeedsFrame?.();
      },
      onNeedsFrame: () => this.onNeedsFrame?.(),
      onLoaded: (loaded) => this.prepare(loaded),
    });
    const stage = app.stage;
    stage.eventMode = 'none';
    stage.interactiveChildren = false;
    for (const layer of [this.world, this.pageBackground, this.content]) {
      layer.eventMode = 'none';
      layer.interactiveChildren = false;
    }
    this.content.sortableChildren = true;
    this.world.addChild(this.pageBackground, this.content, this.preview.container);
    stage.addChild(this.world, this.remote.world, this.overlay.container, this.remote.screen);
    options.canvas.addEventListener('webglcontextlost', this.onContextLost);
    options.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  static async create(options: RendererOptions): Promise<Renderer> {
    const app = new Application();
    // Cuenta desde antes de init: si otra instancia se destruye mientras tanto, no debe vaciar los pools de esta.
    Renderer.live++;
    try {
      await Renderer.init(app, options);
    } catch (error) {
      Renderer.live--;
      console.warn('[lienzo] no se pudo crear el renderer', error);
      throw new RendererUnavailableError(error);
    }
    app.ticker.stop();
    const renderer = new Renderer(app, options);
    renderer.warmGraphicsShader();
    return renderer;
  }

  private static async init(app: Application, options: RendererOptions): Promise<void> {
    // Sin resizeTo: el ResizePlugin redimensionaba el canvas antes que el ResizeObserver de createEngine, que veía el
    // tamaño ya igualado y nunca avisaba a la cámara. El tamaño lo lleva solo resize().
    await app.init({
      canvas: options.canvas,
      preference: options.preference ?? 'webgl',
      width: options.container.clientWidth || 1,
      height: options.container.clientHeight || 1,
      // Con densidad 2 o más el dentado no se aprecia y el MSAA es lo que más cuesta en la GPU.
      antialias: (window.devicePixelRatio || 1) < 2,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false,
      backgroundAlpha: 1,
      // Hasta el primer frame se ve el fondo por defecto del documento, no un color propio del renderer.
      background: parseColor(DEFAULT_DOCUMENT_BACKGROUND).color,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
      gcMaxUnusedTime: 60_000,
    });
  }

  // Un Graphics que no entra en un batch (la selección de muchos nodos, por ejemplo) usa otro shader, que se compila
  // la primera vez que se pinta y en WebGL bloquea el hilo decenas de ms. Se compila aquí, antes del primer frame.
  private warmGraphicsShader(): void {
    const graphics = new Graphics();
    graphics.context.batchMode = 'no-batch';
    graphics.rect(0, 0, 1, 1).fill(0xffffff);
    const target = RenderTexture.create({ width: 1, height: 1 });
    this.app.renderer.render({ container: graphics, target });
    graphics.destroy();
    target.destroy(true);
  }

  get rendererName(): string {
    return this.app.renderer.name;
  }

  get liveViews(): number {
    return this.viewCount;
  }

  // Reasignar el tamaño del canvas, aunque sea el mismo, recrea el búfer de dibujo: solo si cambia.
  resize(width: number, height: number): boolean {
    if (width === this.app.screen.width && height === this.app.screen.height) return false;
    this.app.renderer.resize(width, height);
    this.resizes++;
    return true;
  }

  resizes = 0;

  get screenSize(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  upsert(id: string, record: SceneRecord, world: Mat, visible: boolean, sameDrawing = false, text = ''): void {
    let entry = this.entries.get(id);
    this.touch(id);
    if (isContainer(record)) {
      if (!entry || !entry.box || entry.box.kind !== record.type) {
        if (entry) this.remove(id);
        const box = new FrameView(record.type);
        entry = { record, world, visible, inView: false, view: null, box, override: null, group: null, inRun: false, text: '', liveUntil: 0 };
        this.entries.set(id, entry);
        box.root.zIndex = this.rank.get(id) ?? 0;
        this.place(id, entry);
      }
      entry.record = record;
      entry.world = world;
      entry.visible = visible;
      if (!entry.override || entry.group) this.paintContainer(entry, entry.box!);
      this.showContainer(entry);
      return;
    }
    if (entry?.box) {
      this.remove(id);
      entry = undefined;
    }
    if (!entry) {
      entry = { record, world, visible, inView: false, view: null, box: null, override: null, group: null, inRun: false, text, liveUntil: 0 };
      this.entries.set(id, entry);
      this.trackImage(id, null, record);
      return;
    }
    this.trackImage(id, entry.record, record);
    // Otra imagen en el mismo nodo: se pide la textura nueva.
    if (record.type === 'image' && (entry.record.type !== 'image' || entry.record.assetId !== record.assetId) && entry.view && entry.inView) {
      entry.record = record;
      this.useTexture(id, entry);
    } else if (record.type !== 'image' && entry.record.type === 'image') {
      this.textures.release(id);
    }
    const view = entry.view;
    // El dibujo actual es el del registro anterior y no cambia: se evita compararlo clave a clave.
    if (sameDrawing && view && view.drawn === entry.record) view.drawn = record;
    entry.record = record;
    entry.world = world;
    entry.visible = visible;
    entry.text = text;
    // Solo se ha movido (lo normal en un update remoto): basta con la matriz. Una textura que llega repinta aparte.
    if (sameDrawing && view && !entry.override && view.drawn === record && view.drawnText === text) {
      view.setWorld(world, record.opacity);
      if (!this.parents.get(id) && (entry.group === null || entry.group === LIVE_GROUP)) {
        entry.liveUntil = this.clock() + ROUTE_LIVE_MS;
        if (!entry.group) this.joinGroup(id, entry, LIVE_GROUP, IDENTITY_MAT);
      }
    } else if (entry.view && (!entry.override || entry.group)) this.paint(id, entry, entry.view);
    if (entry.view) entry.view.root.visible = visible && (entry.inView || entry.override !== null);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.touch(id);
    if (entry.override) this.adjustActive(id, -1);
    this.leaveGroup(id, entry);
    if (entry.view) this.release(entry.view);
    if (entry.box) {
      // Las vistas de los hijos vuelven al contenido; el siguiente orden las coloca en su sitio.
      for (const child of [...entry.box.body.children]) this.content.addChild(child);
      entry.box.root.removeFromParent();
      entry.box.destroy();
      this.cacheCandidates.delete(id);
    }
    this.trackImage(id, entry.record, null);
    this.textures.release(id);
    this.imagesDirty.delete(id);
    this.entries.delete(id);
  }

  setOrder(order: readonly string[], parentOf?: (id: string) => string | null): void {
    this.rank.clear();
    order.forEach((id, i) => this.rank.set(id, i));
    this.parents.clear();
    if (parentOf) for (const id of order) this.parents.set(id, parentOf(id));
    for (const [id, entry] of this.entries) {
      const root = rootOf(entry);
      if (root) root.zIndex = this.rank.get(id) ?? 0;
      if (entry.box) {
        entry.box.descendants = 0;
        entry.box.active = 0;
      }
    }
    // Primero los contenedores, para que sus hijos encuentren su sitio.
    for (const [id, entry] of this.entries) if (entry.box) this.place(id, entry);
    for (const [id, entry] of this.entries) if (!entry.box) this.place(id, entry);
    // Cuántos nodos cuelgan de cada contenedor y cuáles tienen ahora una vista previa o se editan.
    for (const id of order) {
      const active = this.entries.get(id)?.override || id === this.editing ? 1 : 0;
      for (let parent = this.parents.get(id); parent; parent = this.parents.get(parent)) {
        const box = this.entries.get(parent)?.box;
        if (!box) continue;
        box.descendants++;
        box.active += active;
      }
    }
    for (const [id, entry] of this.entries) {
      const box = entry.box;
      if (!box) continue;
      if (box.descendants > CACHE_MIN_CHILDREN) {
        if (!this.cacheCandidates.has(id)) box.quietSince = performance.now();
        this.cacheCandidates.add(id);
      } else if (this.cacheCandidates.delete(id)) {
        box.setCached(false);
      }
    }
    if (this.cacheCandidates.size) this.scheduleCache();
    if (this.groups.size) this.groupsDirty = true;
  }

  // Coloca la vista de un nodo dentro de la de su contenedor (o en el contenido, en la raíz).
  private containerFor(id: string): Container {
    const parent = this.parents.get(id);
    const box = parent ? this.entries.get(parent)?.box : undefined;
    return box ? box.body : this.content;
  }

  private place(id: string, entry: Entry): void {
    if (entry.inRun) return;
    const root = rootOf(entry);
    if (!root) return;
    const target = this.containerFor(id);
    if (root.parent !== target) target.addChild(root);
  }

  // Algo cambió dentro de los contenedores de `id`: su textura cacheada deja de valer.
  private touch(id: string): void {
    if (!this.cacheCandidates.size) return;
    const now = performance.now();
    for (let parent = this.parents.get(id); parent; parent = this.parents.get(parent)) {
      const box = this.entries.get(parent)?.box;
      if (!box) continue;
      box.quietSince = now;
      box.setCached(false);
    }
    this.scheduleCache();
  }

  private adjustActive(id: string, delta: number): void {
    for (let parent = this.parents.get(id); parent; parent = this.parents.get(parent)) {
      const box = this.entries.get(parent)?.box;
      if (box) box.active = Math.max(0, box.active + delta);
    }
  }

  private scheduleCache(): void {
    if (this.cacheTimer !== null) return;
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      this.onNeedsRender?.();
    }, CACHE_QUIET_MS + 50);
  }

  // Contenedores grandes, quietos y sin nada en edición: se pintan desde una textura mientras no cambie nada dentro.
  private updateCaches(now: number): void {
    let waiting = false;
    const resolution = this.camera.zoom * this.app.renderer.resolution;
    for (const id of this.cacheCandidates) {
      const entry = this.entries.get(id);
      const box = entry?.box;
      if (!entry || !box || box.cached || box.rejectedAt === box.quietSince) continue;
      if (box.active > 0 || !entry.visible || !box.root.visible) continue;
      if (now - box.quietSince < CACHE_QUIET_MS) {
        waiting = true;
        continue;
      }
      const bounds = box.body.getLocalBounds();
      if (bounds.width <= 0 || bounds.height <= 0 || bounds.width * resolution > CACHE_MAX_TEXTURE || bounds.height * resolution > CACHE_MAX_TEXTURE) {
        box.rejectedAt = box.quietSince;
        continue;
      }
      box.setCached(true, resolution);
      box.cacheZoom = this.camera.zoom;
    }
    if (waiting) this.scheduleCache();
  }

  // Cuántos contenedores se pintan ahora desde su textura (para pruebas y el benchmark).
  get cachedContainers(): number {
    let count = 0;
    for (const id of this.cacheCandidates) if (this.entries.get(id)?.box?.cached) count++;
    return count;
  }

  private paintContainer(entry: Entry, box: FrameView): void {
    const source = entry.override;
    const record = (source && source.redraw ? source.record : entry.record) as ContainerRecord;
    const world = entry.group || !source ? entry.world : source.world;
    // Como en las formas, la opacidad sale de la vista previa aunque no haya que redibujar.
    box.draw(record, world, (source?.record ?? entry.record).opacity);
  }

  // Un frame con recorte que sale del viewport oculta también a sus hijos; sin recorte solo oculta su fondo.
  private showContainer(entry: Entry): void {
    const box = entry.box!;
    const seen = entry.inView || entry.override !== null;
    const clip = entry.record.type === 'frame' && entry.record.clip;
    box.root.visible = entry.visible && (!clip || seen);
    if (box.background) box.background.visible = seen;
  }

  // Matriz de mundo y registro con que se pinta ahora la vista de un nodo.
  viewOf(id: string): { world: Mat; record: SceneRecord } | null {
    const entry = this.entries.get(id);
    return entry ? { world: entry.override?.world ?? entry.world, record: entry.override?.record ?? entry.record } : null;
  }

  setOverride(id: string, override: ViewOverride | null): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    // Mismo gesto y mismo dibujo que en el frame anterior: solo cambia la matriz del grupo.
    // Un conector que se recalcula va a su propio grupo; al terminar se queda ahí hasta que caduque.
    // Dentro de un contenedor, el conector se queda en él (para que lo recorte y lo lleve en sus gestos).
    const nested = !!this.parents.get(id);
    const rerouted = override?.redraw === true && override.record.type === 'connector' && !nested;
    const key = override?.gesture?.key ?? (rerouted || (!override && entry.group === ROUTES_GROUP) ? ROUTES_GROUP : !override && entry.group === LIVE_GROUP ? LIVE_GROUP : null);
    if (key && key !== ROUTES_GROUP && entry.group === key && (entry.view || entry.box) && entry.override?.record === override!.record) {
      entry.override = override;
      this.groups.get(key)!.matrix = override!.gesture!.matrix;
      return;
    }
    if (!entry.override !== !override) this.adjustActive(id, override ? 1 : -1);
    this.touch(id);
    entry.override = override;
    // Un nodo en gesto se pinta aunque su caja vieja quede fuera del viewport.
    if (override && !entry.view && !entry.box) entry.view = this.acquire(id);
    if (entry.group !== key) {
      this.leaveGroup(id, entry);
      if (key) this.joinGroup(id, entry, key, override?.gesture?.matrix ?? IDENTITY_MAT);
    }
    if (key && override?.gesture) this.groups.get(key)!.matrix = override.gesture.matrix;
    if (entry.box) {
      this.paintContainer(entry, entry.box);
      this.showContainer(entry);
      return;
    }
    if (!entry.view) return;
    this.paint(id, entry, entry.view);
    entry.view.root.visible = entry.visible && (entry.inView || override !== null);
  }

  setGroupMatrix(key: string, matrix: Mat): void {
    const group = this.groups.get(key);
    if (group) group.matrix = matrix;
  }

  private joinGroup(id: string, entry: Entry, key: string, matrix: Mat): void {
    let group = this.groups.get(key);
    if (!group) this.groups.set(key, (group = { matrix, members: new Set(), runs: [] }));
    group.members.add(id);
    entry.group = key;
    this.groupsDirty = true;
  }

  private leaveGroup(id: string, entry: Entry): void {
    if (!entry.group) return;
    const group = this.groups.get(entry.group);
    group?.members.delete(id);
    entry.group = null;
    this.groupsDirty = true;
  }

  setInView(enter: Iterable<string>, leave: Iterable<string>): void {
    const now = performance.now();
    for (const id of leave) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.inView = false;
      this.touch(id);
      if (entry.box) {
        this.showContainer(entry);
        continue;
      }
      if (entry.view && !entry.override) {
        entry.view.root.visible = false;
        entry.view.hiddenSince = now;
      }
      // Fuera del viewport ampliado, su textura pasa a la LRU (y su carga, si no había empezado, se cancela).
      if (entry.record.type === 'image') this.textures.release(id);
    }
    for (const id of enter) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.inView = true;
      this.touch(id);
      if (entry.box) {
        this.showContainer(entry);
        continue;
      }
      if (entry.record.type === 'image') this.useTexture(id, entry);
      if (!entry.view) {
        entry.view = this.acquire(id);
        this.paint(id, entry, entry.view);
      } else {
        if (entry.record.type === 'image') this.paint(id, entry, entry.view);
        // Al volver a pantalla toma la resolución del zoom actual, aunque sea un texto largo.
        entry.view.textView?.setResolution(this.textResolution);
      }
      entry.view.root.visible = entry.visible;
    }
    if (this.viewCount > POOL_LIMIT) this.trim(now);
  }

  setEditing(id: string | null): void {
    if (id === this.editing) return;
    const previous = this.editing ? this.entries.get(this.editing)?.view : null;
    previous?.setTextHidden(false);
    if (this.editing) this.adjustActive(this.editing, -1);
    this.editing = id;
    if (id) {
      this.adjustActive(id, 1);
      this.touch(id);
      this.entries.get(id)?.view?.setTextHidden(true);
    }
  }

  // Lleva a la resolución nueva como mucho `budget` textos en pantalla por llamada.
  refreshText(resolution: number, budget: number): TextRefresh {
    if (resolution !== this.textResolution) {
      this.textResolution = resolution;
      this.textQueue = [];
      for (const [id, entry] of this.entries) if (entry.view?.textView?.active) this.textQueue.push(id);
    }
    let changed = 0;
    while (this.textQueue.length && changed < budget) {
      const id = this.textQueue.pop()!;
      const text = this.entries.get(id)?.view?.textView;
      // Fuera de pantalla o muy largo: se actualiza al entrar en pantalla.
      if (!text || !this.entries.get(id)!.inView || text.long || text.resolution === resolution) continue;
      text.setResolution(resolution);
      changed++;
    }
    return { changed, remaining: this.textQueue.length };
  }

  // Dentro de un grupo, la vista conserva su matriz propia: el gesto lo aplica el contenedor del tramo.
  private paint(id: string, entry: Entry, view: ShapeView): void {
    const source = entry.override;
    const record = (source && source.redraw ? source.record : entry.record) as RenderableRecord;
    let redraw = view.needsDraw(record);
    if (record.type === 'image') {
      const slot = this.slotFor(id);
      if (redraw || view.imageView?.drawnKey !== ImageView.keyOf(slot)) {
        view.draw(record, slot);
        redraw = true;
      }
    } else if (redraw) {
      // Redibujar un Graphics agrupado obliga a Pixi a rehacer las instrucciones de todo su render group. Un
      // conector que ya estaba pintado y cambia de recorrido (porque se mueve su nodo) pasa a su propio grupo
      // durante un rato, y así el resto del contenido no se rehace en cada movimiento.
      if (record.type === 'connector' && view.drawn && !this.parents.get(id)) {
        entry.liveUntil = this.clock() + ROUTE_LIVE_MS;
        if (!entry.group) this.joinGroup(id, entry, ROUTES_GROUP, IDENTITY_MAT);
      }
      view.draw(record);
    }
    // Un registro nuevo que se dibuja igual (una línea que se mueve reescribe sus puntos) pasa a ser el dibujado:
    // si no, la ruta rápida de upsert, que compara por identidad, no volvería a servir para esa vista.
    if (!redraw) view.drawn = record;
    if (redraw || view.drawnText !== entry.text) this.paintText(id, entry, view, record);
    const world = entry.group || !source ? entry.world : source.world;
    view.setWorld(world, (source?.record ?? entry.record).opacity);
  }

  private paintText(id: string, entry: Entry, view: ShapeView, record: RenderableRecord): void {
    const waiting = view.drawText(record, entry.text, this.textResolution, id === this.editing);
    if (!waiting) return;
    void waiting.then(() => {
      this.fontsReady.add(id);
      this.onNeedsRender?.();
    });
  }

  private acquire(id: string): ShapeView {
    let view = this.pool.pop();
    if (!view) {
      view = new ShapeView();
      this.content.addChild(view.root);
      this.viewCount++;
    }
    view.drawn = null;
    view.drawnText = '';
    view.root.zIndex = this.rank.get(id) ?? 0;
    const target = this.containerFor(id);
    if (view.root.parent !== target) target.addChild(view.root);
    return view;
  }

  private release(view: ShapeView): void {
    if (view.root.parent !== this.content) this.content.addChild(view.root);
    view.root.visible = false;
    view.reset();
    this.pool.push(view);
  }

  // Rehace los tramos de cada grupo cuando cambian sus miembros o el orden z (al empezar y acabar un gesto).
  // Los tramos van dentro del contenedor de sus vistas, así un frame sigue recortando a sus hijos en el gesto.
  private rebuildGroups(): void {
    this.groupsDirty = false;
    for (const [key, group] of this.groups) {
      for (const run of group.runs) {
        for (const id of run.ids) {
          const entry = this.entries.get(id);
          if (!entry) continue;
          entry.inRun = false;
          this.place(id, entry);
        }
        for (const child of [...run.container.children]) this.content.addChild(child);
        run.container.removeFromParent();
        run.container.destroy();
      }
      group.runs = [];
      if (group.members.size === 0) {
        this.groups.delete(key);
        continue;
      }
      const ordered = [...group.members]
        .filter((id) => {
          const entry = this.entries.get(id);
          return entry && rootOf(entry) && !this.carriedBy(id, group.members);
        })
        .sort((a, b) => (this.rank.get(a) ?? 0) - (this.rank.get(b) ?? 0));
      if (key === LIVE_GROUP && this.countRuns(ordered) > LIVE_MAX_RUNS) continue;
      let run: GestureRun | null = null;
      let runParent: Container | null = null;
      let last = -2;
      for (const id of ordered) {
        const entry = this.entries.get(id)!;
        const rank = this.rank.get(id) ?? 0;
        const parent = this.containerFor(id);
        if (!run || rank !== last + 1 || parent !== runParent) {
          const container = new Container({ isRenderGroup: true });
          container.eventMode = 'none';
          container.interactiveChildren = false;
          container.sortableChildren = true;
          container.zIndex = rank;
          parent.addChild(container);
          run = { container, ids: [] };
          runParent = parent;
          group.runs.push(run);
        }
        run.container.addChild(rootOf(entry)!);
        run.ids.push(id);
        entry.inRun = true;
        // Un contenedor ocupa en el orden z también los puestos de sus descendientes.
        last = rank + (entry.box?.descendants ?? 0);
      }
    }
  }

  // Tramos que saldrían de estas vistas, ya ordenadas, con el mismo corte que rebuildGroups.
  private countRuns(ordered: readonly string[]): number {
    let runs = 0;
    let last = -2;
    let parent: Container | null = null;
    for (const id of ordered) {
      const rank = this.rank.get(id) ?? 0;
      const target = this.containerFor(id);
      if (rank !== last + 1 || target !== parent) runs++;
      parent = target;
      last = rank + (this.entries.get(id)!.box?.descendants ?? 0);
    }
    return runs;
  }

  private carriedBy(id: string, members: ReadonlySet<string>): boolean {
    for (let parent = this.parents.get(id); parent; parent = this.parents.get(parent)) if (members.has(parent)) return true;
    return false;
  }

  // ── Imágenes ──

  // Lado mayor en píxeles físicos y distancia al centro de la pantalla, para el nivel de detalle y la prioridad.
  private imageMetrics(entry: Entry): { screenPx: number; priority: number } {
    const m = entry.world;
    const scale = Math.hypot(m[0], m[1]) || 1;
    const zoom = this.camera.zoom;
    const resolution = this.app.renderer.resolution;
    const screenPx = Math.max(entry.record.w, entry.record.h) * scale * zoom * resolution;
    const cx = m[0] * (entry.record.w / 2) + m[2] * (entry.record.h / 2) + m[4];
    const cy = m[1] * (entry.record.w / 2) + m[3] * (entry.record.h / 2) + m[5];
    const sx = (cx - this.camera.x) * zoom - this.app.screen.width / 2;
    const sy = (cy - this.camera.y) * zoom - this.app.screen.height / 2;
    return { screenPx, priority: Math.hypot(sx, sy) };
  }

  private useTexture(id: string, entry: Entry): void {
    if (entry.record.type !== 'image') return;
    const { screenPx, priority } = this.imageMetrics(entry);
    this.textures.use(id, entry.record.assetId, screenPx, priority);
  }

  private trackImage(id: string, previous: SceneRecord | null, next: SceneRecord | null): void {
    const before = previous?.type === 'image' ? previous.assetId : null;
    const after = next?.type === 'image' ? next.assetId : null;
    if (before === after) return;
    if (before) {
      const set = this.imagesByAsset.get(before);
      set?.delete(id);
      if (set?.size === 0) this.imagesByAsset.delete(before);
    }
    if (after) {
      let set = this.imagesByAsset.get(after);
      if (!set) this.imagesByAsset.set(after, (set = new Set()));
      set.add(id);
    }
  }

  private slotFor(id: string): ImageSlot {
    const state = this.textures.stateFor(id);
    return state.kind === 'ready' ? { kind: 'ready', texture: state.texture.texture } : state;
  }

  // La cámara se ha parado: cada imagen visible pide la variante que le toca a este zoom.
  settleCamera(camera: CameraState): void {
    this.camera = camera;
    for (const ids of this.imagesByAsset.values()) {
      for (const id of ids) {
        const entry = this.entries.get(id);
        if (entry?.inView && entry.view) this.useTexture(id, entry);
      }
    }
  }

  // El asset se borró: sus imágenes muestran el marcador de imagen rota y siguen siendo editables.
  assetDeleted(assetId: string): void {
    this.textures.dropAsset(assetId);
    this.onNeedsFrame?.();
  }

  // El asset ya está procesado en el servidor: lo que no se pudo cargar se vuelve a pedir.
  assetReady(assetId: string): void {
    this.textures.retryAsset(assetId);
  }

  // Imagen para exportar, fuera de la LRU: quien la pide la libera con destroy().
  async loadExportImage(assetId: string, variant: AssetVariant, signal: AbortSignal): Promise<LoadedImage | null> {
    const url = await this.options.images?.url(assetId, variant);
    if (!url || signal.aborted) return null;
    try {
      return await loadImageTexture(url, signal, this.decoder);
    } catch {
      return null;
    }
  }

  // URL firmada de una variante, para incrustar la imagen en un SVG.
  imageUrl(assetId: string, variant: AssetVariant): Promise<string | null> {
    return this.options.images?.url(assetId, variant) ?? Promise.resolve(null);
  }

  // Sirve para pintar fuera del lienzo (exportar, miniaturas): no está destruido y el contexto no se perdió. Mira
  // también el contexto WebGL, que da la pérdida antes de que llegue el evento.
  get usable(): boolean {
    if (this.destroyed || this.contextLost) return false;
    const gl = (this.app.renderer as unknown as { gl?: WebGLRenderingContext } | null)?.gl;
    return !gl?.isContextLost();
  }

  // Lado máximo de una textura en esta GPU.
  get maxTextureSize(): number {
    const pixi = this.app.renderer as unknown as { gl?: WebGLRenderingContext; gpu?: { device: { limits: { maxTextureDimension2D: number } } } };
    // Con el contexto perdido, getParameter da null.
    if (pixi.gl) return (pixi.gl.getParameter(pixi.gl.MAX_TEXTURE_SIZE) as number | null) || 4096;
    return pixi.gpu?.device.limits.maxTextureDimension2D ?? 4096;
  }

  // Arranca cargas, libera texturas y repinta las imágenes cuya textura cambió. Devuelve si hay que pintar.
  flushAssets(): boolean {
    this.textures.frame();
    if (!this.imagesDirty.size) return false;
    // Repintar una imagen reconstruye las instrucciones de todo el contenido. Mientras quedan cargas pendientes,
    // las texturas que llegan se pintan juntas cada 100 ms; así el hilo queda libre para recibir las siguientes.
    const now = performance.now();
    const since = now - this.lastImagePaint;
    if (since < IMAGE_REPAINT_MS && this.textures.pending > 0) {
      this.imageTimer ??= setTimeout(() => {
        this.imageTimer = null;
        this.onNeedsFrame?.();
      }, IMAGE_REPAINT_MS - since);
      return false;
    }
    this.lastImagePaint = now;
    let changed = false;
    for (const id of this.imagesDirty) {
      const entry = this.entries.get(id);
      if (!entry?.view) continue;
      this.paint(id, entry, entry.view);
      changed = true;
    }
    this.imagesDirty.clear();
    return changed;
  }

  // Sube a la GPU las texturas recién cargadas cuando el navegador está libre, para que su primer frame no tire.
  private prepare(loaded: LoadedImage[]): void {
    const upload = () => {
      if (this.contextLost) return;
      const textures = loaded.filter((item) => !item.texture.destroyed).map((item) => item.texture);
      if (textures.length) void this.app.renderer.prepare.upload(textures).catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(upload, { timeout: 500 });
    else setTimeout(upload, 0);
  }

  // Destruye vistas que llevan 30 s fuera, solo cuando hay demasiadas.
  private trim(now: number): void {
    for (const entry of this.entries.values()) {
      if (this.viewCount <= POOL_LIMIT) break;
      const view = entry.view;
      if (!view || entry.inView || entry.override || now - view.hiddenSince < HIDDEN_TTL_MS) continue;
      view.root.removeFromParent();
      view.destroy();
      entry.view = null;
      this.viewCount--;
    }
    while (this.viewCount > POOL_LIMIT && this.pool.length) {
      const view = this.pool.pop()!;
      this.content.removeChild(view.root);
      view.destroy();
      this.viewCount--;
    }
  }

  setCamera(camera: CameraState): void {
    this.camera = camera;
    // Una textura cacheada a otro zoom se vería borrosa o gastaría memoria de más: se rehace al parar.
    for (const id of this.cacheCandidates) {
      const box = this.entries.get(id)?.box;
      if (!box?.cached) continue;
      const drift = camera.zoom / box.cacheZoom;
      if (drift > CACHE_ZOOM_DRIFT || drift < 1 / CACHE_ZOOM_DRIFT) {
        box.setCached(false);
        box.quietSince = performance.now();
        this.scheduleCache();
      }
    }
    this.world.position.set(-camera.x * camera.zoom, -camera.y * camera.zoom);
    this.world.scale.set(camera.zoom);
    this.remote.setCamera(camera);
  }

  setBackground(color: string): void {
    const { color: value } = parseColor(color);
    this.app.renderer.background.color = value;
  }

  // Modo Presentar: ni selección, ni cursores de los demás, ni vistas previas encima del contenido.
  setPresenting(presenting: boolean): void {
    this.overlay.container.visible = !presenting;
    this.remote.world.visible = !presenting;
    this.remote.screen.visible = !presenting;
    this.preview.container.visible = !presenting;
    this.onNeedsRender?.();
  }

  drawOverlay(model: OverlayModel): void {
    this.lastOverlay = model;
    this.overlay.draw(model);
  }

  drawPreview(model: PreviewModel | null, zoom: number): void {
    this.preview.draw(model, zoom, this.textResolution);
  }

  drawRemote(model: RemoteModel, camera: CameraState): void {
    this.remote.draw(model, camera);
  }

  render(): void {
    if (this.fontsReady.size) {
      for (const id of this.fontsReady) {
        const entry = this.entries.get(id);
        if (!entry?.view) continue;
        const source = entry.override;
        this.paintText(id, entry, entry.view, (source && source.redraw ? source.record : entry.record) as RenderableRecord);
      }
      this.fontsReady.clear();
    }
    const now = performance.now();
    for (const key of [ROUTES_GROUP, LIVE_GROUP]) {
      const group = this.groups.get(key);
      if (!group) continue;
      for (const id of [...group.members]) {
        const entry = this.entries.get(id);
        if (entry && !entry.override && entry.liveUntil < now) this.leaveGroup(id, entry);
      }
    }
    if (this.groupsDirty) this.rebuildGroups();
    for (const group of this.groups.values()) {
      const m = group.matrix;
      scratch.set(m[0], m[1], m[2], m[3], m[4], m[5]);
      for (const run of group.runs) run.container.setFromMatrix(scratch);
    }
    if (this.cacheCandidates.size) this.updateCaches(performance.now());
    this.frameNow = -1;
    if (this.contextLost) return;
    this.app.renderer.render(this.app.stage);
  }

  // Hora del frame en curso para las caducidades de los grupos: una lectura por frame, no una por vista.
  private frameNow = -1;

  private clock(): number {
    if (this.frameNow < 0) this.frameNow = performance.now();
    return this.frameNow;
  }

  // Fuerza a redibujar todas las vistas (tras restaurar el contexto).
  invalidateAll(): void {
    for (const [id, entry] of this.entries) {
      if (entry.view) {
        entry.view.drawn = null;
        this.paint(id, entry, entry.view);
      }
      if (entry.box) {
        entry.box.setCached(false);
        entry.box.quietSince = performance.now();
        this.paintContainer(entry, entry.box);
      }
    }
    if (this.cacheCandidates.size) this.scheduleCache();
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    if (this.contextLost) return;
    this.contextLost = true;
    console.warn('[lienzo] se perdió el contexto WebGL');
    this.contextState.set('lost');
    this.contextTimer = setTimeout(() => {
      this.contextTimer = null;
      console.error('[lienzo] el contexto WebGL no se recuperó en 5 s');
      this.contextState.set('failed');
      this.options.onContextFailed?.();
    }, CONTEXT_TIMEOUT_MS);
  };

  private readonly onContextRestored = () => {
    this.contextLost = false;
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = null;
    this.contextState.set('ok');
    // Las texturas de la GPU se perdieron con el contexto: se descartan y se vuelven a cargar las que se ven.
    this.textures.invalidateAll();
    this.invalidateAll();
    this.options.onContextRestored?.();
    this.onNeedsRender?.();
  };

  // Pixi pierde el contexto del canvas al destruirse (loseContext): ese canvas ya no sirve para otro renderer.
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.contextTimer) clearTimeout(this.contextTimer);
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    if (this.imageTimer) clearTimeout(this.imageTimer);
    this.cacheTimer = null;
    for (const entry of this.entries.values()) entry.box?.setCached(false);
    this.onNeedsRender = null;
    this.onNeedsFrame = null;
    this.textures.destroy();
    this.decoder.destroy();
    this.options.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.options.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.remote.destroy();
    this.overlay.destroy();
    this.preview.destroy();
    // Vaciar los pools globales con otra instancia viva le quitaría texturas y objetos que está usando.
    this.app.destroy({ removeView: false, releaseGlobalResources: Renderer.live === 1 }, { children: true });
    Renderer.live--;
  }
}
