<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import X from '@lucide/svelte/icons/x';
  import { onMount, tick } from 'svelte';
  import { on } from 'svelte/events';
  import { describeSelection } from '../engine/a11y/describe.ts';
  import {
    createEngine,
    OWN_WHEEL_ATTR,
    RendererUnavailableError,
    type ContextMenuRequest,
    type ContextState,
    type Engine,
    type FramePresetId,
    type NodeRecord,
    type PageRecord,
    type PointerKind,
    type Tool,
    type UiCommand,
  } from '../engine/index.ts';
  import { ApiError, apiFetch, browser, signInUrl } from '../lib/api.ts';
  import { CANVAS_IMAGE_ACCEPT, canvasAssets, copyAssetsTo, uploadCanvasImage } from '../lib/canvas-images.ts';
  import { CollabSession, type CollabFailure, type CollabNotice, type CollabState } from '../lib/collab.ts';
  import { wheelPreference } from '../lib/input-prefs.ts';
  import { motionReduced } from '../lib/motion.ts';
  import { clientVersion, loadSession, session } from '../lib/session.svelte.ts';
  import { m } from '../paraglide/messages.js';
  import { ProjectDetailSchema } from '../shared/api/projects.js';
  import { uploadProjectPreview } from '../lib/projects.ts';
  import { PreviewPublisher } from '../engine/export/preview.ts';
  import { collectScene, renderRaster } from '../engine/export/raster.ts';
  import { showToast } from '../ui/toast.svelte.ts';
  import BlockingScreen from './editor/BlockingScreen.svelte';
  import CanvasHud from './editor/CanvasHud.svelte';
  import { createEngineCanvas } from './editor/engine-canvas.ts';
  import ChatPanel from './editor/chat/ChatPanel.svelte';
  import ContextMenu from './editor/ContextMenu.svelte';
  import ExportDialog from './editor/ExportDialog.svelte';
  import GalleryPanel from './editor/GalleryPanel.svelte';
  import { describeLabels } from './editor/kinds.ts';
  import Minimap from './editor/Minimap.svelte';
  import Present, { presentationSlides } from './editor/Present.svelte';
  import { downloadLocalCopy } from '../lib/local-copy.ts';
  import PropertiesPanel from './editor/PropertiesPanel.svelte';
  import FloatingToolbar from './editor/toolbar/FloatingToolbar.svelte';
  import ZoomBar from './editor/toolbar/ZoomBar.svelte';
  import FileHeader from './editor/layout/FileHeader.svelte';
  import LeftPanel from './editor/layout/LeftPanel.svelte';
  import RightPanel from './editor/layout/RightPanel.svelte';
  import SessionBar, { type Collaborator } from './editor/layout/SessionBar.svelte';
  import ShortcutsDialog from './editor/layout/ShortcutsDialog.svelte';
  import WheelDialog from './editor/layout/WheelDialog.svelte';
  import { DEFAULT_UI_KEYS, loadUiKeys, type UiKeys } from './editor/layout/ui-keys.ts';
  import VersionsPanel from './editor/VersionsPanel.svelte';
  import Tooltip from '../ui/Tooltip.svelte';
  import { EditorLayout, setEditorLayout } from '../lib/editor-layout.svelte.ts';
  import { Viewport } from '../lib/viewport.svelte.ts';
  import type TimelinePanel from './editor/timeline/TimelinePanel.svelte';
  import type AiPanelComponent from './editor/ai/AiPanel.svelte';
  import { loadAiFeatures, type AiFeatures } from '../lib/ai.ts';
  import { loadWorkspaces } from '../lib/workspaces.svelte.ts';
  import PublishTemplateDialog from './templates/PublishTemplateDialog.svelte';

  const PROJECT_PATH = /^\/p\/([0-9a-f-]{36})\/?$/;

  let phase = $state<'loading' | 'ready' | 'error'>('loading');
  let failure = $state<CollabFailure | null>(null);
  let crashed = $state(false);
  let canvasUnavailable = $state(false);
  let contextState = $state<ContextState>('ok');
  let projectName = $state('');
  let collabState = $state<CollabState | null>(null);
  let tool = $state<Tool>('select');
  let toolLocked = $state(false);
  // El motor parchea los registros en sitio: el panel recibe copias para que cada cambio sea un valor nuevo.
  let selection = $state.raw<readonly NodeRecord[]>([]);
  let history = $state({ canUndo: false, canRedo: false });
  let zoom = $state(1);
  let engineReadOnly = $state(true);
  let people = $state<Collaborator[]>([]);
  let framePreset = $state<FramePresetId>('16:9');
  let pages = $state.raw<readonly PageRecord[]>([]);
  let activePage = $state<string | null>(null);
  let workspaceSlug = '';
  let menu = $state.raw<ContextMenuRequest | null>(null);
  let galleryOpen = $state(false);
  let exportOpen = $state(false);
  let publishOpen = $state(false);
  // El panel Compartir se descarga la primera vez que se abre.
  let shareOpen = $state(false);
  let shareMounted = $state(false);
  // Publicar como plantilla exige ser admin del proyecto y miembro del espacio.
  let workspace = $state.raw<{ slug: string; name: string } | null>(null);
  let presenting = $state(false);
  let presenter = $state<ReturnType<typeof Present> | null>(null);
  // Raíz del editor: el lienzo ocupa toda la ventana y los paneles flotan encima. Presentar la pasa a pantalla completa.
  let root = $state<HTMLDivElement | null>(null);
  let downloadingLocal = $state(false);
  let previews: PreviewPublisher | null = null;
  let minimapOpen = $state(false);
  // Anchos de la franja inferior y de sus barras: si no caben en una fila, el zoom y el minimapa suben encima.
  let barsWidth = $state(0);
  let toolbarWidth = $state(0);
  let zoomWidth = $state(0);
  let minimapWidth = $state(0);
  const barsStacked = $derived(barsWidth > 0 && barsWidth < zoomWidth + toolbarWidth + 8 + (minimapOpen ? minimapWidth + 8 : 0));
  let following = $state<number | null>(null);
  let assetEvent = $state.raw<{ type: 'ready' | 'deleted'; assetId: string; n: number } | null>(null);
  // La línea de tiempo se descarga la primera vez que se abre.
  let Timeline = $state.raw<typeof TimelinePanel | null>(null);
  let timelineLoading = $state(false);
  let timelineFocus = $state(0);
  let chatOpen = $state(false);
  let chatUnread = $state(0);
  // Funciones de IA con modelo configurado; el panel se descarga la primera vez que se abre.
  let aiFeatures = $state.raw<AiFeatures | null>(null);
  let aiOpen = $state(false);
  let AiPanel = $state.raw<typeof AiPanelComponent | null>(null);
  let aiLoading = $state(false);
  let aiAttachment = $state.raw<{ assetId: string; name: string; n: number } | null>(null);
  // Cambia con cada ai.job (generación de imágenes) que llega del servidor.
  let aiJobEvent = $state.raw<{ jobId: string; status: string; n: number } | null>(null);
  let versionsPanel = $state<ReturnType<typeof VersionsPanel> | null>(null);
  let leftPanel = $state<ReturnType<typeof LeftPanel> | null>(null);
  let typingNames = $state.raw<string[]>([]);
  let compacting = $state(false);
  let compactRequested = $state(false);
  // Copia reactiva de `collab` para la plantilla.
  let chatSession = $state.raw<CollabSession | null>(null);
  const followed = $derived(following === null ? null : (people.find((person) => person.clientId === following) ?? null));

  const viewport = new Viewport();
  // En tablet y móvil los paneles empiezan plegados si este navegador no tiene una maqueta guardada.
  const layout = new EditorLayout({ compact: viewport.mode !== 'desktop' });
  setEditorLayout(layout);
  let uiKeys = $state.raw<UiKeys>(DEFAULT_UI_KEYS);
  let shortcutsOpen = $state(false);
  let wheelOpen = $state(false);
  // Último puntero con el que se trabajó en el lienzo: con el dedo no hay hover y los controles se ven siempre.
  let inputKind = $state<PointerKind>('mouse');
  let leftWidth = $state(0);
  let rightWidth = $state(0);
  let timelineHeight = $state(0);

  const timelineOpen = $derived(layout.timeline.open);
  const versionsOpen = $derived(layout.rightView === 'versions');
  const compactLayout = $derived(viewport.mode !== 'desktop');
  const hideUi = $derived(presenting || layout.ui === 'hidden');
  const leftOpen = $derived(!hideUi && layout.ui === 'normal' && layout.left === 'open');
  // Con la interfaz minimizada, el panel derecho se abre solo mientras hay selección.
  const rightOpen = $derived(!hideUi && (layout.ui === 'normal' ? layout.right === 'open' : selection.length > 0));
  // Borde interior de cada panel abierto, en px desde el borde de la ventana (8 de margen más su ancho).
  const leftEdge = $derived(leftOpen ? 8 + (leftWidth || layout.leftWidth) : 0);
  const rightEdge = $derived(rightOpen ? 8 + (rightWidth || layout.rightWidth) : 0);
  const bottomEdge = $derived(!hideUi && timelineOpen && Timeline && timelineHeight ? 8 + timelineHeight : 0);
  // En tablet los paneles abiertos flotan sin reservar sitio: abrirlos no cambia el encuadre ni mueve las barras de
  // abajo, que quedan por encima de ellos.
  const barsLeft = $derived(compactLayout ? 0 : leftEdge);
  const barsRight = $derived(compactLayout ? 0 : rightEdge);
  // Por eso en tablet el contenido de los paneles termina por encima de las barras: la última capa sigue al alcance.
  let barsHeight = $state(0);
  const panelClearance = $derived(compactLayout && !hideUi && barsHeight ? bottomEdge + barsHeight + 8 : 0);
  const insets = $derived({
    top: 0,
    left: leftEdge && !compactLayout ? leftEdge + 8 : 0,
    right: rightEdge && !compactLayout ? rightEdge + 8 : 0,
    bottom: bottomEdge ? bottomEdge + 8 : 0,
  });

  $effect(() => {
    engine?.setViewInsets(insets);
  });

  let container = $state<HTMLDivElement | null>(null);
  // Canvas del motor montado (cada montaje crea el suyo, ver createEngineCanvas).
  let engineCanvas: HTMLCanvasElement | null = null;
  let imageInput = $state<HTMLInputElement | null>(null);
  // Como mucho tantas imágenes por cada vez que se suelta o se elige.
  const MAX_IMAGES_AT_ONCE = 10;
  const IMAGE_STAGGER = 24;
  let engine: Engine | null = $state.raw(null);
  let collab: CollabSession | null = null;
  let projectId = $state('');
  const cleanups: Array<() => void> = [];
  let engineCleanups: Array<() => void> = [];
  let fittedOnSync = false;

  const canRename = $derived(collabState !== null && collabState.role !== 'viewer');
  const canPublish = $derived(collabState?.role === 'admin' && workspace !== null);
  const canShare = $derived(collabState?.role === 'admin');
  // La IA necesita poder editar el proyecto (ai:use).
  const aiAvailable = $derived(!!aiFeatures && (aiFeatures.assistant || aiFeatures.chat) && !engineReadOnly);

  // Lo que lee un lector de pantalla al cambiar la selección.
  const announcement = $derived.by(() => {
    const current = engine;
    if (!current) return '';
    const page = pages.find((item) => item.id === activePage)?.name ?? '';
    return describeSelection(selection, page, describeLabels, {
      sizeOf: (record) => {
        if (record.type !== 'group') return { w: record.w, h: record.h };
        const box = current.core.geometryOf(record.id);
        return box ? { w: box.maxX - box.minX, h: box.maxY - box.minY } : { w: 0, h: 0 };
      },
      textOf: (record) => (record.type === 'text' ? current.core.store.text(record.id) : ''),
    });
  });

  // Los paneles y barras no son descendientes del lienzo: sobre ellos, Ctrl/⌘+rueda o el pellizco del touchpad harían
  // zoom de toda la página. Las zonas con rueda propia ya lo anulan y deciden qué hacer.
  $effect(() => {
    const offWheel = on(
      window,
      'wheel',
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        if (event.target instanceof Element && event.target.closest(`[${OWN_WHEEL_ATTR}]`)) return;
        event.preventDefault();
      },
      { passive: false },
    );
    // En Safari de macOS el pellizco llega como gesture* y haría zoom de la página aunque se anule la rueda.
    const offGesture = 'GestureEvent' in window ? on(document, 'gesturestart', (event: Event) => event.preventDefault()) : () => {};
    return () => {
      offWheel();
      offGesture();
    };
  });

  onMount(() => {
    void start();
    void loadUiKeys().then((keys) => (uiKeys = keys));
    // Al ocultar la pestaña o salir del editor se sube la vista previa si hubo cambios.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void previews?.publish();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      layout.flush();
      destroyEngine();
      for (const cleanup of cleanups) cleanup();
      collab?.destroy();
    };
  });

  async function start() {
    projectId = PROJECT_PATH.exec(window.location.pathname)?.[1] ?? '';
    if (!projectId) {
      failure = 'no_access';
      return;
    }
    try {
      // La sesión aporta el avatar que viaja en la presencia.
      const [project, opened] = await Promise.all([
        apiFetch(`/v1/projects/${projectId}`, { schema: ProjectDetailSchema }),
        CollabSession.open(projectId),
        loadSession(),
      ]);
      projectName = project.name;
      workspaceSlug = project.workspaceSlug;
      collab = opened;
      void loadWorkspaces().then((list) => {
        const found = list.find((item) => item.slug === project.workspaceSlug && item.deletedAt === null);
        workspace = found ? { slug: found.slug, name: found.name } : null;
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) failure = 'no_access';
      else if (!(error instanceof ApiError && error.status === 401)) phase = 'error';
      return;
    }
    const current = collab;
    chatSession = current;
    loadAiFeatures()
      .then((features) => (aiFeatures = features))
      .catch(() => (aiFeatures = null));
    cleanups.push(current.state.subscribe(onCollabState));
    cleanups.push(
      current.on('stateless', (message) => {
        if (message.type === 'ai.job' && typeof message.jobId === 'string' && typeof message.status === 'string') {
          aiJobEvent = { jobId: message.jobId, status: message.status, n: (aiJobEvent?.n ?? 0) + 1 };
          return;
        }
        if (typeof message.assetId !== 'string') return;
        if (message.type === 'asset.ready') {
          engine?.assetReady(message.assetId);
          assetEvent = { type: 'ready', assetId: message.assetId, n: (assetEvent?.n ?? 0) + 1 };
        } else if (message.type === 'asset.deleted') {
          engine?.assetDeleted(message.assetId);
          assetEvent = { type: 'deleted', assetId: message.assetId, n: (assetEvent?.n ?? 0) + 1 };
        }
      }),
    );
    cleanups.push(
      current.on('reset', () => {
        const camera = engine?.camera();
        const pageId = engine?.state.pageId.get() ?? undefined;
        destroyEngine();
        void mountEngine(camera, pageId);
      }),
    );
    phase = 'ready';
    await tick();
    await mountEngine();
    if (import.meta.env.PUBLIC_TEST_HOOKS === '1') {
      const { installTestHooks } = await import('./editor/test-hooks.ts');
      installTestHooks(() => engine, () => collab, () => container);
    }
  }

  function onCollabState(state: CollabState) {
    collabState = state;
    engine?.setReadOnly(state.readOnly);
    if (state.synced && !fittedOnSync && engine) {
      fittedOnSync = true;
      engine.core.fitWhenReady();
    }
    if (state.failure && state.failure !== failure) handleFailure(state.failure);
  }

  function handleFailure(next: CollabFailure) {
    if (next === 'client_outdated') {
      clientVersion.reloadRequired = true;
      return;
    }
    if (next === 'session_revoked') {
      browser.assign(signInUrl(`${window.location.pathname}${window.location.search}`));
      return;
    }
    destroyEngine();
    failure = next;
  }

  async function mountEngine(camera?: ReturnType<Engine['camera']>, pageId?: string) {
    if (!collab || !container) return;
    const user = collab.user;
    const backend = collab.backend;
    const canvas = createEngineCanvas(container);
    let created: Engine;
    try {
      created = await createEngine({
        canvas,
        container,
        backend,
        user: { id: user.id, name: user.name, color: user.color, avatarAssetId: session.me?.user.avatarAssetId ?? null },
        permissions: { canEdit: !(collabState?.readOnly ?? true) },
        assets: canvasAssets,
        onDropFiles: (files, at) => void insertImages(files, at),
        clipboard: { source: { projectId, workspace: workspaceSlug }, copyAssets: (ids) => copyAssetsTo(projectId, ids) },
        onContextMenu: (request) => (menu = request),
        labels: { textEditor: m.editor_text_label() },
        wheelPref: wheelPreference,
        reducedMotion: motionReduced,
        onFatal: () => {
          crashed = true;
        },
        ...(camera ? { camera } : {}),
        ...(pageId ? { pageId } : {}),
      });
    } catch (error) {
      canvas.remove();
      if (error instanceof RendererUnavailableError) canvasUnavailable = true;
      // Si no, el documento no llegó a abrirse (worker caído o sustituido por otro epoch): lo cuenta collabState.
      return;
    }
    if (collab?.backend !== backend) {
      created.destroy();
      canvas.remove();
      return;
    }
    engine = created;
    engineCanvas = canvas;
    if (collabState?.synced && !camera) {
      fittedOnSync = true;
      created.core.fitWhenReady();
    }
    engineCleanups = [
      created.state.tool.subscribe((value) => (tool = value)),
      created.state.toolLocked.subscribe((value) => (toolLocked = value)),
      created.state.selectionRecords.subscribe((value) => (selection = value.map((record) => ({ ...record })))),
      created.state.history.subscribe((value) => (history = value)),
      created.state.zoom.subscribe((value) => (zoom = value)),
      created.state.readOnly.subscribe((value) => (engineReadOnly = value)),
      created.state.pages.subscribe((value) => (pages = value)),
      created.state.pageId.subscribe((value) => (activePage = value)),
      created.core.framePreset.subscribe((value) => (framePreset = value)),
      created.state.following.subscribe((value) => (following = value)),
      created.contextState.subscribe((value) => (contextState = value)),
      created.inputProfile.subscribe((value) => (inputKind = value.kind)),
      created.core.uiCommand.subscribe(onUiCommand),
      created.core.presence.onRemoteChange(() => {
        people = collaborators(created, user.id);
        typingNames = typingPeople(created, user.id);
      }),
    ];
    previews = new PreviewPublisher({
      core: created.core,
      renderer: created.renderer,
      canPublish: () => !engineReadOnly && collabState?.synced === true,
      upload: (blob) => uploadProjectPreview(projectId, blob),
    });
    people = collaborators(created, user.id);
    typingNames = typingPeople(created, user.id);
    // La línea de tiempo quedó abierta en la sesión anterior: se descarga ya.
    if (layout.timeline.open && !Timeline) void openTimeline(false);
    container.focus({ preventScroll: true });
  }

  // Ctrl/⌘+\ y Ctrl/⌘+Shift+\ llegan del motor, que atiende el teclado del editor.
  function onUiCommand(command: UiCommand | null) {
    if (!command) return;
    if (command.name === 'hideUi') hideInterface();
    else layout.toggleMinimized();
  }

  function hideInterface() {
    layout.toggleHidden();
    // El foco no puede quedarse en un panel que ya no se ve.
    if (layout.ui === 'hidden' && container && !container.contains(document.activeElement)) container.focus({ preventScroll: true });
  }

  function showInterface() {
    layout.toggleHidden();
  }

  // Con el dedo, en tablet y móvil, un toque en un hueco vacío del lienzo cierra el panel izquierdo; el derecho solo
  // se cierra si además no había nada seleccionado (el primer toque vacía la selección). Con ratón no se cierra ninguno.
  const TAP_SLOP = 8;
  let tap: { id: number; x: number; y: number; hadSelection: boolean; selecting: boolean; multi: boolean } | null = null;

  function onCanvasPointerDown(event: PointerEvent) {
    if (event.pointerType !== 'touch') return;
    if (tap) {
      tap.multi = true;
      return;
    }
    tap = { id: event.pointerId, x: event.clientX, y: event.clientY, hadSelection: selection.length > 0, selecting: tool === 'select', multi: false };
  }

  function onCanvasPointerUp(event: PointerEvent) {
    const current = tap;
    if (!current || current.id !== event.pointerId) return;
    tap = null;
    if (current.multi || !current.selecting || !compactLayout || !engine || !container) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > TAP_SLOP) return;
    const rect = container.getBoundingClientRect();
    if (engine.core.pick(event.clientX - rect.left, event.clientY - rect.top, { includeLocked: true })) return;
    if (layout.left === 'open') layout.collapse('left');
    if (!current.hadSelection && layout.right === 'open') layout.collapse('right');
  }

  function onCanvasPointerCancel(event: PointerEvent) {
    if (tap?.id === event.pointerId) tap = null;
  }

  // Sube cada imagen con el propósito 'canvas' y la coloca en `at` (las siguientes, un poco desplazadas).
  async function insertImages(files: File[], at: { x: number; y: number }) {
    const target = engine;
    if (!target || engineReadOnly || !files.length) return;
    showToast({ message: m.editor_image_uploading() });
    let offset = 0;
    for (const file of files.slice(0, MAX_IMAGES_AT_ONCE)) {
      try {
        const asset = await uploadCanvasImage(file, projectId);
        if (engine !== target) return;
        target.commands.insertImage({ assetId: asset.id, width: asset.width, height: asset.height }, { x: at.x + offset, y: at.y + offset });
        offset += IMAGE_STAGGER;
      } catch (error) {
        showToast({ message: error instanceof ApiError ? error.message : m.editor_image_upload_error(), tone: 'error' });
      }
    }
  }

  function pickImages() {
    imageInput?.click();
  }

  function onImagesPicked(event: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (engine) void insertImages(files, engine.viewCenter());
  }

  function collaborators(current: Engine, ownId: string): Collaborator[] {
    // Una persona con varias pestañas aparece una vez.
    const list: Collaborator[] = [];
    for (const [clientId, state] of current.core.presence.remote()) {
      if (state.user.id === ownId || list.some((person) => person.id === state.user.id)) continue;
      list.push({ id: state.user.id, clientId, name: state.user.name, color: state.user.color, avatarAssetId: state.user.avatarAssetId });
    }
    return list;
  }

  function typingPeople(current: Engine, ownId: string): string[] {
    const names = [...current.core.presence.remote().values()]
      .filter((state) => state.chatTyping && state.user.id !== ownId)
      .map((state) => state.user.name);
    return names.filter((name, index) => names.indexOf(name) === index);
  }

  // ClipboardItem recibe la promesa para no perder el gesto del usuario mientras se renderiza.
  function copyAsPng() {
    const current = engine;
    if (!current) return;
    const scene = collectScene(current.core, { kind: 'nodes', ids: [...current.state.selection.get()] });
    if (!scene) {
      showToast({ message: m.export_empty(), tone: 'error' });
      return;
    }
    const blob = renderRaster(current.renderer, scene, { scale: 1, format: 'png', transparent: true }).then((result) => result.blob);
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
      () => showToast({ message: m.editor_copy_png_done(), tone: 'success' }),
      () => showToast({ message: m.editor_copy_png_error(), tone: 'error' }),
    );
  }

  function closeMenu(returnFocus: boolean) {
    menu = null;
    if (returnFocus) container?.focus({ preventScroll: true });
  }

  function startPresenting() {
    if (!engine) return;
    if (!presentationSlides(engine).length) {
      showToast({ message: m.present_no_frames() });
      return;
    }
    menu = null;
    presenting = true;
  }

  function stopPresenting() {
    presenting = false;
    container?.focus({ preventScroll: true });
  }

  function openShare() {
    shareMounted = true;
    shareOpen = true;
  }

  // Con la interfaz minimizada el panel derecho se abre solo con selección; plegarlo a mano deja las dos pastillas
  // sin ese automatismo.
  function collapseRight() {
    if (layout.ui === 'minimized') {
      layout.ui = 'normal';
      layout.collapse('left');
    }
    layout.collapse('right');
  }

  // Alto de la barra de herramientas: las ventanas provisionales acaban por encima de ella.
  const BAR_ROW = 44;
  const WINDOW = 'pointer-events-auto flex min-h-0 touch-pan-x touch-pan-y overflow-hidden rounded-panel border border-edge/40 shadow-float';

  // Permiso perdido: el documento abierto. Epoch nuevo: el que se descartó con cambios sin enviar.
  async function downloadLocal() {
    if (!collab || downloadingLocal) return;
    downloadingLocal = true;
    try {
      const data = await collab.localSnapshot(collabState?.notice === 'local_copy_discarded' ? 'discarded' : 'current');
      if (data) downloadLocalCopy(projectName, data);
      else showToast({ message: m.editor_download_local_error(), tone: 'error' });
    } finally {
      downloadingLocal = false;
    }
  }

  function destroyEngine() {
    menu = null;
    exportOpen = false;
    publishOpen = false;
    presenter?.release();
    presenting = false;
    previews?.destroy();
    previews = null;
    for (const cleanup of engineCleanups) cleanup();
    engineCleanups = [];
    engine?.destroy();
    engine = null;
    engineCanvas?.remove();
    engineCanvas = null;
    contextState = 'ok';
  }

  // La navegación al dashboard cancelaría la subida: se espera como mucho unos segundos.
  const LEAVE_WAIT_MS = 3000;

  function publishBeforeLeaving(): Promise<void> {
    const pending = previews?.publish();
    if (!pending) return Promise.resolve();
    return Promise.race([pending, new Promise<void>((resolve) => setTimeout(resolve, LEAVE_WAIT_MS))]);
  }

  async function rename(name: string): Promise<boolean> {
    try {
      const project = await apiFetch(`/v1/projects/${projectId}`, { method: 'PATCH', body: { name }, schema: ProjectDetailSchema });
      projectName = project.name;
      return true;
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.editor_rename_error(), tone: 'error' });
      return false;
    }
  }

  // El servidor lo compacta cuando ninguna instancia tiene el documento abierto.
  async function requestCompaction() {
    compacting = true;
    try {
      await apiFetch(`/v1/projects/${projectId}/compact`, { method: 'POST' });
      compactRequested = true;
      showToast({ message: m.editor_compact_requested() });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.editor_compact_error(), tone: 'error' });
    } finally {
      compacting = false;
    }
  }

  const NOTICES: Record<CollabNotice, () => string> = {
    size_warning: m.editor_notice_size_warning,
    size_readonly: m.editor_notice_size_readonly,
    node_limit: m.editor_notice_node_limit,
    offline_changes_rejected: m.editor_notice_offline_rejected,
    local_copy_discarded: m.editor_notice_local_discarded,
  };

  const SCREENS: Partial<Record<CollabFailure, { title: () => string; body: () => string; reload?: boolean }>> = {
    engine_crashed: { title: m.editor_engine_crashed_title, body: m.editor_engine_crashed_body, reload: true },
    no_access: { title: m.editor_no_access_title, body: m.editor_no_access_body },
    project_deleted: { title: m.editor_trash_title, body: m.editor_trash_body },
    workspace_deleted: { title: m.editor_workspace_trash_title, body: m.editor_workspace_trash_body },
    document_full: { title: m.editor_full_title, body: m.editor_full_body },
    too_many_tabs: { title: m.editor_tabs_title, body: m.editor_tabs_body },
    unavailable: { title: m.editor_trash_title, body: m.editor_trash_body },
  };

  const screen = $derived(failure ? SCREENS[failure] : undefined);

  // Ctrl+S guarda una versión en vez de abrir el «Guardar como» del navegador.
  // Ctrl/⌘+Shift+K inserta una imagen: es una acción del editor (selector de archivos), no un comando del documento.
  function onWindowKey(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!event.shiftKey && key === 's') {
      if (!versionsPanel) return;
      event.preventDefault();
      if (!engineReadOnly) void versionsPanel.saveVersion();
      return;
    }
    if (event.shiftKey && (key === 'k' || event.code === 'KeyK')) {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest('input, textarea, select, [role="dialog"]')) return;
      event.preventDefault();
      if (!engineReadOnly) pickImages();
    }
  }

  // Versiones es una vista del panel derecho: si está plegado, se abre en ella.
  function toggleVersions() {
    if (versionsOpen && rightOpen) {
      layout.rightView = 'design';
      return;
    }
    layout.rightView = 'versions';
    if (!rightOpen) layout.open('right');
  }

  // El chat y la IA comparten la ventana provisional junto al panel derecho.
  function toggleChat() {
    chatOpen = !chatOpen;
    if (chatOpen) aiOpen = false;
  }

  async function toggleAi() {
    if (aiOpen) {
      aiOpen = false;
      return;
    }
    await openAi();
  }

  // «Enviar al chat de IA» desde la galería: abre el panel en el chat con la imagen adjunta.
  async function sendToAiChat(asset: { assetId: string; name: string }) {
    await openAi();
    aiAttachment = { ...asset, n: (aiAttachment?.n ?? 0) + 1 };
  }

  async function openAi() {
    if (!AiPanel) {
      if (aiLoading) return;
      aiLoading = true;
      try {
        AiPanel = (await import('./editor/ai/AiPanel.svelte')).default;
      } catch {
        showToast({ message: m.editor_load_error(), tone: 'error' });
        return;
      } finally {
        aiLoading = false;
      }
    }
    aiOpen = true;
    chatOpen = false;
  }

  // focus: «Animar…» lleva el foco a la fila de lo seleccionado.
  async function openTimeline(focus: boolean) {
    if (!Timeline) {
      if (timelineLoading) return;
      timelineLoading = true;
      try {
        Timeline = (await import('./editor/timeline/TimelinePanel.svelte')).default;
      } catch {
        showToast({ message: m.editor_load_error(), tone: 'error' });
        return;
      } finally {
        timelineLoading = false;
      }
    }
    layout.timeline.open = true;
    if (focus) timelineFocus += 1;
  }

  function toggleTimeline() {
    if (timelineOpen) layout.timeline.open = false;
    else void openTimeline(false);
  }
</script>

<svelte:window onkeydowncapture={onWindowKey} onpagehide={() => layout.flush()} />

{#if crashed}
  <BlockingScreen title={m.editor_crashed_title()} body={m.editor_crashed_body()} reload />
{:else if canvasUnavailable}
  <BlockingScreen title={m.editor_canvas_unavailable_title()} body={m.editor_canvas_unavailable_body()} reload />
{:else if screen}
  <BlockingScreen title={screen.title()} body={screen.body()} reload={screen.reload ?? false} />
{:else if phase === 'error'}
  <BlockingScreen title={m.editor_load_error()} body={m.error_internal()} reload />
{:else if phase === 'loading' || !collabState}
  <p class="grid h-dvh place-items-center text-sm text-ink-muted" role="status">{m.editor_loading()}</p>
{:else}
  <!-- Orden del DOM = orden de tabulación: panel izquierdo, lienzo, barras, línea de tiempo, panel derecho y ventanas.
       La posición de cada pieza la da el CSS: el lienzo ocupa toda la ventana y lo demás flota encima. -->
  <div bind:this={root} class={['relative h-dvh overflow-hidden', inputKind === 'touch' ? 'touch-ui' : '']} data-ui={layout.ui}>
    {#snippet fileHeader(compact: boolean)}
      {#if collabState}
        <FileHeader
          name={projectName}
          {canRename}
          collab={collabState}
          {compact}
          {canPublish}
          {uiKeys}
          onrename={rename}
          onleave={publishBeforeLeaving}
          onexport={() => (exportOpen = true)}
          ondownload={() => void downloadLocal()}
          onpublish={() => (publishOpen = true)}
          onminimize={() => layout.toggleMinimized()}
          onhide={hideInterface}
          onwheel={() => (wheelOpen = true)}
          onshortcuts={() => (shortcutsOpen = true)}
          ontoggle={() => (compact ? layout.open('left') : layout.collapse('left'))}
        />
      {/if}
    {/snippet}

    {#snippet sessionBar(compact: boolean)}
      <SessionBar
        {compact}
        {people}
        {following}
        {chatOpen}
        {chatUnread}
        versionsOpen={versionsOpen && rightOpen}
        {aiAvailable}
        {aiOpen}
        {canShare}
        onfollow={(clientId) => engine?.follow(clientId)}
        onchat={toggleChat}
        onversions={toggleVersions}
        onai={() => void toggleAi()}
        onpresent={startPresenting}
        onshare={openShare}
        ontoggle={() => (compact ? layout.open('right') : collapseRight())}
      />
    {/snippet}

    {#snippet design()}
      {#if engine}
        <PropertiesPanel
          records={selection}
          commands={engine.commands}
          readOnly={engineReadOnly}
          {tool}
          preset={framePreset}
          onpreset={(next) => engine?.core.framePreset.set(next)}
        />
      {/if}
    {/snippet}

    {#snippet versionsView()}
      {#if chatSession}
        <VersionsPanel
          bind:this={versionsPanel}
          {projectId}
          open={versionsOpen}
          canEdit={!engineReadOnly}
          user={{ id: chatSession.user.id, name: chatSession.user.name, color: chatSession.user.color, avatarAssetId: null }}
          onclose={() => (layout.rightView = 'design')}
        />
      {/if}
    {/snippet}

    <LeftPanel bind:this={leftPanel} bind:width={leftWidth} {engine} readOnly={engineReadOnly} open={leftOpen} hidden={hideUi} clearance={panelClearance} header={fileHeader} />

    <input bind:this={imageInput} type="file" accept={CANVAS_IMAGE_ACCEPT} multiple class="hidden" tabindex="-1" aria-hidden="true" onchange={onImagesPicked} data-testid="image-input" />
    <!-- El lienzo recibe el foco para los atajos de teclado. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={container}
      tabindex="0"
      role="application"
      aria-label={m.editor_canvas_label()}
      onpointerdown={onCanvasPointerDown}
      onpointerup={onCanvasPointerUp}
      onpointercancel={onCanvasPointerCancel}
      class="absolute inset-0 touch-none overflow-hidden outline-none select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral"
    ></div>
    <CanvasHud restoring={contextState === 'lost'} />
    <div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

    {#if followed}
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 border-2" style:border-color={followed.color}></div>
    {/if}
    <!-- Avisos arriba, centrados en el hueco que dejan los paneles. -->
    <div
      class="pointer-events-none absolute top-3 z-(--z-hud) flex flex-col items-center gap-2"
      style:left="{leftEdge + 12}px"
      style:right="{rightEdge + 12}px"
      hidden={presenting || !(followed || collabState.notice)}
    >
      {#if followed}
        <div role="status" class="pointer-events-auto flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-xs shadow-float">
          <span class="size-2 rounded-full" style:background-color={followed.color} aria-hidden="true"></span>
          {m.editor_following({ name: followed.name })}
          <button type="button" onclick={() => engine?.follow(null)} class="h-7 cursor-pointer rounded-full px-2.5 font-semibold hover:bg-petrol">
            {m.editor_follow_stop()}
          </button>
        </div>
      {/if}

      {#if collabState.notice}
        <div role="status" class="pointer-events-auto flex w-full max-w-136 items-start gap-3 rounded-panel bg-surface-2 py-2.5 pr-2 pl-4 text-sm shadow-float">
          <p class="flex-1">{NOTICES[collabState.notice]()}</p>
          {#if (collabState.notice === 'size_warning' || collabState.notice === 'size_readonly') && collabState.role === 'admin' && !compactRequested}
            <button
              type="button"
              disabled={compacting}
              onclick={requestCompaction}
              class="h-8 shrink-0 cursor-pointer rounded-full px-3 font-semibold text-coral hover:bg-petrol disabled:cursor-wait disabled:opacity-60"
            >
              {m.editor_compact_request()}
            </button>
          {/if}
          {#if collabState.notice === 'local_copy_discarded' || collabState.notice === 'offline_changes_rejected'}
            <button
              type="button"
              disabled={downloadingLocal}
              aria-describedby="download-local-hint"
              onclick={downloadLocal}
              class="h-8 shrink-0 cursor-pointer rounded-full px-3 font-semibold text-coral hover:bg-petrol disabled:cursor-wait disabled:opacity-60"
              data-testid="download-local"
            >
              {m.editor_download_local()}
            </button>
            <span id="download-local-hint" class="sr-only">{m.editor_download_local_hint()}</span>
          {/if}
          <button
            type="button"
            aria-label={m.common_close()}
            onclick={() => collab?.dismissNotice()}
            class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-petrol hover:text-ink"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      {/if}
    </div>

    <!-- La barra de herramientas va antes que la de zoom en el DOM: es el orden de tabulación. La rejilla la centra en
         el hueco entre los paneles mientras cabe y, si no, sube el zoom y el minimapa a la fila de encima. -->
    <div
      bind:clientWidth={barsWidth}
      bind:offsetHeight={barsHeight}
      hidden={hideUi}
      class={['pointer-events-none absolute z-(--z-toolbar) grid items-end gap-2', barsStacked ? 'grid-cols-1' : 'grid-cols-[1fr_auto_1fr]']}
      style:left="{barsLeft + 12}px"
      style:right="{barsRight + 12}px"
      style:bottom="{bottomEdge + 12}px"
      data-testid="canvas-bars"
    >
      <div bind:offsetWidth={toolbarWidth} class={['flex', barsStacked ? 'col-start-1 row-start-2 justify-self-center' : 'col-start-2 row-start-1']}>
        <FloatingToolbar
          {tool}
          {toolLocked}
          readOnly={engineReadOnly}
          gallery={galleryOpen}
          {timelineOpen}
          {timelineLoading}
          {aiAvailable}
          {aiOpen}
          onselect={(next, locked) => engine?.commands.setTool(next, { locked: locked === true })}
          onimage={pickImages}
          ongallery={() => (galleryOpen = !galleryOpen)}
          onanimate={toggleTimeline}
          onai={toggleAi}
        />
      </div>
      <div bind:offsetWidth={zoomWidth} class="col-start-1 row-start-1 flex justify-self-start">
        <ZoomBar
          {zoom}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          readOnly={engineReadOnly}
          {minimapOpen}
          onundo={() => engine?.commands.undo()}
          onredo={() => engine?.commands.redo()}
          onzoomin={() => engine?.commands.zoomIn()}
          onzoomout={() => engine?.commands.zoomOut()}
          onzoomreset={() => engine?.commands.zoomTo(1)}
          onfitall={() => engine?.commands.fitAll()}
          onfitselection={() => engine?.commands.zoomToSelection()}
          onminimap={() => (minimapOpen = !minimapOpen)}
        />
      </div>
      {#if minimapOpen && engine}
        <div bind:offsetWidth={minimapWidth} class={['pointer-events-auto row-start-1 justify-self-end', barsStacked ? 'col-start-1' : 'col-start-3']}>
          <Minimap {engine} />
        </div>
      {/if}
    </div>

    {#if timelineLoading}
      <p role="status" class="sr-only">{m.timeline_loading()}</p>
    {/if}
    {#if Timeline && engine}
      <div
        bind:offsetHeight={timelineHeight}
        hidden={hideUi || !timelineOpen}
        class="absolute bottom-2 z-(--z-panel) touch-pan-x touch-pan-y rounded-panel border border-edge/40 bg-surface-1 shadow-panel *:rounded-[9px] *:border-t-0"
        style:left="{leftEdge + 8}px"
        style:right="{rightEdge + 8}px"
      >
        <Timeline
          {engine}
          {projectId}
          readOnly={engineReadOnly}
          aiAnimation={!!aiFeatures?.animation && !engineReadOnly}
          open={timelineOpen}
          focusRequest={timelineFocus}
          onclose={() => (layout.timeline.open = false)}
        />
      </div>
    {/if}

    <RightPanel bind:width={rightWidth} open={rightOpen} hidden={hideUi} clearance={panelClearance} header={sessionBar} {design} versions={versionsView} />

    <!-- Galería, chat e IA flotan a la izquierda del panel derecho hasta que tengan su ventana propia. -->
    <div
      hidden={hideUi}
      class="pointer-events-none absolute z-(--z-window) flex justify-end gap-2"
      style:top="{rightOpen ? 8 : 56}px"
      style:bottom="{bottomEdge + 12 + BAR_ROW + 8}px"
      style:left="{leftEdge + 8}px"
      style:right="{rightEdge + 8}px"
    >
      {#if galleryOpen && engine}
        <div class={WINDOW}>
          <GalleryPanel
            {engine}
            {projectId}
            readOnly={engineReadOnly}
            {assetEvent}
            jobEvent={aiJobEvent}
            canGenerate={!!aiFeatures?.image && !engineReadOnly}
            onsendtochat={aiFeatures?.chat && !engineReadOnly ? (asset) => void sendToAiChat(asset) : null}
            onclose={() => (galleryOpen = false)}
          />
        </div>
      {/if}
      {#if chatSession}
        <!-- Montado aunque esté cerrado: cuenta los no leídos y recibe los mensajes en vivo. -->
        <div hidden={!chatOpen} class={WINDOW}>
          <ChatPanel
            {projectId}
            session={chatSession}
            me={{ id: chatSession.user.id, name: chatSession.user.name, avatarAssetId: session.me?.user.avatarAssetId ?? null }}
            role={collabState.role ?? 'viewer'}
            open={chatOpen}
            status={collabState.status}
            {typingNames}
            ontyping={(value) => engine?.core.presence.update({ chatTyping: value })}
            onunread={(count) => (chatUnread = count)}
            onclose={() => (chatOpen = false)}
          />
        </div>
      {/if}
      {#if AiPanel && aiOpen && aiAvailable && aiFeatures && engine}
        <div class={WINDOW}>
          <AiPanel
            {engine}
            {projectId}
            features={aiFeatures}
            readOnly={engineReadOnly}
            attachment={aiAttachment}
            onclose={() => {
              aiOpen = false;
              aiAttachment = null;
            }}
          />
        </div>
      {/if}
    </div>

    {#if presenting && engine && root}
      <Present bind:this={presenter} {engine} host={root} onclose={stopPresenting} />
    {/if}

    {#if layout.ui === 'hidden' && !presenting}
      <Tooltip text={m.editor_show_ui()} kbd={uiKeys.hide} side="left">
        {#snippet children(props)}
          <button
            {...props}
            type="button"
            aria-label={m.editor_show_ui()}
            aria-keyshortcuts={uiKeys.hideAria}
            onclick={showInterface}
            class="absolute top-2 right-2 z-(--z-toolbar) inline-flex size-8 cursor-pointer items-center justify-center rounded-panel border border-edge/40 bg-surface-2 text-ink-muted shadow-float transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink"
            data-testid="show-ui"
          >
            <Eye size={16} aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
    {/if}
  </div>
  {#if menu && engine}
    {#key menu}
      <ContextMenu
        {engine}
        request={menu}
        readOnly={engineReadOnly}
        onclose={closeMenu}
        onanimate={() => void openTimeline(true)}
        oncopypng={copyAsPng}
        onexport={() => (exportOpen = true)}
        onrename={(id) => void leftPanel?.rename(id)}
      />
    {/key}
  {/if}
  {#if engine}
    <ExportDialog bind:open={exportOpen} {engine} {projectId} {projectName} />
  {/if}
  <ShortcutsDialog bind:open={shortcutsOpen} {uiKeys} />
  <WheelDialog bind:open={wheelOpen} />
  {#if shareMounted && canShare}
    {#await import('./share/SharePanel.svelte') then { default: SharePanel }}
      <SharePanel bind:open={shareOpen} {projectId} {projectName} meId={session.me?.user.id ?? ''} myRole="admin" />
    {/await}
  {/if}
  {#if workspace && canPublish}
    <PublishTemplateDialog
      bind:open={publishOpen}
      {projectId}
      {projectName}
      workspaceSlug={workspace.slug}
      workspaceName={workspace.name}
      beforePublish={publishBeforeLeaving}
    />
  {/if}
{/if}
