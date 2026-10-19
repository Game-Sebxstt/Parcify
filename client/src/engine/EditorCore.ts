import type { PresenceState } from '../shared/document/keys.js';
import type { AnimationPlan } from '../shared/ai/animation.js';
import type { AssistantPlan, CanvasSummaryNode } from '../shared/ai/assistant.js';
import type { Animation } from '../shared/document/schema.js';
import { canvasSummary, resolvePlan } from './ai/plan.ts';
import { AI_PREVIEW_COLOR, buildPreview } from './ai/preview.ts';
import { AnimationPlayer } from './anim/AnimationPlayer.ts';
import { Commands } from './commands/Commands.ts';
import type { DocumentBackend } from './doc/backend.ts';
import { DocWriter } from './doc/DocWriter.ts';
import type { DocBatch, TextSessionState } from './doc/protocol.ts';
import { DEFAULT_FRAME_PRESET, type FramePresetId } from './commands/defaults.ts';
import { geometryAABB, localPoints, paintedFromGeometry, paintPadding, transformedAABB, translatedPlacement, type Placement } from './geometry/bounds.ts';
import { anchorTerminal, endpointsFromBox, routeEnd, routePoints, routeStart, type ConnectorEnd, type Terminal } from './geometry/connectors.ts';
import { hitRecord, insideBox } from './geometry/hit.ts';
import { apply, IDENTITY, invert, isRigid, isTranslation, multiply, rotation, transformPoints, type Mat, type Point } from './geometry/matrix.ts';
import { SnapCandidates } from './geometry/snapping.ts';
import { applyPatch, transformPatch } from './geometry/transform.ts';
import { PointerController } from './interaction/PointerController.ts';
import { DocumentStore, type PageRecord } from './model/DocumentStore.ts';
import { SceneTree } from './model/tree.ts';
import { frameCorners, handlePositions, type SelectionFrame } from './overlay/handles.ts';
import { CursorInterpolator } from './presence/cursors.ts';
import { Presence } from './presence/Presence.ts';
import { realTimers, type Timers } from './presence/throttle.ts';
import { Camera, type CameraState } from './render/Camera.ts';
import { FrameScheduler } from './render/FrameScheduler.ts';
import type { OverlayModel, RemoteModel, RenderSink, ViewOverride } from './render/sink.ts';
import { SpatialIndex } from './spatial/SpatialIndex.ts';
import { Store, sameList } from './store.ts';
import { TEXT_REFRESH_PER_FRAME, TEXT_ZOOM_SETTLE_MS, textResolution } from './text/layout.ts';
import {
  hasLabel,
  hasTextContent,
  containsAABB,
  emptyAABB,
  expandAABB,
  intersects,
  isContainer,
  isEmptyAABB,
  isRenderable,
  unionAABB,
  type AABB,
  type BasicShapeType,
  type Box,
  type ConnectorRecord,
  type ContainerRecord,
  type NodeRecord,
  type RenderableRecord,
  type SceneRecord,
} from './types.ts';

export type Tool = 'select' | 'hand' | BasicShapeType | 'line' | 'arrow' | 'connector' | 'text' | 'frame';

export const EDIT_TOOLS: ReadonlySet<Tool> = new Set(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc', 'line', 'arrow', 'connector', 'text', 'frame']);

// Tras este tiempo sin mover la cámara se decide el nivel de detalle de las imágenes.
export const CAMERA_SETTLE_MS = 200;
// Constante de tiempo de la interpolación de «Seguir a», como el suavizado de los cursores remotos.
export const FOLLOW_SMOOTHING_MS = 120;

// Matriz de mundo de cada nodo que se mueve en un gesto (local o remoto), para recalcular sus conectores.
type MovingLookup = (id: string) => Readonly<Mat> | null;

type CachedTerminal = { target: NodeRecord; anchor: unknown; terminal: Terminal };


function translateTerminal(terminal: Terminal, dx: number, dy: number): Terminal {
  const { bounds } = terminal;
  const moved: Terminal = { x: terminal.x + dx, y: terminal.y + dy, dir: terminal.dir };
  if (bounds) moved.bounds = { minX: bounds.minX + dx, minY: bounds.minY + dy, maxX: bounds.maxX + dx, maxY: bounds.maxY + dy };
  return moved;
}

export type EngineUser = PresenceState['user'];

// Texto que se edita en el DOM: el de un nodo text o el interior de una forma.
export type TextEditing = { id: string; kind: 'text' | 'label' };

// Con más nodos, la vista previa de un redimensionado deforma la vista en vez de redibujarla.
export const RESIZE_REDRAW_LIMIT = 50;
export const HIT_TOLERANCE_PX = 4;
export const SNAP_THRESHOLD_PX = 6;
const VIEWPORT_MARGIN = 0.25;
const CREATING_ID = '__creating';
const GEOMETRY_KEYS = ['x', 'y', 'w', 'h', 'rotation', 'points'];



// Tiempos en ms. `work` es el trabajo JS del motor (aplicar lo recibido del servidor y fases 1–5); `render` es la
// llamada a Pixi.
export type FrameStats = {
  time: number;
  work: number;
  render: number;
  changed: number;
  phases: { apply: number; flush: number; sync: number; interact: number; spatial: number; overlay: number };
};

// Sin acuse del host en este tiempo se le pregunta si sigue vivo; sin respuesta en PONG_TIMEOUT_MS, el editor se da
// por caído.
export const ACK_TIMEOUT_MS = 15_000;
export const PONG_TIMEOUT_MS = 5_000;
const WATCHDOG_INTERVAL_MS = 5_000;

export type CoreOptions = {
  // El documento: el motor aplica sus lotes al principio del frame y escribe por él.
  backend: DocumentBackend;
  sink: RenderSink;
  user: EngineUser;
  readOnly?: boolean;
  pageId?: string;
  camera?: CameraState;
  screen: { width: number; height: number };
  raf?: (callback: (time: number) => void) => number;
  caf?: (handle: number) => void;
  timers?: Timers;
  logger?: Pick<Console, 'warn'>;
  // Densidad de la pantalla, para la resolución del texto.
  dpr?: number;
};

export type GesturePreview = { ids: readonly string[]; matrix: Mat; snapGuides?: OverlayModel['guides'] };

export class EditorCore {
  readonly backend: DocumentBackend;
  readonly writer: DocWriter;
  readonly sink: RenderSink;
  readonly store: DocumentStore;
  readonly tree: SceneTree;
  readonly spatial = new SpatialIndex();
  readonly camera = new Camera();
  readonly scheduler: FrameScheduler;
  readonly presence: Presence;
  readonly controller: PointerController;
  readonly commands: Commands;
  readonly anim: AnimationPlayer;
  readonly user: EngineUser;

  readonly tool = new Store<Tool>('select');
  readonly selection = new Store<readonly string[]>([], sameList);
  readonly selectionRecords = new Store<readonly NodeRecord[]>([], sameList);
  readonly readOnly: Store<boolean>;
  readonly zoom = new Store(1);
  readonly pageId: Store<string | null>;
  readonly historyState = new Store({ canUndo: false, canRedo: false }, (a, b) => a.canUndo === b.canUndo && a.canRedo === b.canRedo);
  readonly nodeCount = new Store(0);
  readonly editingText = new Store<TextEditing | null>(null, (a, b) => a?.id === b?.id && a?.kind === b?.kind);
  readonly pages = new Store<readonly PageRecord[]>([], sameList);
  // Sube cuando cambia algo que muestra el panel de capas: el árbol, nombres, visibilidad o bloqueo.
  readonly layersVersion = new Store(0);
  // Sube cuando cambian las animaciones del documento (propias o de otros).
  readonly animationsVersion = new Store(0);
  // Tamaño con el que la herramienta de frame crea uno al hacer clic.
  readonly framePreset = new Store<FramePresetId>(DEFAULT_FRAME_PRESET);
  // Colaborador (clientId de Awareness) cuya vista copia la cámara; null si no se sigue a nadie.
  readonly following = new Store<number | null>(null);

  // Grupo en el que se ha entrado con doble clic: sus hijos se seleccionan directamente.
  scope: string | null = null;

  private readonly timers: Timers;
  private readonly dpr: number;
  private readonly detachBackend: () => void;
  private draining = false;
  // Lo que un lote pide hacer después de llevar sus registros al árbol (fitAll de la sincronización, selección de
  // un deshacer) y la presencia que llegó antes de existir Presence.
  private syncedOut: boolean | undefined;
  private restoreOut: string[] | null = null;
  private earlyPresence: NonNullable<DocBatch['presence']>[] = [];
  private readonly textListeners = new Set<(state: TextSessionState, applied: number) => void>();
  // Tiempo de aplicar lotes fuera del frame (desde un comando): se suma a phases.apply del siguiente.
  private applyTime = 0;
  private watchdogTimer: unknown = null;
  private lastAlive = 0;
  private pingAt: number | null = null;
  private pingId = 0;
  private textZoom: number;
  private textTarget: number;
  private textTimer: unknown = null;

  private readonly geom = new Map<string, AABB>();
  // Matriz de mundo y cajas de cada hoja calculadas enteras, con la posición y el giro de entonces.
  private readonly bases = new Map<string, Placement>();
  // Recorrido de cada conector en mundo y último punto calculado de sus extremos (para los extremos colgantes).
  private readonly routes = new Map<string, number[]>();
  private readonly lastEnds = new Map<string, { from: Point; to: Point }>();
  // Índice inverso: nodo → conectores que lo usan como extremo, y conector → nodos de sus extremos.
  private readonly connectorsByNode = new Map<string, Set<string>>();
  private readonly connectorTargets = new Map<string, string[]>();
  // Conectores con vista previa propia durante el gesto local y matriz de cada gesto por clave.
  private gestureRoutes: string[] = [];
  private readonly gestureKeyOf = new Map<string, string>();
  private readonly gestureMatrices = new Map<string, Mat>();
  private cameraTimer: unknown = null;
  private readonly inSink = new Set<string>();
  private inView = new Set<string>();
  private queryRect: AABB | null = null;
  private queryZoom = 0;
  private readonly pendingSpatial = new Map<string, AABB | null>();
  private overrides = new Map<string, ViewOverride>();
  // Poses de la reproducción y nodos cuya vista previa es ahora la de la animación (un gesto tiene prioridad).
  private animPoses: ReadonlyMap<string, ViewOverride> = new Map();
  private readonly animOwned = new Set<string>();
  private overridesDirty = false;
  private overlayDirty = true;
  private remoteDirty = true;
  private cursorsAnimating = false;
  private pageDirty = true;
  private lastCameraVersion = -1;
  // Contenedores cuyo gesto mueve a todos sus hijos (la capa de dibujo los lleva dentro), y conectores hijos de
  // uno de ellos que se recalculan aparte: clave del gesto que los lleva.
  private readonly carriers = new Map<string, string>();
  private readonly carriedRoutes = new Map<string, string>();
  // Caja derivada de cada grupo, en su propio giro; se vacía cuando cambian los registros.
  private readonly groupBoxes = new Map<string, Point[]>();
  private readonly cursors = new CursorInterpolator();
  private readonly stats = new Set<(stats: FrameStats) => void>();
  private destroyed = false;
  private syncing = false;
  private needsRender = true;
  private lastGesture: GesturePreview | null = null;
  // Algo distinto del propio gesto cambió las vistas previas (documento, presencia, estilo): hay que rehacerlas.
  private overridesStale = true;
  private selectionVersion = 0;
  private recordsVersion = 0;
  // Animaciones propuestas por la IA en vista previa: el reproductor y el timeline las usan en lugar de las del
  // documento para esos nodos, sin escribirlas.
  readonly aiAnimations = new Store<ReadonlyMap<string, Animation> | null>(null);
  // Plan del asistente en vista previa y con qué registros y zoom se dibujó por última vez.
  private aiPlan: AssistantPlan | null = null;
  private aiPreviewKey = '';
  private lastFollowTime = 0;
  private lastSelectionKey: string | null = null;
  // Trabajo de modelo hecho fuera del frame (desde comandos): se suma a las estadísticas del siguiente.
  private flushTime = 0;
  private syncTime = 0;
  private changedSinceFrame = 0;
  // Hubo transacciones locales desde la última sincronización: sus conectores se recalculan en el acto.
  private localChanges = false;
  // Nodos cambiados por otros clientes cuyos conectores se recalculan en el frame siguiente, para no sumar ese
  // trabajo al del frame que aplica el update.
  private readonly deferredConnectors = new Set<string>();
  // Vista previa de cada conector durante un gesto y extremos fijos ya calculados (se vacían si cambia el documento).
  private readonly previewRecords = new Map<string, { source: NodeRecord; record: ConnectorRecord }>();
  private readonly fixedTerminals = { from: new Map<string, CachedTerminal>(), to: new Map<string, CachedTerminal>() };

  gesture: GesturePreview | null = null;
  stylePreview: { ids: readonly string[]; patch: Partial<Record<string, unknown>> } | null = null;
  creating: SceneRecord | null = null;
  hover: string | null = null;
  marquee: Box | null = null;
  snapGuides: OverlayModel['guides'] = [];

  constructor(options: CoreOptions) {
    this.backend = options.backend;
    this.sink = options.sink;
    this.user = options.user;
    this.readOnly = new Store(options.readOnly ?? false);
    this.timers = options.timers ?? realTimers;
    this.dpr = options.dpr ?? 1;
    this.scheduler = new FrameScheduler((time) => this.frame(time), options.raf, options.caf);
    this.store = new DocumentStore(
      () => this.requestFrame(),
      () => this.timers.now(),
    );
    this.writer = new DocWriter(this.backend, this.store, () => this.selection.get(), () => {
      this.localChanges = true;
    });
    this.tree = new SceneTree(this.store);
    this.camera.resize(options.screen.width, options.screen.height);
    if (options.camera) this.camera.set(options.camera);
    this.textZoom = this.camera.zoom;
    this.textTarget = textResolution(this.camera.zoom, this.dpr);
    // El lote full se aplica antes de leer nada; createEngine espera backend.ready.
    this.detachBackend = this.backend.attach({ apply: (batch) => this.applyBatch(batch), wake: () => this.requestFrame(), pong: () => this.onPong() });
    if (this.drainBackend() === 0) throw new Error('El documento aún no está listo');
    // Lo leído aquí se lleva a la capa de dibujo en el primer frame (pageDirty).
    this.store.flush();
    const pages = this.store.pages();
    this.pages.set(pages);
    const initialPage = options.pageId && pages.some((p) => p.id === options.pageId) ? options.pageId : (pages[0]?.id ?? null);
    this.pageId = new Store<string | null>(initialPage);
    this.presence = new Presence((state) => this.backend.send({ t: 'presence', state }), options.user, initialPage ?? '', this.timers);
    this.presence.onRemoteChange(() => {
      this.remoteDirty = true;
      this.overridesDirty = true;
      this.overridesStale = true;
      this.requestFrame();
    });
    for (const delta of this.earlyPresence) this.presence.receive(delta);
    this.earlyPresence = [];
    this.anim = new AnimationPlayer({
      animations: () => this.playerAnimations(),
      record: (id) => this.store.get(id),
      page: () => this.pageId.get(),
      worldMatrix: (record) => this.tree.worldMatrix(record),
      parentWorld: (id) => this.tree.parentWorld(this.tree.parent(id)),
      descendants: (id) => this.tree.descendants(id),
      apply: (poses) => this.applyAnimationPoses(poses),
      playingChanged: () => this.animationPlayingChanged(),
      keepAlive: (active) => this.scheduler.keepAlive('anim', active),
      requestFrame: () => this.requestFrame(),
    });
    this.commands = new Commands(this);
    this.controller = new PointerController(this);
    this.readOnly.subscribe((readOnly) => {
      if (readOnly && EDIT_TOOLS.has(this.tool.get())) this.tool.set('select');
      if (readOnly) this.controller.cancel();
      if (readOnly) this.stopTextEdit();
      this.overlayDirty = true;
      this.requestFrame();
    });
    this.lastAlive = this.timers.now();
    this.armWatchdog();
    this.requestFrame();
  }

  // ── Documento ────────────────────────────────────────────────────────────────

  // Aplica los lotes en cola; no es reentrante. Su tiempo cuenta como fase apply.
  private drainBackend(): number {
    if (this.draining || !this.backend.queued) return 0;
    this.draining = true;
    const started = performance.now();
    try {
      return this.backend.drain();
    } finally {
      this.draining = false;
      this.applyTime += performance.now() - started + this.backend.takeReadMs();
    }
  }

  private applyBatch(batch: DocBatch): void {
    this.store.applyBatch(batch);
    if (batch.local) this.localChanges = true;
    if (batch.history) this.historyState.set(batch.history);
    if (batch.restoreSelection) this.restoreOut = batch.restoreSelection;
    if (batch.synced !== undefined) this.syncedOut = batch.synced;
    if (batch.presence) {
      if (this.presence) this.presence.receive(batch.presence);
      else this.earlyPresence.push(batch.presence);
    }
    if (batch.text) for (const listener of this.textListeners) listener(batch.text, batch.applied);
    if (batch.full || batch.applied) this.lastAlive = this.timers.now();
  }

  // Estado de la sesión de texto abierta, con el seq hasta el que el host procesó.
  onTextState(listener: (state: TextSessionState, applied: number) => void): () => void {
    this.textListeners.add(listener);
    return () => this.textListeners.delete(listener);
  }

  // Lo que un lote deja para después de sincronizar el árbol: el encuadre de la sincronización y la selección de
  // un deshacer ven los registros ya pintados.
  private deliverAfterSync(): void {
    const restore = this.restoreOut;
    this.restoreOut = null;
    if (restore) this.setSelection(restore);
    const synced = this.syncedOut;
    this.syncedOut = undefined;
    if (synced !== undefined) this.backend.synced(synced);
  }

  // Un host que no acusa en ACK_TIMEOUT_MS puede estar solo retrasado (equipo suspendido, hilo principal ocupado):
  // se vacía la cola y se le pregunta; solo si no contesta se da por caído.
  private checkWatchdog(): void {
    if (this.destroyed) return;
    const now = this.timers.now();
    if (this.pingAt !== null) {
      if (now - this.pingAt > PONG_TIMEOUT_MS) {
        this.pingAt = null;
        this.backend.crash('El documento dejó de responder');
      }
      return;
    }
    const since = this.store.pendingSince();
    if (since === null || now - Math.max(since, this.lastAlive) <= ACK_TIMEOUT_MS) return;
    this.drainBackend();
    this.syncModel();
    const still = this.store.pendingSince();
    if (still === null) return;
    this.pingAt = now;
    this.backend.send({ t: 'ping', id: ++this.pingId });
  }

  private onPong(): void {
    this.pingAt = null;
    this.lastAlive = this.timers.now();
  }

  private armWatchdog(): void {
    this.watchdogTimer = this.timers.setTimeout(() => {
      this.watchdogTimer = null;
      if (this.destroyed) return;
      this.checkWatchdog();
      this.armWatchdog();
    }, WATCHDOG_INTERVAL_MS);
  }

  requestFrame(): void {
    // Lo que se aplica al principio del frame se pinta en ese mismo frame: no hace falta otro.
    if (!this.destroyed && !this.draining) this.scheduler.requestFrame();
  }

  // Algo de la capa de dibujo cambió sin pasar por el documento (p. ej. cargó una fuente).
  invalidate(): void {
    this.needsRender = true;
    this.requestFrame();
  }

  onFrame(listener: (stats: FrameStats) => void): () => void {
    this.stats.add(listener);
    return () => this.stats.delete(listener);
  }

  get activePage(): string | null {
    return this.pageId.get();
  }

  resize(width: number, height: number): void {
    this.camera.resize(width, height);
    this.requestFrame();
  }

  setPage(pageId: string): void {
    if (pageId === this.pageId.get() || !this.store.pages().some((page) => page.id === pageId)) return;
    this.pageId.set(pageId);
    this.setSelection([]);
    this.pageDirty = true;
    this.presence.update({ pageId });
    this.requestFrame();
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly.set(readOnly);
  }

  // ── Frame ────────────────────────────────────────────────────────────────────

  // Fases 1 y 2: lleva los cambios del documento al store, al árbol y a las vistas. Los comandos y la selección
  // la llaman antes de leer, para no trabajar con registros de antes de su propia transacción.
  syncModel(): void {
    if (this.destroyed || this.syncing) return;
    // Los comandos leen lo último confirmado: los lotes en cola se aplican antes del flush.
    this.drainBackend();
    if (!this.store.hasPending && !this.pageDirty) {
      this.deliverAfterSync();
      return;
    }
    this.syncing = true;
    try {
      const started = performance.now();
      const flush = this.store.flush();
      this.flushTime += performance.now() - started;
      if (flush.changes.length) {
        this.fixedTerminals.from.clear();
        this.fixedTerminals.to.clear();
        this.previewRecords.clear();
      }
      if (flush.pagesChanged) {
        this.pages.set(this.store.pages());
        this.ensurePage();
      }
      if (flush.metaChanged) {
        const meta = this.store.meta();
        if (meta) this.sink.setBackground(meta.background);
      }
      if (flush.changes.length || flush.animationsChanged) this.anim.invalidate(flush.animationsChanged || flush.structural);
      if (flush.animationsChanged) this.animationsVersion.set(this.animationsVersion.get() + 1);

      let orderChanged = false;
      let count = 0;
      if (this.pageDirty) {
        this.reloadPage();
        orderChanged = true;
      } else if (flush.changes.length) {
        if (flush.structural) {
          this.tree.rebuild();
          orderChanged = true;
        }
        const containers = flush.changes.filter((change) => isContainer(change.prev) || isContainer(change.next));
        if (containers.length) {
          // Lo que cuelga de un contenedor que cambia también cambia de matriz o de visibilidad, y con ello los
          // conectores anclados a cualquiera de esos nodos.
          this.tree.invalidateContainers();
          const touched = new Map<string, boolean>();
          for (const change of flush.changes) touched.set(change.id, change.fast);
          for (const change of containers) {
            for (const id of this.tree.dependents(change.id)) if (!touched.has(id)) touched.set(id, true);
          }
          for (const [id, fast] of touched) this.syncNode(id, true, fast);
          count = touched.size;
          if (this.connectorsByNode.size) count += this.connectorsAfter([...touched.keys()].map((id) => ({ id })));
        } else {
          // Las claves de la ruta rápida (posición, giro, opacidad, visibilidad, bloqueo) no cambian el dibujo.
          for (const change of flush.changes) this.syncNode(change.id, true, change.fast, change.fast);
          count = flush.changes.length;
          // Los conectores de un nodo que cambió de caja (o que desapareció) se recalculan.
          if (this.connectorsByNode.size) count += this.connectorsAfter(flush.changes);
        }
      }
      this.localChanges = false;
      this.changedSinceFrame += count;

      if (orderChanged) this.pushOrder();
      if (orderChanged || flush.changes.some((change) => change.layer)) this.layersVersion.set(this.layersVersion.get() + 1);
      if (flush.changes.length || orderChanged) this.afterRecordsChanged(flush.changes);
      if (flush.changes.length || orderChanged || flush.pagesChanged || flush.metaChanged) this.needsRender = true;
      this.syncTime += performance.now() - started;
    } finally {
      this.syncing = false;
    }
    this.deliverAfterSync();
  }

  frame(time: number = performance.now()): void {
    if (this.destroyed) return;
    this.drainBackend();
    const applyTime = this.applyTime;
    this.applyTime = 0;
    // Los conectores que dejó pendientes el update remoto del frame anterior.
    if (this.deferredConnectors.size) {
      const started = performance.now();
      this.changedSinceFrame += this.syncDeferredConnectors();
      this.needsRender = true;
      this.syncTime += performance.now() - started;
    }
    this.syncModel();
    if (this.pingAt === null && this.store.pendingSince() !== null) this.checkWatchdog();
    if (this.deferredConnectors.size) this.scheduler.requestFrame();
    const synced = performance.now();
    const flushTime = this.flushTime;
    const syncTime = this.syncTime;
    const changed = this.changedSinceFrame;
    this.flushTime = 0;
    this.syncTime = 0;
    this.changedSinceFrame = 0;

    this.controller.flush();
    if (this.following.get() !== null) this.stepFollow(time);
    if (this.overridesDirty) {
      this.updateOverrides();
      this.needsRender = true;
    }
    this.anim.frame(time);
    const interacted = performance.now();

    // La cámara llega a la capa de dibujo antes del culling: las imágenes que entran eligen su variante con el zoom nuevo.
    if (this.camera.version !== this.lastCameraVersion) {
      this.lastCameraVersion = this.camera.version;
      this.sink.setCamera(this.camera.state());
      this.zoom.set(this.camera.zoom);
      this.presence.update({ viewport: this.camera.state() });
      this.overlayDirty = true;
      this.remoteDirty = true;
      this.needsRender = true;
      this.scheduleCameraSettle();
    }
    const rebuilt = this.spatial.update(this.pendingSpatial);
    if (this.cull(this.pendingSpatial.keys(), rebuilt)) this.needsRender = true;
    this.pendingSpatial.clear();
    const culled = performance.now();
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.sink.drawOverlay(this.overlayModel());
      this.needsRender = true;
    }
    if (this.drawAiPreview()) this.needsRender = true;
    // Tras la interpolación se dibuja un frame más con el cursor en su destino y se suelta el keeper.
    if (this.remoteDirty || this.cursorsAnimating || this.cursors.animating(time)) {
      this.remoteDirty = false;
      this.sink.drawRemote(this.remoteModel(time), this.camera.state());
      this.needsRender = true;
    }
    this.cursorsAnimating = this.cursors.animating(time);
    this.scheduler.keepAlive('cursors', this.cursorsAnimating);
    this.updateTextResolution();
    if (this.sink.flushAssets()) this.needsRender = true;

    // Un frame sin cambios visibles (p. ej. el puntero se mueve sin cambiar el hover) no renderiza.
    if (!this.needsRender) return;
    this.needsRender = false;
    const ended = performance.now();
    // Incluye la sincronización hecha antes desde un comando en este mismo intervalo.
    const work = ended - synced + syncTime + applyTime;
    this.sink.render();
    const render = performance.now() - ended;
    if (this.stats.size) {
      const stats: FrameStats = {
        time,
        work,
        render,
        changed,
        phases: { apply: applyTime, flush: flushTime, sync: syncTime - flushTime, interact: interacted - synced, spatial: culled - interacted, overlay: ended - culled },
      };
      for (const listener of this.stats) listener(stats);
    }
  }

  // El nivel de detalle de las imágenes se decide al terminar el zoom o el pan, no durante el gesto.
  private scheduleCameraSettle(): void {
    if (this.cameraTimer !== null) this.timers.clearTimeout(this.cameraTimer);
    this.cameraTimer = this.timers.setTimeout(() => {
      this.cameraTimer = null;
      if (this.destroyed) return;
      this.sink.settleCamera(this.camera.state());
    }, CAMERA_SETTLE_MS);
  }

  // La resolución del texto sigue al zoom 200 ms después del último cambio, de 20 textos en 20 por frame.
  private updateTextResolution(): void {
    const zoom = this.camera.zoom;
    if (zoom !== this.textZoom) {
      this.textZoom = zoom;
      if (this.textTimer !== null) this.timers.clearTimeout(this.textTimer);
      this.textTimer = this.timers.setTimeout(() => {
        this.textTimer = null;
        this.textTarget = textResolution(this.camera.zoom, this.dpr);
        this.requestFrame();
      }, TEXT_ZOOM_SETTLE_MS);
    }
    const refresh = this.sink.refreshText(this.textTarget, TEXT_REFRESH_PER_FRAME);
    if (refresh.changed > 0) this.needsRender = true;
    this.scheduler.keepAlive('text', refresh.remaining > 0);
  }

  private ensurePage(): void {
    const pages = this.store.pages();
    const current = this.pageId.get();
    if (current && pages.some((page) => page.id === current)) return;
    const next = pages[0]?.id ?? null;
    if (next !== current) {
      this.pageId.set(next);
      if (next) this.presence.update({ pageId: next });
      this.pageDirty = true;
    }
  }

  private readonly parentOf = (id: string) => this.tree.parent(id);

  private pushOrder(extra?: string): void {
    const page = this.pageId.get();
    const order = page ? this.tree.paintOrder(page) : [];
    this.sink.setOrder(extra ? [...order, extra] : order, this.parentOf);
  }

  private reloadPage(): void {
    this.pageDirty = false;
    this.anim.stop();
    this.animOwned.clear();
    for (const id of this.inSink) this.sink.remove(id);
    this.inSink.clear();
    this.geom.clear();
    this.bases.clear();
    this.routes.clear();
    this.connectorsByNode.clear();
    this.connectorTargets.clear();
    this.deferredConnectors.clear();
    this.inView.clear();
    this.queryRect = null;
    this.overrides.clear();
    this.overridesStale = true;
    this.tree.rebuild();
    const entries: Array<[string, AABB]> = [];
    for (const record of this.store.all()) {
      const box = this.syncNode(record.id, false);
      if (box) entries.push([record.id, box]);
    }
    this.pendingSpatial.clear();
    this.spatial.load(entries);
    this.nodeCount.set(this.inSink.size);
  }

  // Lleva un nodo del store a la capa de dibujo y anota su caja para el índice espacial.
  // translate: solo cambiaron claves rápidas y el padre sigue igual; si el giro tampoco cambió, la matriz y las cajas
  // se desplazan desde las de la última vez que se calcularon enteras.
  private syncNode(id: string, queueSpatial = true, sameDrawing = false, translate = false): AABB | null {
    const record = this.store.get(id);
    const page = this.pageId.get();
    if (!record || record.pageId !== page || !(isRenderable(record) || isContainer(record))) {
      if (this.inSink.delete(id)) this.sink.remove(id);
      this.geom.delete(id);
      this.bases.delete(id);
      if (this.connectorTargets.has(id) || this.routes.has(id)) this.indexConnector(id, null);
      if (!record) this.lastEnds.delete(id);
      if (queueSpatial) this.pendingSpatial.set(id, null);
      return null;
    }
    // Dentro de un contenedor oculto, el nodo tampoco se ve ni se puede tocar.
    const parentId = this.tree.parent(id);
    const visible = record.visible && (parentId === null || !this.tree.hiddenAbove(id));
    if (isContainer(record)) {
      if (this.connectorTargets.has(id)) this.indexConnector(id, null);
      const world = this.tree.worldMatrix(record);
      this.sink.upsert(id, record, world, visible, sameDrawing);
      this.inSink.add(id);
      // La caja de un grupo es la de sus hijos: no se guarda ni entra en el índice espacial.
      if (record.type === 'group') {
        this.geom.delete(id);
        return null;
      }
      const geometry = geometryAABB(record, world);
      this.geom.set(id, geometry);
      const painted = visible ? geometry : null;
      if (queueSpatial) this.pendingSpatial.set(id, painted);
      return painted;
    }
    let drawn: RenderableRecord = record;
    let world: Mat;
    let geometry: AABB;
    if (record.type === 'connector') {
      // El conector se dibuja en mundo: su recorrido depende de las cajas de los nodos de sus extremos.
      const route = this.computeRoute(record);
      this.routes.set(id, route);
      this.lastEnds.set(id, { from: routeStart(route), to: routeEnd(route) });
      this.indexConnector(id, record);
      drawn = { ...record, path: route };
      world = [...IDENTITY] as Mat;
      geometry = transformedAABB(route, IDENTITY);
    } else {
      if (this.connectorTargets.has(id)) this.indexConnector(id, null);
      const base = translate ? this.bases.get(id) : undefined;
      if (base && base.rotation === record.rotation) {
        // Con base, el nodo ya está en la capa de dibujo.
        const moved = translatedPlacement(base, record, this.tree.parentWorld(parentId));
        this.sink.upsert(id, record, moved.world, visible, sameDrawing, hasTextContent(record) ? this.store.text(id) : '');
        this.geom.set(id, moved.geometry);
        const painted = visible ? moved.painted : null;
        if (queueSpatial) this.pendingSpatial.set(id, painted);
        return painted;
      }
      world = this.tree.worldMatrix(record);
      geometry = geometryAABB(record, world);
      this.bases.set(id, { x: record.x, y: record.y, rotation: record.rotation, world, geometry, pad: paintPadding(record) });
    }
    this.sink.upsert(id, drawn, world, visible, sameDrawing && drawn === record, hasTextContent(record) ? this.store.text(id) : '');
    this.inSink.add(id);
    this.geom.set(id, geometry);
    const painted = visible ? paintedFromGeometry(record, geometry) : null;
    if (queueSpatial) this.pendingSpatial.set(id, painted);
    return painted;
  }

  // ── Conectores ───────────────────────────────────────────────────────────────

  private indexConnector(id: string, record: ConnectorRecord | null): void {
    const previous = this.connectorTargets.get(id);
    const next: string[] = [];
    if (record) {
      for (const end of [record.from, record.to]) if ('nodeId' in end && !next.includes(end.nodeId)) next.push(end.nodeId);
    }
    if (previous && previous.length === next.length && previous.every((target, i) => target === next[i])) return;
    for (const target of previous ?? []) {
      const set = this.connectorsByNode.get(target);
      set?.delete(id);
      if (set?.size === 0) this.connectorsByNode.delete(target);
    }
    if (!record) {
      this.connectorTargets.delete(id);
      this.routes.delete(id);
      return;
    }
    this.connectorTargets.set(id, next);
    for (const target of next) {
      let set = this.connectorsByNode.get(target);
      if (!set) this.connectorsByNode.set(target, (set = new Set()));
      set.add(id);
    }
  }

  // Con cambios propios, los conectores se recalculan ya. Si todo lo que llegó es de otros clientes, se dejan para
  // el frame siguiente; un conector que cambió él mismo ya se pintó con su syncNode.
  private connectorsAfter(changes: readonly { id: string }[]): number {
    if (this.localChanges) return this.syncConnectorsOf(changes);
    for (const change of changes) {
      const connectors = this.connectorsByNode.get(change.id);
      if (!connectors) continue;
      for (const connector of connectors) this.deferredConnectors.add(connector);
    }
    for (const change of changes) this.deferredConnectors.delete(change.id);
    return 0;
  }

  // Recalcula los conectores que quedaron pendientes de un update remoto. Devuelve cuántos.
  private syncDeferredConnectors(): number {
    if (!this.deferredConnectors.size) return 0;
    const ids = [...this.deferredConnectors];
    this.deferredConnectors.clear();
    let count = 0;
    for (const id of ids) {
      if (!this.store.get(id)) continue;
      this.syncNode(id);
      count++;
    }
    return count;
  }

  private syncConnectorsOf(changes: readonly { id: string }[]): number {
    let count = 0;
    const done = new Set<string>();
    for (const change of changes) done.add(change.id);
    for (const change of changes) {
      const connectors = this.connectorsByNode.get(change.id);
      if (!connectors) continue;
      for (const connector of connectors) {
        if (done.has(connector)) continue;
        done.add(connector);
        this.syncNode(connector);
        count++;
      }
    }
    return count;
  }

  // Conectores que usan `id` como extremo.
  connectorsOf(id: string): ReadonlySet<string> {
    return this.connectorsByNode.get(id) ?? new Set();
  }

  // Extremo en mundo. Un nodo de otra página, que ya no existe o que es otro conector deja el extremo colgando:
  // se pinta en el último punto calculado y, si no lo hay, en el que guarda la caja del conector.
  private terminalOf(record: ConnectorRecord, end: ConnectorEnd, which: 'from' | 'to', moving?: MovingLookup, replaced?: ReadonlyMap<string, NodeRecord>): Terminal {
    if ('nodeId' in end) {
      const target = replaced?.get(end.nodeId) ?? this.store.get(end.nodeId);
      if (target && target.id !== record.id && target.pageId === record.pageId && isAnchorable(target)) {
        const matrix = moving?.(target.id);
        // Durante un gesto, el extremo sin gesto da siempre el mismo punto hasta que cambie el documento, y el que
        // se traslada, ese mismo punto desplazado.
        const cache = moving && !replaced && (!matrix || isTranslation(matrix)) ? this.fixedTerminals[which] : null;
        const cached = cache?.get(record.id);
        let terminal: Terminal;
        if (cached && cached.target === target && cached.anchor === end.anchor) terminal = cached.terminal;
        else if (cache) {
          terminal = anchorTerminal(this.tree.worldMatrix(target), target.w, target.h, end.anchor);
          cache.set(record.id, { target, anchor: end.anchor, terminal });
        } else {
          let world = this.tree.worldMatrix(target);
          if (matrix) world = multiply(matrix, world);
          return anchorTerminal(world, target.w, target.h, end.anchor);
        }
        return matrix ? translateTerminal(terminal, matrix[4], matrix[5]) : terminal;
      }
      const last = this.lastEnds.get(record.id);
      if (last) {
        const p = last[which];
        const matrix = moving?.(record.id);
        return matrix ? { ...apply(matrix, p.x, p.y), dir: null } : { x: p.x, y: p.y, dir: null };
      }
      const point = endpointsFromBox(record)[which];
      return this.freeTerminal(record, point, moving);
    }
    return this.freeTerminal(record, end, moving);
  }

  // Los extremos libres están en el sistema del padre del conector.
  private freeTerminal(record: ConnectorRecord, point: Point, moving?: MovingLookup): Terminal {
    const parent = this.tree.parentWorld(this.tree.parent(record.id));
    let p = parent ? apply(parent, point.x, point.y) : { x: point.x, y: point.y };
    const matrix = moving?.(record.id);
    if (matrix) p = apply(matrix, p.x, p.y);
    return { x: p.x, y: p.y, dir: null };
  }

  // `replaced`: nodos con la caja que van a tener, antes de que el cambio llegue al store.
  computeRoute(record: ConnectorRecord, moving?: MovingLookup, replaced?: ReadonlyMap<string, NodeRecord>): number[] {
    return routePoints(
      this.terminalOf(record, record.from, 'from', moving, replaced),
      this.terminalOf(record, record.to, 'to', moving, replaced),
      record.route,
    );
  }

  // Recorrido de un conector tal como se pinta ahora mismo (con la vista previa de un gesto si la hay).
  routeOf(id: string): readonly number[] | null {
    const override = this.overrides.get(id);
    if (override?.record.type === 'connector' && override.redraw && override.record.path) return override.record.path;
    return this.routes.get(id) ?? null;
  }

  // Extremos de un conector en el sistema de su padre, como los guardan los extremos libres.
  connectorEndpoints(id: string, moving?: MovingLookup): { from: Point; to: Point } | null {
    const record = this.store.get(id);
    if (record?.type !== 'connector') return null;
    const route = moving ? this.computeRoute(record, moving) : (this.routes.get(id) ?? this.computeRoute(record));
    const parent = this.tree.parentWorld(this.tree.parent(id));
    const back = parent ? invert(parent) : null;
    const local = (p: Point) => (back ? apply(back, p.x, p.y) : p);
    return { from: local(routeStart(route)), to: local(routeEnd(route)) };
  }

  // Registro tal como lo recibe la capa de dibujo: los conectores llevan su recorrido.
  drawnRecord(record: RenderableRecord): RenderableRecord {
    if (record.type !== 'connector' || record.path) return record;
    return { ...record, path: this.routes.get(record.id) ?? this.computeRoute(record) };
  }

  // Matriz con la que se dibuja la vista: la identidad en los conectores, que se dibujan en mundo.
  viewMatrix(record: NodeRecord): Mat {
    return record.type === 'connector' ? ([...IDENTITY] as Mat) : this.tree.worldMatrix(record);
  }

  // Puntos de mundo que describen un nodo (las esquinas de su caja, los puntos de una línea o el recorrido de un
  // conector, ida y vuelta para que el contorno cerrado no añada un lado).
  private worldOutline(record: NodeRecord, matrix?: Readonly<Mat>): number[] {
    if (record.type === 'group') {
      const corners = this.groupCorners(record);
      const out: number[] = [];
      for (const p of corners) {
        const q = matrix ? apply(matrix, p.x, p.y) : p;
        out.push(q.x, q.y);
      }
      return out;
    }
    if (record.type === 'connector') {
      const route = this.routeOf(record.id) ?? [];
      const out: number[] = [];
      for (let i = 0; i < route.length; i += 2) {
        const p = matrix ? apply(matrix, route[i]!, route[i + 1]!) : { x: route[i]!, y: route[i + 1]! };
        out.push(p.x, p.y);
      }
      for (let i = out.length - 4; i >= 2; i -= 2) out.push(out[i]!, out[i + 1]!);
      return out;
    }
    const world = matrix ? multiply(matrix, this.tree.worldMatrix(record)) : this.tree.worldMatrix(record);
    const points = record.type === 'line' ? record.points.flat() : localPoints(record);
    const out: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      const p = apply(world, points[i]!, points[i + 1]!);
      out.push(p.x, p.y);
    }
    return out;
  }

  // Caja de un grupo: la que envuelve a sus descendientes, girada como el grupo. Se calcula al pedirla.
  private groupCorners(record: NodeRecord): Point[] {
    const cached = this.groupBoxes.get(record.id);
    if (cached) return cached;
    const angle = this.worldAngle(record);
    const back = rotation(-angle);
    const box = emptyAABB();
    for (const id of this.tree.descendants(record.id)) {
      const child = this.store.get(id);
      if (!child || child.type === 'group' || !this.inSink.has(id)) continue;
      const points = this.worldOutline(child, back);
      for (let i = 0; i < points.length; i += 2) {
        if (points[i]! < box.minX) box.minX = points[i]!;
        if (points[i]! > box.maxX) box.maxX = points[i]!;
        if (points[i + 1]! < box.minY) box.minY = points[i + 1]!;
        if (points[i + 1]! > box.maxY) box.maxY = points[i + 1]!;
      }
    }
    let corners: Point[];
    if (isEmptyAABB(box)) {
      const origin = apply(this.tree.worldMatrix(record), 0, 0);
      corners = [origin, origin, origin, origin];
    } else {
      const forward = rotation(angle);
      corners = [
        apply(forward, box.minX, box.minY),
        apply(forward, box.maxX, box.minY),
        apply(forward, box.maxX, box.maxY),
        apply(forward, box.minX, box.maxY),
      ];
    }
    this.groupBoxes.set(record.id, corners);
    return corners;
  }

  private afterRecordsChanged(changes: readonly { id: string }[] = []): void {
    this.recordsVersion++;
    this.groupBoxes.clear();
    this.overridesStale = true;
    this.nodeCount.set(this.inSink.size);
    const current = this.selection.get();
    const alive = current.filter((id) => this.inSink.has(id));
    if (alive.length !== current.length) this.setSelection(alive);
    else this.refreshSelectionRecords(this.touchesSelection(current, changes));
    const editing = this.editingText.get();
    if (editing) {
      const record = this.store.get(editing.id);
      if (!this.inSink.has(editing.id) || !record || record.locked) this.stopTextEdit();
    }
    this.overlayDirty = true;
    this.overridesDirty = true;
    this.remoteDirty = true;
  }

  // Los registros se parchean en sitio: si cambió uno seleccionado, la lista se avisa aunque tenga los mismos objetos.
  private touchesSelection(selection: readonly string[], changes: readonly { id: string }[]): boolean {
    if (!selection.length || !changes.length) return false;
    if (selection.length === 1) return changes.some((change) => change.id === selection[0]);
    const ids = new Set(selection);
    return changes.some((change) => ids.has(change.id));
  }

  // Devuelve si algún nodo entró o salió del viewport ampliado.
  private cull(changed: Iterable<string>, rebuilt: boolean): boolean {
    const viewport = this.camera.viewport();
    const zoomShift = this.queryZoom === 0 ? Infinity : Math.abs(Math.log(this.camera.zoom / this.queryZoom));
    if (!this.queryRect || rebuilt || !containsAABB(this.queryRect, viewport) || zoomShift > Math.log(2)) {
      const mx = (viewport.maxX - viewport.minX) * VIEWPORT_MARGIN;
      const my = (viewport.maxY - viewport.minY) * VIEWPORT_MARGIN;
      this.queryRect = { minX: viewport.minX - mx, minY: viewport.minY - my, maxX: viewport.maxX + mx, maxY: viewport.maxY + my };
      this.queryZoom = this.camera.zoom;
      const next = new Set(this.spatial.search(this.queryRect));
      const enter: string[] = [];
      const leave: string[] = [];
      for (const id of next) if (!this.inView.has(id)) enter.push(id);
      for (const id of this.inView) if (!next.has(id)) leave.push(id);
      this.inView = next;
      if (enter.length || leave.length) this.sink.setInView(enter, leave);
      return enter.length + leave.length > 0;
    }
    const enter: string[] = [];
    const leave: string[] = [];
    for (const id of changed) {
      const box = this.spatial.get(id);
      const visible = box ? intersects(box, this.queryRect) : false;
      if (visible && !this.inView.has(id)) {
        this.inView.add(id);
        enter.push(id);
      } else if (!visible && this.inView.has(id)) {
        this.inView.delete(id);
        leave.push(id);
      }
    }
    if (enter.length || leave.length) this.sink.setInView(enter, leave);
    return enter.length + leave.length > 0;
  }

  // ── Selección ────────────────────────────────────────────────────────────────

  setSelection(ids: readonly string[]): void {
    this.syncModel();
    const present = new Set(ids.filter((id) => this.inSink.has(id)));
    // Con un contenedor seleccionado, sus descendientes ya van con él.
    const unique = [...present].filter((id) => {
      for (let parent = this.tree.parent(id); parent; parent = this.tree.parent(parent)) if (present.has(parent)) return false;
      return true;
    });
    if (this.scope && (unique.length === 0 || unique.some((id) => !this.tree.isDescendant(id, this.scope!)))) this.scope = null;
    this.selectionVersion++;
    this.selection.set(unique);
    this.refreshSelectionRecords();
    const box = unique.length ? this.boundsOf(unique) : null;
    this.presence.setSelection(unique, box && !isEmptyAABB(box) ? { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY } : null);
    this.overlayDirty = true;
    this.requestFrame();
  }

  private refreshSelectionRecords(force = false): void {
    const records: NodeRecord[] = [];
    for (const id of this.selection.get()) {
      const record = this.store.get(id);
      if (record) records.push(record);
    }
    this.selectionRecords.set(records, force);
  }

  // ── Edición de texto ─────────────────────────────────────────────────────────

  // Abre el editor DOM sobre un texto o sobre el texto interior de una forma.
  startTextEdit(id: string): boolean {
    if (this.readOnly.get()) return false;
    const record = this.renderable(id);
    if (!record || !hasTextContent(record) || record.locked || this.anim.blocks(id)) return false;
    const current = this.editingText.get();
    if (current?.id === id) return true;
    if (current) this.stopTextEdit();
    this.controller.cancel();
    if (!this.commands.ensureText(id)) return false;
    this.setSelection([id]);
    // El editor de texto abre su sesión con esta selección: el host corta ahí el paso de deshacer.
    this.editingText.set({ id, kind: hasLabel(record) ? 'label' : 'text' });
    this.sink.setEditing(id);
    this.overlayDirty = true;
    this.requestFrame();
    return true;
  }

  // Confirma la edición. Un texto que queda vacío se borra; una forma solo pierde su texto interior.
  stopTextEdit(): void {
    const current = this.editingText.get();
    if (!current) return;
    this.editingText.set(null);
    this.sink.setEditing(null);
    this.commands.discardEmptyText(current.id);
    this.overlayDirty = true;
    this.requestFrame();
  }

  isSelected(id: string): boolean {
    return this.selection.get().includes(id);
  }

  // Lectura para comandos: antes se aplica lo pendiente del documento (incluida la transacción propia anterior).
  record(id: string): NodeRecord | undefined {
    this.syncModel();
    return this.store.get(id);
  }

  renderable(id: string): RenderableRecord | undefined {
    this.syncModel();
    const record = this.store.get(id);
    return record && isRenderable(record) && this.inSink.has(id) ? record : undefined;
  }

  geometryOf(id: string): AABB | undefined {
    const own = this.geom.get(id);
    if (own) return own;
    const record = this.store.get(id);
    if (record?.type !== 'group' || !this.inSink.has(id)) return undefined;
    const box = emptyAABB();
    for (const p of this.groupCorners(record)) {
      box.minX = Math.min(box.minX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x);
      box.maxY = Math.max(box.maxY, p.y);
    }
    return box;
  }

  boundsOf(ids: Iterable<string>): AABB {
    const box = emptyAABB();
    for (const id of ids) {
      const item = this.geometryOf(id);
      if (item) unionAABB(box, item);
    }
    return box;
  }

  pageBounds(): AABB | null {
    const box = this.boundsOf(this.inSink);
    return isEmptyAABB(box) ? null : box;
  }

  worldMatrix(record: NodeRecord): Mat {
    return this.tree.worldMatrix(record);
  }

  worldAngle(record: NodeRecord): number {
    let angle = record.rotation;
    let parent = this.tree.parent(record.id);
    while (parent) {
      const node = this.store.get(parent);
      if (!node) break;
      angle += node.rotation;
      parent = this.tree.parent(parent);
    }
    return angle;
  }

  // Caja de la selección: girada si todos los nodos comparten ángulo, alineada a los ejes si no.
  selectionFrame(ids: readonly string[] = this.selection.get()): SelectionFrame | null {
    const records = ids.map((id) => this.store.get(id)).filter((r): r is NodeRecord => !!r);
    if (records.length === 0) return null;
    const first = this.worldAngle(records[0]!);
    const angle = records.every((record) => Math.abs(this.worldAngle(record) - first) < 1e-6) ? first : 0;
    const back = rotation(-angle);
    const box = emptyAABB();
    for (const record of records) {
      const points = this.worldOutline(record, back);
      for (let i = 0; i < points.length; i += 2) {
        const p = { x: points[i]!, y: points[i + 1]! };
        box.minX = Math.min(box.minX, p.x);
        box.minY = Math.min(box.minY, p.y);
        box.maxX = Math.max(box.maxX, p.x);
        box.maxY = Math.max(box.maxY, p.y);
      }
    }
    const origin = apply(rotation(angle), box.minX, box.minY);
    return { x: origin.x, y: origin.y, w: box.maxX - box.minX, h: box.maxY - box.minY, angle };
  }

  screenCorners(frame: SelectionFrame, matrix?: Readonly<Mat>): [Point, Point, Point, Point] {
    return frameCorners(frame, matrix).map((p) => this.camera.worldToScreen(p.x, p.y)) as [Point, Point, Point, Point];
  }

  // Nodo de más arriba bajo un punto de pantalla. Los bloqueados solo cuentan con Alt.
  hitTest(sx: number, sy: number, options: { includeLocked?: boolean; exclude?: ReadonlySet<string>; skipConnectors?: boolean } = {}): string | null {
    const world = this.camera.screenToWorld(sx, sy);
    const tolerance = HIT_TOLERANCE_PX / this.camera.zoom;
    const page = this.pageId.get();
    if (!page) return null;
    const candidates = this.spatial.searchPoint(world.x, world.y, tolerance);
    if (candidates.length === 0) return null;
    const order = this.tree.paintOrder(page);
    const rank = new Map<string, number>();
    if (candidates.length > 1) order.forEach((id, i) => rank.set(id, i));
    candidates.sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));
    for (const id of candidates) {
      const record = this.store.get(id);
      if (!record || !record.visible) continue;
      if ((record.locked || this.tree.lockedAbove(id)) && !options.includeLocked) continue;
      if (options.exclude?.has(id) || (options.skipConnectors && record.type === 'connector')) continue;
      if (this.clippedOut(id, world.x, world.y)) continue;
      const target = record.type === 'connector' ? { ...record, path: this.routes.get(id) ?? [] } : record;
      if (hitRecord(target, this.tree.worldMatrix(record), world.x, world.y, tolerance)) return id;
    }
    return null;
  }

  // Lo que queda fuera de un frame con recorte no se ve y no se puede tocar.
  private clippedOut(id: string, wx: number, wy: number): boolean {
    for (let parent = this.tree.parent(id); parent; parent = this.tree.parent(parent)) {
      const record = this.store.get(parent);
      if (record?.type === 'frame' && record.clip && !insideBox(record, this.tree.worldMatrix(record), wx, wy)) return true;
    }
    return false;
  }

  // Lo que selecciona un clic sobre `id`: el grupo más externo que lo contiene dentro del grupo en el que se ha
  // entrado (o de la página). Los frames no capturan el clic: sus hijos se seleccionan directamente.
  targetOf(id: string): string {
    let target = id;
    let parent = this.tree.parent(id);
    while (parent && parent !== this.scope) {
      if (this.store.get(parent)?.type === 'group') target = parent;
      parent = this.tree.parent(parent);
    }
    if (this.scope && parent !== this.scope) {
      this.scope = null;
      return this.targetOf(id);
    }
    return target;
  }

  pick(sx: number, sy: number, options: { includeLocked?: boolean } = {}): string | null {
    const hit = this.hitTest(sx, sy, options);
    return hit ? this.targetOf(hit) : null;
  }

  // Frame visible y desbloqueado de más arriba que contiene un punto de la página: lo que se crea o se suelta ahí
  // entra en él.
  frameAt(x: number, y: number, exclude?: ReadonlySet<string>): string | null {
    const page = this.pageId.get();
    if (!page) return null;
    const candidates = this.spatial.searchPoint(x, y, 0).filter((id) => {
      const record = this.store.get(id);
      if (record?.type !== 'frame' || !record.visible || exclude?.has(id) || this.isLocked(id)) return false;
      return insideBox(record, this.tree.worldMatrix(record), x, y) && !this.clippedOut(id, x, y);
    });
    if (candidates.length <= 1) return candidates[0] ?? null;
    const order = this.tree.paintOrder(page);
    let best: string | null = null;
    let bestRank = -1;
    for (const id of candidates) {
      const rank = order.indexOf(id);
      if (rank > bestRank) {
        best = id;
        bestRank = rank;
      }
    }
    return best;
  }

  // Doble clic sobre un grupo: se entra en él y se selecciona lo que hay bajo el puntero un nivel más abajo.
  enter(id: string, sx: number, sy: number): boolean {
    const record = this.store.get(id);
    if (record?.type !== 'group' || !this.tree.hasChildren(id)) return false;
    const hit = this.hitTest(sx, sy);
    if (!hit || !this.tree.isDescendant(hit, id)) return false;
    this.scope = id;
    this.setSelection([this.targetOf(hit)]);
    return true;
  }

  // Nodos que selecciona un rectángulo: lo que toca, subido a su grupo como un clic. Un frame solo cuenta si cabe
  // entero (empezar el rectángulo dentro de un frame selecciona sus hijos).
  targetsIn(box: AABB, options: { includeLocked?: boolean } = {}): string[] {
    const result = new Set<string>();
    for (const id of this.queryBox(box, options)) {
      const record = this.store.get(id);
      if (record?.type === 'frame' && !containsAABB(box, this.geom.get(id) ?? box)) continue;
      if (this.tree.lockedAbove(id) && !options.includeLocked) continue;
      result.add(this.targetOf(id));
    }
    return [...result];
  }

  // Nodos que toca un rectángulo de mundo (prueba exacta con el cuadrilátero girado de cada uno).
  queryBox(box: AABB, options: { includeLocked?: boolean } = {}): string[] {
    const ids: string[] = [];
    for (const id of this.spatial.search(box)) {
      const record = this.store.get(id);
      if (!record || !record.visible || (record.locked && !options.includeLocked)) continue;
      const geometry = this.geom.get(id);
      if (geometry && containsAABB(box, geometry)) {
        ids.push(id);
        continue;
      }
      const open = record.type === 'line' || record.type === 'connector';
      const points = record.type === 'connector' ? (this.routes.get(id) ?? []) : this.worldOutline(record);
      const polygon: Point[] = [];
      for (let i = 0; i < points.length; i += 2) polygon.push({ x: points[i]!, y: points[i + 1]! });
      if (polygon.length && polygonTouchesBox(polygon, box, open)) ids.push(id);
    }
    return ids;
  }

  snapCandidates(exclude: ReadonlySet<string>): SnapCandidates {
    const boxes: AABB[] = [];
    const moving = new Set(exclude);
    for (const id of exclude) if (isContainer(this.store.get(id))) for (const child of this.tree.descendants(id)) moving.add(child);
    for (const id of this.spatial.search(this.camera.viewport())) {
      if (moving.has(id)) continue;
      const box = this.geom.get(id);
      if (box) boxes.push(box);
    }
    return new SnapCandidates(boxes);
  }

  selectableIds(): string[] {
    const page = this.pageId.get();
    if (!page) return [];
    return this.tree.childrenOf(page, this.scope).filter((id) => {
      const record = this.selectable(id);
      return record && record.visible && !record.locked;
    });
  }

  // Registro de un nodo de la página activa que se puede seleccionar (hojas y contenedores).
  selectable(id: string): SceneRecord | undefined {
    this.syncModel();
    const record = this.store.get(id);
    return record && (isRenderable(record) || isContainer(record)) && this.inSink.has(id) ? record : undefined;
  }

  // Bloqueado él o alguno de sus contenedores, o en reproducción.
  isLocked(id: string): boolean {
    return !!this.store.get(id)?.locked || this.tree.lockedAbove(id) || this.anim.blocks(id);
  }

  // Si la selección queda fuera de la vista (al recorrerla con Tab), la cámara la centra sin cambiar el zoom.
  revealSelection(): void {
    const ids = this.selection.get();
    if (!ids.length) return;
    this.stopFollowing();
    const box = this.boundsOf(ids);
    if (isEmptyAABB(box) || containsAABB(this.camera.viewport(), box)) return;
    const zoom = this.camera.zoom;
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    this.camera.set({ x: cx - this.camera.width / zoom / 2, y: cy - this.camera.height / zoom / 2, zoom });
    this.requestFrame();
  }

  // ── Vistas previas de gestos ─────────────────────────────────────────────────

  setGesture(gesture: GesturePreview | null): void {
    this.gesture = gesture;
    this.snapGuides = gesture?.snapGuides ?? [];
    this.overridesDirty = true;
    this.overlayDirty = true;
    this.presence.setGesture(gesture ? gesture.ids : null, gesture ? gesture.matrix : null);
    this.requestFrame();
  }

  setStylePreview(preview: { ids: readonly string[]; patch: Partial<Record<string, unknown>> } | null): void {
    this.stylePreview = preview;
    this.overridesDirty = true;
    this.overridesStale = true;
    this.requestFrame();
  }

  setCreating(record: SceneRecord | null): void {
    if (this.creating && !record) {
      this.sink.remove(CREATING_ID);
    }
    this.creating = record;
    if (record) {
      let preview = { ...record, id: CREATING_ID } as SceneRecord;
      if (preview.type === 'connector') preview = { ...preview, path: this.computeRoute(preview) };
      this.sink.upsert(CREATING_ID, preview, this.viewMatrix(preview), true);
      this.pushOrder(CREATING_ID);
      this.sink.setInView([CREATING_ID], []);
    } else if (this.pageId.get()) {
      this.pushOrder();
    }
    this.overlayDirty = true;
    this.requestFrame();
  }

  setHover(id: string | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.overlayDirty = true;
    this.requestFrame();
  }

  setMarquee(box: Box | null): void {
    this.marquee = box;
    this.overlayDirty = true;
    this.presence.update({ marquee: box });
    this.requestFrame();
  }

  markOverlayDirty(): void {
    this.overlayDirty = true;
    this.requestFrame();
  }

  // Calcula la vista de un nodo bajo una matriz de gesto (en mundo).
  // Calcula la vista de un nodo bajo una matriz de gesto (en mundo). Si el dibujo no cambia (mover, girar, o
  // redimensionar más de 50 nodos), la vista conserva su matriz y la capa de dibujo aplica el gesto al grupo.
  previewUnder(record: SceneRecord, matrix: Readonly<Mat>, count: number, key: string): ViewOverride {
    const world = this.tree.worldMatrix(record);
    const gesture = { key, matrix: matrix as Mat };
    const grouped = (): ViewOverride => ({ record, world: multiply(matrix, world), redraw: false, gesture });
    if (isTranslation(matrix)) return grouped();
    const parentId = this.tree.parent(record.id);
    const parentWorld = this.tree.parentWorld(parentId);
    // Un contenedor que se mueve o gira lleva dentro a sus hijos. Al redimensionar un grupo, la vista previa lo
    // deforma entero; un frame cambia solo su caja.
    if (isContainer(record)) {
      if (this.carriesChildren(record, matrix)) return grouped();
      const next = applyPatch(record, transformPatch(record, matrix, parentWorld));
      return { record: next, world: this.tree.worldMatrix(next), redraw: true };
    }
    const next = applyPatch(record, transformPatch(record, matrix, parentWorld)) as RenderableRecord;
    const sameSize = next.w === record.w && next.h === record.h && next.type !== 'line';
    if (sameSize || count > RESIZE_REDRAW_LIMIT) return grouped();
    return { record: next, world: this.tree.worldMatrix(next), redraw: true };
  }

  private updateOverrides(): void {
    this.overridesDirty = false;
    const page = this.pageId.get();
    const previous = this.lastGesture;
    this.lastGesture = this.gesture;
    // Mismo arrastre que en el frame anterior y nada más cambió: solo se mueve la matriz del grupo.
    if (
      !this.overridesStale &&
      this.gesture &&
      previous &&
      this.gesture.ids === previous.ids &&
      isTranslation(this.gesture.matrix) &&
      isTranslation(previous.matrix) &&
      !this.stylePreview
    ) {
      this.sink.setGroupMatrix('local', this.gesture.matrix);
      this.gestureMatrices.set('local', this.gesture.matrix);
      // Los conectores con un solo extremo en el gesto se recalculan en cada frame.
      for (const id of this.gestureRoutes) this.previewConnector(id, this.overrides);
      return;
    }
    this.overridesStale = false;
    this.fixedTerminals.from.clear();
    this.fixedTerminals.to.clear();
    if (!this.gesture) this.previewRecords.clear();
    const desired = new Map<string, ViewOverride>();
    this.gestureKeyOf.clear();
    this.gestureMatrices.clear();
    this.gestureRoutes = [];
    this.carriers.clear();
    this.carriedRoutes.clear();
    const affected = new Set<string>();
    const collect = (id: string, key: string, matrix: Mat): SceneRecord | null => {
      this.gestureKeyOf.set(id, key);
      for (const connector of this.connectorsByNode.get(id) ?? []) affected.add(connector);
      const record = this.selectable(id);
      if (!record) return null;
      if (record.type === 'connector') {
        affected.add(id);
        return null;
      }
      // Los descendientes de un contenedor que los lleva se mueven con él: sus conectores se recalculan.
      if (isContainer(record) && this.carriesChildren(record, matrix)) {
        this.carriers.set(id, key);
        for (const child of this.tree.descendants(id)) {
          this.gestureKeyOf.set(child, key);
          for (const connector of this.connectorsByNode.get(child) ?? []) affected.add(connector);
          if (this.store.get(child)?.type === 'connector') affected.add(child);
        }
      }
      this.gestureMatrices.set(key, matrix);
      return record;
    };

    for (const [clientId, state] of this.presence.remote()) {
      if (!state.gesture || state.pageId !== page) continue;
      const ids = this.remoteGestureIds(state);
      const key = `remote:${clientId}`;
      this.gestureMatrices.set(key, state.gesture.matrix);
      for (const id of ids) {
        const record = collect(id, key, state.gesture.matrix);
        if (record) desired.set(id, this.previewUnder(record, state.gesture.matrix, ids.length, key));
      }
    }
    if (this.gesture) {
      this.gestureMatrices.set('local', this.gesture.matrix);
      for (const id of this.gesture.ids) {
        const record = collect(id, 'local', this.gesture.matrix);
        if (record) desired.set(id, this.previewUnder(record, this.gesture.matrix, this.gesture.ids.length, 'local'));
      }
    }
    for (const id of affected) {
      const key = this.gestureKeyOf.get(id);
      const record = this.renderable(id) as ConnectorRecord | undefined;
      if (!record) continue;
      // Dentro de un contenedor que se mueve, el conector ya va con él; solo se recalcula si algún extremo no
      // sigue el mismo gesto, y entonces su recorrido se expresa antes del gesto del contenedor.
      const carrier = key ? this.carrierOf(id, key) : null;
      if (key && carrier) {
        if (this.endsMoveWith(record, key)) continue;
        this.carriedRoutes.set(id, key);
        this.previewConnector(id, desired);
        if (key === 'local') this.gestureRoutes.push(id);
        continue;
      }
      // Si el conector y los nodos de sus dos extremos se trasladan con el mismo gesto, basta con moverlo con el grupo.
      const matrix = key ? this.gestureMatrices.get(key) : undefined;
      if (key && matrix && isTranslation(matrix) && this.endsMoveWith(record, key)) {
        desired.set(id, { record: this.drawnRecord(record), world: [...matrix] as Mat, redraw: false, gesture: { key, matrix } });
        continue;
      }
      this.previewConnector(id, desired);
      if (this.gesture && [record.from, record.to].some((end) => 'nodeId' in end && this.gestureKeyOf.get(end.nodeId) === 'local')) {
        this.gestureRoutes.push(id);
      } else if (key === 'local') {
        this.gestureRoutes.push(id);
      }
    }
    if (this.stylePreview) {
      for (const id of this.stylePreview.ids) {
        const record = this.selectable(id);
        if (!record) continue;
        const base = desired.get(id);
        const next = { ...(base?.record ?? record), ...this.stylePreview.patch } as SceneRecord;
        if (next.type === 'connector') {
          desired.set(id, { record: { ...next, path: this.computeRoute(next, this.movingLookup) }, world: [...IDENTITY] as Mat, redraw: true });
          continue;
        }
        // Las vistas previas de puntos de línea cambian la caja: la matriz se recalcula.
        const geometric = GEOMETRY_KEYS.some((key) => key in this.stylePreview!.patch);
        desired.set(id, { record: next, world: base && !geometric ? base.world : this.tree.worldMatrix(next), redraw: true });
      }
    }

    this.animOwned.clear();
    for (const [id, pose] of this.animPoses) {
      if (desired.has(id)) continue;
      desired.set(id, pose);
      this.animOwned.add(id);
    }

    for (const id of this.overrides.keys()) if (!desired.has(id)) this.sink.setOverride(id, null);
    for (const [id, override] of desired) this.sink.setOverride(id, override);
    this.overrides = desired;
  }

  // Las poses de la reproducción van a la vista de cada nodo salvo que un gesto la esté usando; las que dejan de
  // estar devuelven la vista al documento.
  private applyAnimationPoses(poses: ReadonlyMap<string, ViewOverride>): void {
    for (const id of [...this.animOwned]) {
      if (poses.has(id)) continue;
      this.animOwned.delete(id);
      this.overrides.delete(id);
      this.sink.setOverride(id, null);
    }
    for (const [id, pose] of poses) {
      if (this.overrides.has(id) && !this.animOwned.has(id)) continue;
      this.overrides.set(id, pose);
      this.animOwned.add(id);
      this.sink.setOverride(id, pose);
    }
    this.animPoses = poses;
    this.needsRender = true;
  }

  // Al empezar a reproducir se sueltan el gesto y el texto que tocaban nodos animados.
  private animationPlayingChanged(): void {
    if (this.anim.playing) {
      if (this.gesture?.ids.some((id) => this.anim.blocks(id))) this.controller.cancel();
      const editing = this.editingText.get();
      if (editing && this.anim.blocks(editing.id)) this.stopTextEdit();
    }
    this.overlayDirty = true;
    this.requestFrame();
  }

  // Matriz del gesto que mueve un nodo ahora mismo, si lo hay.
  private readonly movingLookup: MovingLookup = (id) => {
    const key = this.gestureKeyOf.get(id);
    return key ? (this.gestureMatrices.get(key) ?? null) : null;
  };

  // Un grupo siempre lleva a sus hijos; un frame, solo si se mueve o gira (al redimensionarlo sus hijos se quedan).
  carriesChildren(record: ContainerRecord, matrix: Readonly<Mat>): boolean {
    return record.type === 'group' || isRigid(matrix);
  }

  private carrierOf(id: string, key: string): string | null {
    for (let parent = this.tree.parent(id); parent; parent = this.tree.parent(parent)) {
      if (this.carriers.get(parent) === key) return parent;
    }
    return null;
  }

  private endsMoveWith(record: ConnectorRecord, key: string): boolean {
    for (const end of [record.from, record.to]) {
      if (!('nodeId' in end)) continue;
      const target = this.store.get(end.nodeId);
      // Un extremo colgante se mueve con el propio conector.
      if (!target || target.pageId !== record.pageId) continue;
      if (this.gestureKeyOf.get(end.nodeId) !== key) return false;
    }
    return true;
  }

  // Vista previa de un conector con los nodos de sus extremos bajo sus gestos.
  private previewConnector(id: string, into: Map<string, ViewOverride>): void {
    const record = this.store.get(id);
    if (record?.type !== 'connector') return;
    let route = this.computeRoute(record, this.movingLookup);
    const carriedBy = this.carriedRoutes.get(id);
    const carrierMatrix = carriedBy ? this.gestureMatrices.get(carriedBy) : undefined;
    if (carrierMatrix) route = transformPoints(route, invert(carrierMatrix));
    // Mientras el registro no cambie, la vista previa reutiliza su objeto y solo cambia el recorrido; por eso va
    // siempre con redraw.
    let preview = this.previewRecords.get(id);
    if (!preview || preview.source !== record) {
      preview = { source: record, record: { ...record, path: route } };
      this.previewRecords.set(id, preview);
    } else {
      (preview.record as { path?: readonly number[] }).path = route;
    }
    const override: ViewOverride = { record: preview.record, world: [...IDENTITY] as Mat, redraw: true };
    into.set(id, override);
    if (into === this.overrides) this.sink.setOverride(id, override);
  }

  private remoteGestureIds(state: PresenceState): string[] {
    if (!state.gesture) return [];
    if (state.gesture.ids !== 'selection') return state.gesture.ids;
    if (state.selection.length) return state.selection;
    if (!state.selectionBox) return [];
    // Más de 500 ids: se aproxima con los nodos propios que caen dentro de la caja.
    const { x, y, w, h } = state.selectionBox;
    const box = { minX: x, minY: y, maxX: x + w, maxY: y + h };
    return this.spatial.search(box).filter((id) => {
      const geometry = this.geom.get(id);
      return geometry ? containsAABB(expandAABB(box, 1), geometry) : false;
    });
  }

  // ── Overlay ──────────────────────────────────────────────────────────────────

  private overlayModel(): OverlayModel {
    const gestureMatrix = this.gesture?.matrix;
    const moving = gestureMatrix !== undefined && isTranslation(gestureMatrix);
    // Al trasladar, el dibujo de la selección se reutiliza y se desplaza; con otros gestos se rehace.
    // Sin selección el dibujo no depende de los registros ni de la cámara: un update remoto no lo rehace.
    const selectionKey =
      gestureMatrix && !moving
        ? null
        : this.selection.get().length === 0
          ? 'empty'
          : `${this.selectionVersion}:${this.recordsVersion}:${this.camera.version}:${this.readOnly.get()}:${moving ? 'move' : 'idle'}`;
    const zoom = this.camera.zoom;
    const model: OverlayModel = {
      selection: null,
      selectionKey,
      selectionOffset: moving ? { x: gestureMatrix[4] * zoom, y: gestureMatrix[5] * zoom } : { x: 0, y: 0 },
      hover: null,
      marquee: null,
      guides: [],
    };
    const ids = this.selection.get();
    const matrix = moving ? undefined : gestureMatrix;
    const reused = selectionKey !== null && selectionKey === this.lastSelectionKey;
    this.lastSelectionKey = selectionKey;
    if (ids.length && !reused) {
      const frame = this.selectionFrame(ids);
      if (frame) {
        const corners = this.screenCorners(frame, matrix);
        const single = ids.length === 1 ? this.renderable(ids[0]!) : undefined;
        const editable = !this.readOnly.get() && !this.anyLocked(ids);
        const points: Point[] = [];
        if (single?.type === 'line') {
          const override = moving ? undefined : this.overrides.get(single.id);
          const world = override && !override.gesture ? override.world : matrix ? multiply(matrix, this.tree.worldMatrix(single)) : this.tree.worldMatrix(single);
          for (const [px, py] of (override?.record as typeof single | undefined)?.points ?? single.points) {
            const p = apply(world, px, py);
            points.push(this.camera.worldToScreen(p.x, p.y));
          }
        } else if (single?.type === 'connector') {
          // Un handle en cada extremo.
          const route = (moving ? this.routes.get(single.id) : this.routeOf(single.id)) ?? [];
          if (route.length >= 4) {
            for (const p of [routeStart(route), routeEnd(route)]) {
              const at = matrix && !this.overrides.get(single.id)?.redraw ? apply(matrix, p.x, p.y) : p;
              points.push(this.camera.worldToScreen(at.x, at.y));
            }
          }
        }
        model.selection = {
          corners,
          handles: editable && points.length === 0 ? handlePositions(corners) : [],
          points: editable ? points : [],
          // Durante un gesto solo la caja: volver a teselar cien contornos por frame no aporta.
          outlines: !this.gesture && ids.length > 1 && ids.length <= 200 ? ids.map((id) => this.screenOutline(id, matrix)).filter((o): o is Point[] => !!o) : [],
        };
      }
    }
    if (this.hover && !this.isSelected(this.hover) && !this.gesture) model.hover = this.screenOutline(this.hover);
    if (this.marquee) {
      const a = this.camera.worldToScreen(this.marquee.x, this.marquee.y);
      model.marquee = { x: a.x, y: a.y, w: this.marquee.w * this.camera.zoom, h: this.marquee.h * this.camera.zoom };
    }
    for (const guide of this.snapGuides) {
      const a = this.camera.worldToScreen(guide.x1, guide.y1);
      const b = this.camera.worldToScreen(guide.x2, guide.y2);
      model.guides.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return model;
  }

  anyLocked(ids: readonly string[]): boolean {
    return ids.some((id) => this.isLocked(id));
  }

  private screenOutline(id: string, matrix?: Readonly<Mat>): Point[] | null {
    const record = this.store.get(id);
    if (!record) return null;
    const points = this.worldOutline(record, matrix);
    const out: Point[] = [];
    for (let i = 0; i < points.length; i += 2) out.push(this.camera.worldToScreen(points[i]!, points[i + 1]!));
    return out.length ? out : null;
  }

  private remoteModel(time: number): RemoteModel {
    const model: RemoteModel = { selections: [], marquees: [], cursors: [] };
    const page = this.pageId.get();
    const seen = new Set<string>();
    for (const [clientId, state] of this.presence.remote()) {
      if (state.pageId !== page) continue;
      const key = String(clientId);
      const color = state.user.color;
      if (state.cursor) {
        seen.add(key);
        this.cursors.set(key, state.cursor.x, state.cursor.y, time);
        const at = this.cursors.sample(key, time)!;
        const screen = this.camera.worldToScreen(at.x, at.y);
        model.cursors.push({ key, name: state.user.name, color, x: screen.x, y: screen.y });
      }
      // Mientras su asistente trabaja, un cursor «Parcify IA» acompaña al de esa persona (o a su vista).
      if (state.aiBusy) {
        const anchor = state.cursor
          ? this.camera.worldToScreen(this.cursors.sample(key, time)?.x ?? state.cursor.x, this.cursors.sample(key, time)?.y ?? state.cursor.y)
          : this.camera.worldToScreen(state.viewport.x + 48 / state.viewport.zoom, state.viewport.y + 48 / state.viewport.zoom);
        model.cursors.push({ key: `${key}:ai`, name: `Parcify IA · ${state.user.name}`, color: AI_PREVIEW_COLOR, x: anchor.x + 28, y: anchor.y + 28 });
      }
      const matrix = state.gesture?.matrix;
      const polygons: Point[][] = [];
      if (state.selection.length) {
        for (const id of state.selection) {
          const record = this.store.get(id);
          if (!record || record.pageId !== page) continue;
          const points = this.worldOutline(record, matrix);
          const polygon: Point[] = [];
          for (let i = 0; i < points.length; i += 2) polygon.push({ x: points[i]!, y: points[i + 1]! });
          if (polygon.length) polygons.push(polygon);
        }
      } else if (state.selectionBox) {
        const { x, y, w, h } = state.selectionBox;
        const m = matrix ?? ([1, 0, 0, 1, 0, 0] as Mat);
        polygons.push([apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)]);
      }
      if (polygons.length) model.selections.push({ color, polygons });
      if (state.marquee) model.marquees.push({ color, box: state.marquee });
    }
    for (const key of [...this.cursors.keys()]) if (!seen.has(key)) this.cursors.delete(key);
    return model;
  }

  // ── Asistente de IA ──────────────────────────────────────────────────────────

  // Vista previa de un plan: se dibuja en la capa `preview` sin tocar el documento y sigue sus cambios (lo que
  // desaparece deja de verse) hasta que se aplica o se descarta (null).
  setAiPreview(plan: AssistantPlan | null): void {
    this.aiPlan = plan;
    this.aiPreviewKey = '';
    this.requestFrame();
  }

  get aiPreviewActive(): boolean {
    return this.aiPlan !== null;
  }

  // Animaciones propuestas en vista previa (null las quita). Se reproducen con `anim` como las del documento,
  // pero nunca se escriben: para eso está AnimationCommands.applyAiAnimations.
  setAiAnimationPreview(plan: AnimationPlan | null): void {
    this.anim.stop();
    this.aiAnimations.set(plan ? new Map(plan.animations.map((entry) => [entry.nodeId, entry.animation])) : null);
    this.anim.invalidate(true);
    this.requestFrame();
  }

  private *playerAnimations(): Iterable<[string, Animation]> {
    const proposed = this.aiAnimations.get();
    if (!proposed) {
      yield* this.store.animations();
      return;
    }
    for (const entry of this.store.animations()) if (!proposed.has(entry[0])) yield entry;
    yield* proposed;
  }

  // Contexto que acompaña a una petición de IA: la página, lo que se ve y la selección, como mucho `max` nodos.
  aiContext(max?: number): { pageId: string; viewport: Box; selection: string[]; canvas: CanvasSummaryNode[] } | null {
    this.syncModel();
    const pageId = this.pageId.get();
    if (!pageId) return null;
    const view = this.camera.viewport();
    const selection = [...this.selection.get()];
    const canvas = canvasSummary(
      { records: () => this.store.all(), text: (id) => this.store.text(id), geometry: (id) => this.geometryOf(id) },
      pageId,
      selection,
      view,
      max,
    );
    const known = new Set(canvas.map((node) => node.id));
    return {
      pageId,
      viewport: { x: view.minX, y: view.minY, w: view.maxX - view.minX, h: view.maxY - view.minY },
      selection: selection.filter((id) => known.has(id)),
      canvas,
    };
  }

  private drawAiPreview(): boolean {
    const plan = this.aiPlan;
    const key = plan ? `${this.recordsVersion}:${this.camera.zoom}:${this.pageId.get()}` : 'none';
    if (key === this.aiPreviewKey) return false;
    this.aiPreviewKey = key;
    if (!plan) {
      this.sink.drawPreview(null, this.camera.zoom);
      return true;
    }
    const resolved = resolvePlan(plan, this.commands.planView(false));
    const model = buildPreview(resolved, {
      parentWorld: (id) => this.tree.parentWorld(id),
      outline: (id) => {
        const record = this.store.get(id);
        return record ? this.worldOutline(record) : null;
      },
      text: (id) => this.store.text(id),
    });
    this.sink.drawPreview(model, this.camera.zoom);
    return true;
  }

  // ── Cámara ───────────────────────────────────────────────────────────────────

  fitAll(): void {
    const bounds = this.pageBounds();
    if (bounds) this.camera.fit(bounds, 64, 1);
    else this.camera.set({ x: -this.camera.width / 2, y: -this.camera.height / 2, zoom: 1 });
    this.requestFrame();
  }

  zoomToSelection(): void {
    const ids = this.selection.get();
    if (!ids.length) return this.fitAll();
    const bounds = this.boundsOf(ids);
    if (!isEmptyAABB(bounds)) this.camera.fit(bounds, 96, 8);
    this.requestFrame();
  }

  zoomTo(zoom: number): void {
    this.camera.zoomTo(zoom);
    this.requestFrame();
  }

  // Coordenadas de mundo → pantalla (útil para pruebas y para posicionar UI sobre el lienzo).
  worldToScreen(x: number, y: number): Point {
    return this.camera.worldToScreen(x, y);
  }

  // Centro de la vista en coordenadas de la página.
  viewCenter(): Point {
    const viewport = this.camera.viewport();
    return { x: (viewport.minX + viewport.maxX) / 2, y: (viewport.minY + viewport.maxY) / 2 };
  }

  // Centra la vista en un punto de la página sin cambiar el zoom (clic en el minimapa).
  centerOn(x: number, y: number): void {
    this.stopFollowing();
    const zoom = this.camera.zoom;
    this.camera.set({ x: x - this.camera.width / zoom / 2, y: y - this.camera.height / zoom / 2 });
    this.requestFrame();
  }

  // Sube cuando cambian los registros de la página: el minimapa solo se repinta si cambió algo.
  get contentVersion(): number {
    return this.recordsVersion;
  }

  // Cajas del índice espacial de la página activa (las pinta el minimapa).
  forEachBox(visit: (box: AABB) => void): void {
    this.spatial.forEach(visit);
  }

  // «Seguir a»: la cámara copia la vista de otra persona, interpolada, hasta que se mueva a mano o se vaya.
  follow(clientId: number | null): void {
    this.syncModel();
    if (clientId !== null && !this.presence.remote().has(clientId)) clientId = null;
    this.following.set(clientId);
    this.lastFollowTime = 0;
    if (clientId === null) this.scheduler.keepAlive('follow', false);
    this.requestFrame();
  }

  stopFollowing(): void {
    if (this.following.get() !== null) this.follow(null);
  }

  private stepFollow(time: number): void {
    const state = this.presence.remote().get(this.following.get()!);
    if (!state) {
      this.follow(null);
      return;
    }
    if (state.pageId && state.pageId !== this.pageId.get()) this.setPage(state.pageId);
    const target = state.viewport;
    const dt = this.lastFollowTime ? Math.min(100, time - this.lastFollowTime) : FOLLOW_SMOOTHING_MS / 4;
    this.lastFollowTime = time;
    const k = 1 - Math.exp(-dt / FOLLOW_SMOOTHING_MS);
    const camera = this.camera;
    const zoom = Math.exp(Math.log(camera.zoom) + (Math.log(target.zoom) - Math.log(camera.zoom)) * k);
    const x = camera.x + (target.x - camera.x) * k;
    const y = camera.y + (target.y - camera.y) * k;
    // Medio píxel de pantalla y un 0,1 % de zoom: a partir de ahí se pone el valor exacto y se deja de animar.
    const close = Math.abs(target.x - x) * zoom < 0.5 && Math.abs(target.y - y) * zoom < 0.5 && Math.abs(target.zoom / zoom - 1) < 1e-3;
    if (close) {
      if (camera.x !== target.x || camera.y !== target.y || camera.zoom !== target.zoom) camera.moveTo(target.x, target.y, target.zoom);
    } else {
      camera.moveTo(x, y, zoom);
    }
    this.scheduler.keepAlive('follow', !close);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stopTextEdit();
    this.destroyed = true;
    this.detachBackend();
    if (this.textTimer !== null) this.timers.clearTimeout(this.textTimer);
    if (this.cameraTimer !== null) this.timers.clearTimeout(this.cameraTimer);
    if (this.watchdogTimer !== null) this.timers.clearTimeout(this.watchdogTimer);
    this.anim.destroy();
    this.scheduler.destroy();
    this.controller.cancel();
    this.commands.destroy();
    this.presence.destroy();
    this.textListeners.clear();
    this.stats.clear();
  }
}

// Un conector se puede anclar a cualquier nodo con caja propia salvo a otro conector.
export function isAnchorable(record: NodeRecord): boolean {
  return (isRenderable(record) && record.type !== 'connector') || record.type === 'frame';
}

function polygonTouchesBox(polygon: Point[], box: AABB, open: boolean): boolean {
  const rect: Point[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  if (open) {
    // Una línea toca la caja si algún segmento la cruza o tiene un extremo dentro.
    for (let i = 0; i < polygon.length - 1; i++) {
      if (segmentTouchesBox(polygon[i]!, polygon[i + 1]!, box)) return true;
    }
    return false;
  }
  return !separated(polygon, rect) && !separated(rect, polygon);
}

function separated(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    const nx = q.y - p.y;
    const ny = p.x - q.x;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const v of a) {
      const d = v.x * nx + v.y * ny;
      minA = Math.min(minA, d);
      maxA = Math.max(maxA, d);
    }
    for (const v of b) {
      const d = v.x * nx + v.y * ny;
      minB = Math.min(minB, d);
      maxB = Math.max(maxB, d);
    }
    if (maxA < minB || maxB < minA) return true;
  }
  return false;
}

function segmentTouchesBox(a: Point, b: Point, box: AABB): boolean {
  const inside = (p: Point) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  if (inside(a) || inside(b)) return true;
  const segment = [a, b];
  const rect = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  return !separated(segment, rect) && !separated(rect, segment);
}
