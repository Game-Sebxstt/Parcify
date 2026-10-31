<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import { BitsConfig } from 'bits-ui';
  import X from '@lucide/svelte/icons/x';
  import { onMount, tick, untrack } from 'svelte';
  import { on } from 'svelte/events';
  import { describeSelection, displayName, kindOf } from '../engine/a11y/describe.ts';
  import {
    createEngine,
    OWN_WHEEL_ATTR,
    RendererUnavailableError,
    type ActiveVertex,
    type ContextMenuRequest,
    type ContextState,
    type Engine,
    type FramePresetId,
    type Hud,
    type NodeRecord,
    type NotAnimatedKey,
    type PageRecord,
    type PointerKind,
    type RecordedNotice,
    type ScreenRect,
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
  import ConversationWindow from './editor/chat/ConversationWindow.svelte';
  import ContextMenu from './editor/ContextMenu.svelte';
  import ExportDialog from './editor/ExportDialog.svelte';
  import GalleryWindow from './editor/GalleryWindow.svelte';
  import type { WindowRect } from '../ui/floating-window.svelte.ts';
  import { describeLabels, kindLabel } from './editor/kinds.ts';
  import Minimap from './editor/Minimap.svelte';
  import Present, { presentationSlides } from './editor/Present.svelte';
  import { downloadLocalCopy } from '../lib/local-copy.ts';
  import PropertiesPanel from './editor/properties/PropertiesPanel.svelte';
  import ContextBar from './editor/toolbar/ContextBar.svelte';
  import AnimationsSheet from './editor/mobile/AnimationsSheet.svelte';
  import GallerySheet from './editor/mobile/GallerySheet.svelte';
  import LayersSheet from './editor/mobile/LayersSheet.svelte';
  import MobileMenuSheet, { type MobileMenuEntry } from './editor/mobile/MobileMenuSheet.svelte';
  import MobileTopBar from './editor/mobile/MobileTopBar.svelte';
  import PropertiesSheet from './editor/mobile/PropertiesSheet.svelte';
  import RenameSheet from './editor/mobile/RenameSheet.svelte';
  import TimelineSheet from './editor/mobile/TimelineSheet.svelte';
  import VersionsSheet from './editor/mobile/VersionsSheet.svelte';
  import FloatingToolbar from './editor/toolbar/FloatingToolbar.svelte';
  import ZoomBar from './editor/toolbar/ZoomBar.svelte';
  import FileHeader from './editor/layout/FileHeader.svelte';
  import LeftPanel from './editor/layout/LeftPanel.svelte';
  import RightPanel from './editor/layout/RightPanel.svelte';
  import SessionBar, { type Collaborator } from './editor/layout/SessionBar.svelte';
  import ShortcutsDialog from './editor/layout/ShortcutsDialog.svelte';
  import WheelDialog from './editor/layout/WheelDialog.svelte';
  import { DEFAULT_UI_KEYS, loadUiKeys, type UiKeys } from './editor/layout/ui-keys.ts';
  import VersionOverlay from './editor/VersionOverlay.svelte';
  import VersionsPanel from './editor/VersionsPanel.svelte';
  import { setVersionViewer, VersionViewer } from './editor/versions/version-viewer.svelte.ts';
  import { setVersionThumbnails, VersionThumbnails } from './editor/versions/version-thumbnails.ts';
  import ConfirmDialog from './dashboard/ConfirmDialog.svelte';
  import Tooltip from '../ui/Tooltip.svelte';
  import { EditorLayout, setEditorLayout } from '../lib/editor-layout.svelte.ts';
  import { Viewport } from '../lib/viewport.svelte.ts';
  import type TimelinePanel from './editor/timeline/TimelinePanel.svelte';
  import { formatTime, propLabel } from './editor/timeline/model.ts';
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
  // Caja en pantalla de la selección para la barra contextual (null mientras el motor la oculta).
  let selectionRect = $state.raw<ScreenRect | null>(null);
  let hud = $state.raw<Hud | null>(null);
  let activeVertex = $state.raw<ActiveVertex | null>(null);
  let pointLimit = $state(false);
  let penPoints = $state(0);
  // Se escribe un nodo de texto (no el texto interior de una forma): la barra contextual no le quita el foco.
  let editingText = $state(false);
  let history = $state({ canUndo: false, canRedo: false });
  let zoom = $state(1);
  let engineReadOnly = $state(true);
  let people = $state<Collaborator[]>([]);
  let framePreset = $state<FramePresetId>('16:9');
  let pages = $state.raw<readonly PageRecord[]>([]);
  let activePage = $state<string | null>(null);
  let workspaceSlug = '';
  let menu = $state.raw<ContextMenuRequest | null>(null);
  let exportOpen = $state(false);
  let publishOpen = $state(false);
  // El panel Compartir se descarga la primera vez que se abre.
  let shareOpen = $state(false);
  let shareMounted = $state(false);
  // Publicar como plantilla exige ser admin del proyecto y miembro del espacio.
  let workspace = $state.raw<{ slug: string; name: string } | null>(null);
  let presenting = $state(false);
  let presenter = $state<ReturnType<typeof Present> | null>(null);
  let presentMode = $state<'frames' | 'page'>('frames');
  // Página sin frames: se pregunta si se presenta entera.
  let presentPageAsk = $state(false);
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
  // Mientras se reproduce (o hay una propuesta de la IA en vista previa) no se graba: lo que se ve no es el cabezal.
  let animPlaying = $state(false);
  let aiProposed = $state(false);
  // Lo que anuncia el lector de pantalla al grabar un keyframe sin Grabar (el borde ya marca Grabar).
  let recordAnnouncement = $state('');
  let chatUnread = $state(0);
  // Funciones de IA con modelo configurado; el panel se descarga la primera vez que se abre.
  let aiFeatures = $state.raw<AiFeatures | null>(null);
  let AiPanel = $state.raw<typeof AiPanelComponent | null>(null);
  let aiLoading = $state(false);
  // Tras un fallo al descargar el panel no se reintenta solo: la pestaña muestra el error con Reintentar.
  let aiLoadFailed = $state(false);
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
  // Vista previa de versiones: la abre el panel de versiones y se pinta en la superposición sobre el lienzo.
  const viewer = new VersionViewer({
    projectId: () => projectId,
    user: () => ({ id: collab?.user.id ?? '', name: collab?.user.name ?? '', color: collab?.user.color ?? '#888888', avatarAssetId: null }),
    activePage: () => activePage,
    fallbackFocus: () => container,
  });
  setVersionViewer(viewer);
  // Miniaturas de la lista de versiones, pintadas con el renderer del motor montado.
  const thumbnails = new VersionThumbnails(() => projectId);
  setVersionThumbnails(thumbnails);
  let uiKeys = $state.raw<UiKeys>(DEFAULT_UI_KEYS);
  let shortcutsOpen = $state(false);
  let wheelOpen = $state(false);
  // Último puntero con el que se trabajó en el lienzo: con el dedo no hay hover y los controles se ven siempre.
  let inputKind = $state<PointerKind>('mouse');
  let leftWidth = $state(0);
  let rightWidth = $state(0);
  let leftPillWidth = $state(0);
  let leftPillHeight = $state(0);
  let rightPillWidth = $state(0);
  let rightPillHeight = $state(0);
  let timelineHeight = $state(0);

  const timelineOpen = $derived(layout.timeline.open);
  const versionsOpen = $derived(layout.rightView === 'versions');
  const compactLayout = $derived(viewport.mode !== 'desktop');
  // Móvil (< 640 px): barra superior compacta, barra inferior a todo el ancho y hojas inferiores; sin pastillas.
  const mobile = $derived(viewport.mode === 'mobile');
  // Con el teclado virtual abierto se ocultan las barras de abajo, salvo los controles del texto que se escribe.
  const keyboardUp = $derived(mobile && viewport.keyboardInset > 0);
  let topBarHeight = $state(0);
  let dockHeight = $state(0);
  let mobileMenuOpen = $state(false);
  let menuSheetHeight = $state(0);
  // Hoja «Renombrar» del móvil: el proyecto (toque en el nombre) o un nodo («Renombrar» de la hoja de acciones).
  let renaming = $state.raw<{ kind: 'project' } | { kind: 'node'; id: string; name: string } | null>(null);
  let renameSheetHeight = $state(0);
  // Hojas de contenido del móvil. La línea de tiempo, la conversación y la galería guardan su estado en EditorLayout
  // (el mismo que en escritorio); estas cuatro solo existen en el móvil.
  type ContentSheet = 'properties' | 'layers' | 'animations' | 'versions';
  let mobileSheet = $state<ContentSheet | null>(null);
  let contentSheetHeight = $state(0);
  let timelineSheetHeight = $state(0);
  let gallerySheetHeight = $state(0);
  let conversationSheetHeight = $state(0);
  const hideUi = $derived(presenting || layout.ui === 'hidden');
  // Mientras el menú ⋯ o «Renombrar» están abiertos, o se ve una versión a pantalla completa, las hojas de contenido
  // se esconden sin perder su estado y vuelven al terminar: solo hay una hoja no modal a la vez.
  const sheetsSuspended = $derived(mobileMenuOpen || renaming !== null || viewer.viewing !== null);
  const sheetsShown = $derived(mobile && !hideUi && !sheetsSuspended);
  // «Propiedades» puede abrirse con la línea de tiempo abierta (para grabar desde la hoja): la tapa sin cerrarla.
  const timelineSheetShown = $derived(sheetsShown && layout.timeline.open && mobileSheet === null && !!Timeline);
  const gallerySheetShown = $derived(sheetsShown && layout.gallery.open);
  const conversationSheetShown = $derived(sheetsShown && layout.conversation.open && !layout.conversation.minimized);
  // Lo que tapa por abajo la hoja no modal abierta (con el teclado, también él).
  const sheetInset = $derived.by(() => {
    if (!mobile) return 0;
    const height = Math.max(
      mobileMenuOpen ? menuSheetHeight : 0,
      renaming ? renameSheetHeight : 0,
      sheetsShown && mobileSheet ? contentSheetHeight : 0,
      timelineSheetShown ? timelineSheetHeight : 0,
      gallerySheetShown ? gallerySheetHeight : 0,
      conversationSheetShown ? conversationSheetHeight : 0,
    );
    return height ? height + viewport.keyboardInset : 0;
  });
  // En el móvil no hay paneles laterales: su contenido va en las hojas.
  const leftOpen = $derived(!mobile && !hideUi && layout.ui === 'normal' && layout.left === 'open');
  // Con la interfaz minimizada, el panel derecho se abre solo mientras hay selección.
  const rightOpen = $derived(!mobile && !hideUi && (layout.ui === 'normal' ? layout.right === 'open' : selection.length > 0));
  // Borde interior de cada panel abierto, en px desde el borde de la ventana (8 de margen más su ancho).
  const leftEdge = $derived(leftOpen ? 8 + (leftWidth || layout.leftWidth) : 0);
  const rightEdge = $derived(rightOpen ? 8 + (rightWidth || layout.rightWidth) : 0);
  // Vista previa de versiones en escritorio y tablet: empieza a 8 px de arriba y lo que queda arriba en los bordes
  // (pastillas de los paneles plegados o «Mostrar la interfaz») sube por encima de ella, dentro de su barra.
  const overlayDocked = $derived(viewer.viewing !== null && !presenting && viewport.mode !== 'mobile');
  const SHOW_UI_SIZE = 32;
  const overlayPills = $derived.by(() => {
    const showUi = layout.ui === 'hidden' && !presenting;
    const left = !hideUi && !leftOpen ? leftPillWidth : 0;
    const right = !hideUi && !rightOpen ? rightPillWidth : showUi ? SHOW_UI_SIZE : 0;
    const height = Math.max(left ? leftPillHeight : 0, !hideUi && !rightOpen ? rightPillHeight : showUi ? SHOW_UI_SIZE : 0);
    return { left, right, height };
  });
  const bottomEdge = $derived(!mobile && !hideUi && timelineOpen && Timeline && timelineHeight ? 8 + timelineHeight : 0);
  // En tablet los paneles abiertos flotan sin reservar sitio: abrirlos no cambia el encuadre ni mueve las barras de
  // abajo, que quedan por encima de ellos.
  const barsLeft = $derived(compactLayout ? 0 : leftEdge);
  const barsRight = $derived(compactLayout ? 0 : rightEdge);
  // Por eso en tablet el contenido de los paneles termina por encima de las barras: la última capa sigue al alcance.
  let barsHeight = $state(0);
  // Las barras de abajo quedan a 12 px del borde, o 8 px por encima de la línea de tiempo abierta. Con el dedo, 20 px:
  // la zona de toque del asa de la línea de tiempo crece 18 px hacia arriba y las barras no deben taparla.
  const barsBottom = $derived(bottomEdge ? bottomEdge + (inputKind === 'touch' ? 20 : 8) : 12);
  const panelClearance = $derived(compactLayout && !mobile && !hideUi && barsHeight ? bottomEdge + barsHeight + 8 : 0);

  // Herramientas de creación: en el móvil, con una activa y sin selección, la barra contextual ofrece sus modificadores.
  const CREATE_TOOLS = new Set<Tool>(['frame', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc', 'line', 'arrow', 'connector', 'text']);
  const createTool = $derived(mobile && CREATE_TOOLS.has(tool) ? tool : null);
  const contextShown = $derived(
    (selection.length > 0 || tool === 'pen' || createTool !== null) && !hideUi && !engineReadOnly && (!keyboardUp || editingText),
  );
  // En el móvil la barra contextual va encima de la barra inferior, o encima del teclado mientras se escribe.
  const CONTEXT_BAR_HEIGHT = 52;
  const contextBottom = $derived(keyboardUp ? viewport.keyboardInset : hideUi ? 0 : dockHeight);
  const mobileBarsHeight = $derived(hideUi ? 0 : (keyboardUp ? 0 : dockHeight) + (contextShown ? CONTEXT_BAR_HEIGHT : 0));

  const insets = $derived(
    mobile
      ? { top: hideUi ? 0 : topBarHeight, left: 0, right: 0, bottom: Math.max(mobileBarsHeight + (keyboardUp ? viewport.keyboardInset : 0), sheetInset) }
      : {
          top: 0,
          left: leftEdge && !compactLayout ? leftEdge + 8 : 0,
          right: rightEdge && !compactLayout ? rightEdge + 8 : 0,
          bottom: bottomEdge ? bottomEdge + 8 : 0,
        },
  );

  // Una hoja que sube por abajo no tapa la selección: si queda debajo, la cámara la sube lo que haga falta.
  let revealedInset = 0;
  $effect(() => {
    const inset = sheetInset;
    const grew = inset > revealedInset;
    revealedInset = inset;
    if (grew) untrack(() => revealSelection(inset));
  });

  function revealSelection(inset: number) {
    const rect = selectionRect;
    const current = engine;
    if (!rect || !current || !container) return;
    const box = container.getBoundingClientRect();
    const lowest = box.top + rect.y + rect.height;
    const limit = viewport.height - inset - 16;
    if (lowest <= limit) return;
    // Sin llevar su borde superior por debajo de la barra de arriba.
    const room = box.top + rect.y - (topBarHeight + 16);
    const dy = Math.min(lowest - limit, Math.max(0, room));
    if (dy <= 0) return;
    current.core.camera.panBy(0, -dy);
    current.core.requestFrame();
  }

  $effect(() => {
    engine?.setViewInsets(insets);
  });

  // Los conmutadores táctiles del lienzo solo valen con la maqueta móvil, que es la que los muestra. Al salir de ella
  // se apagan los que solo existen ahí; «Añadir a la selección» se queda para la línea de tiempo.
  $effect(() => {
    const core = engine?.core;
    if (!core) return;
    const onCanvas = mobile;
    untrack(() => {
      core.canvasTouchModifiers.set(onCanvas);
      if (!onCanvas) core.touchModifiers.set({ ...core.touchModifiers.get(), proportional: false, fromCenter: false, step15: false });
    });
  });

  // Al entrar en la maqueta móvil desde una ventana más ancha puede haber varias superficies abiertas: se queda una
  // (la línea de tiempo, si está, para no cortar la grabación; si no, la conversación).
  $effect(() => {
    if (!mobile) return;
    untrack(() => {
      if (layout.timeline.open) {
        layout.conversation.open = false;
        layout.gallery.open = false;
      } else if (layout.conversation.open && !layout.conversation.minimized) {
        layout.gallery.open = false;
      }
    });
  });

  // Se graba solo con la línea de tiempo abierta y sin presentar. Grabar encendido graba todo lo animable; apagado,
  // solo lo que ya está animado.
  const recordingAt = $derived(
    layout.timeline.open && Timeline && !presenting && !engineReadOnly && !animPlaying && !aiProposed ? layout.timeline.head : null,
  );
  const recordMode = $derived(layout.timeline.recording ? 'all' : 'tracked');
  // Cada aviso de «no se anima» sale una vez por propiedad mientras dura la misma grabación.
  let shownNotices: NotAnimatedKey[] = [];
  let recordSession = '';

  $effect(() => {
    const session = recordingAt === null ? '' : recordMode;
    if (session !== recordSession) shownNotices = [];
    recordSession = session;
    engine?.anim.record(recordingAt, recordMode);
  });

  // La barra contextual no pisa los paneles abiertos, las pastillas de arriba ni las barras de abajo.
  const contextAvoid = $derived({
    top: leftOpen && rightOpen ? 8 : 56,
    left: leftEdge + 8,
    right: rightEdge + 8,
    bottom: barsBottom + barsHeight + 8,
  });

  let container = $state<HTMLDivElement | null>(null);
  // Canvas del motor montado (cada montaje crea el suyo, ver createEngineCanvas).
  let engineCanvas: HTMLCanvasElement | null = null;
  let imageInput = $state<HTMLInputElement | null>(null);
  // Como mucho tantas imágenes por cada vez que se suelta o se elige.
  const MAX_IMAGES_AT_ONCE = 10;
  const IMAGE_STAGGER = 24;
  let engine: Engine | null = $state.raw(null);
  // Bloqueado el nodo o uno de sus contenedores: la barra contextual solo ofrece «Más…».
  const selectionLocked = $derived.by(() => {
    const current = engine;
    return current !== null && selection.length > 0 && current.core.anyLocked(selection.map((record) => record.id));
  });
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
  // Chat e IA comparten una ventana flotante con dos pestañas; sus botones se ven pulsados según la pestaña visible.
  const conversationTab = $derived(layout.conversation.tab === 'ai' && aiAvailable ? 'ai' : 'team');
  const conversationShown = $derived(layout.conversation.open && !layout.conversation.minimized);
  const chatOpen = $derived(conversationShown && conversationTab === 'team');
  const aiOpen = $derived(conversationShown && conversationTab === 'ai');
  let conversationWindow = $state<ReturnType<typeof ConversationWindow> | null>(null);
  let galleryWindow = $state<ReturnType<typeof GalleryWindow> | null>(null);
  // Botón que abrió cada ventana: ahí vuelve el foco al minimizarla o cerrarla.
  let conversationOpener: HTMLElement | null = null;
  let galleryOpener: HTMLElement | null = null;

  // Abiertas tras recargar en la pestaña IA: se descarga el panel.
  $effect(() => {
    if (layout.conversation.open && layout.conversation.tab === 'ai' && aiAvailable && !AiPanel && !aiLoadFailed) {
      untrack(() => void loadAiPanel());
    }
  });

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
      thumbnails.destroy();
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
      installTestHooks(
        () => engine,
        () => collab,
        () => container,
        () => viewer.preview?.engine ?? null,
      );
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
        onContextMenu: (request) => {
          menuTrigger = null;
          menu = request;
        },
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
    thumbnails.setRenderer(created.renderer);
    if (collabState?.synced && !camera) {
      fittedOnSync = true;
      created.core.fitWhenReady();
    }
    engineCleanups = [
      created.state.tool.subscribe((value) => (tool = value)),
      created.state.toolLocked.subscribe((value) => (toolLocked = value)),
      created.state.selectionRecords.subscribe((value) => (selection = value.map((record) => ({ ...record })))),
      created.core.selectionScreenRect.subscribe((value) => (selectionRect = value)),
      created.core.hud.subscribe((value) => (hud = value)),
      created.state.activeVertex.subscribe((value) => (activeVertex = value)),
      created.state.pointLimit.subscribe((value) => (pointLimit = value)),
      created.state.penPoints.subscribe((value) => (penPoints = value)),
      created.state.editingText.subscribe((value) => (editingText = value?.kind === 'text')),
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
      created.anim.state.subscribe((value) => (animPlaying = value.status === 'playing')),
      created.core.aiAnimations.subscribe((value) => (aiProposed = value !== null)),
      created.anim.notice.subscribe(onNotAnimated),
      created.anim.recorded.subscribe(onRecorded),
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
    else if (command.name === 'minimizeUi') layout.toggleMinimized();
    else if (layout.timeline.open && !engineReadOnly && !aiProposed) layout.timeline.recording = !layout.timeline.recording;
  }

  const NOT_ANIMATED: Record<NotAnimatedKey, () => string> = {
    textSize: m.editor_not_animated_text_size,
    groupSize: m.editor_not_animated_group_size,
    flip: m.editor_not_animated_flip,
    line: m.editor_not_animated_line,
    radius: m.editor_not_animated_radius,
    strokeWidth: m.editor_not_animated_stroke_width,
    strokeStyle: m.editor_not_animated_stroke_style,
    shadow: m.editor_not_animated_shadow,
    visibility: m.editor_not_animated_visibility,
    font: m.editor_not_animated_font,
    other: m.editor_not_animated_other,
  };

  // El toast vive en una región aria-live: lo leen también los lectores de pantalla.
  function onNotAnimated(notice: { key: NotAnimatedKey; n: number } | null) {
    if (!notice || shownNotices.includes(notice.key)) return;
    shownNotices = [...shownNotices, notice.key];
    showToast({ message: NOT_ANIMATED[notice.key]() });
  }

  // Sin Grabar no hay borde que avise: cada cambio grabado se anuncia una vez.
  function onRecorded(recorded: RecordedNotice | null) {
    if (!recorded || recorded.mode !== 'tracked') return;
    recordAnnouncement = m.editor_keyframe_recorded({ props: recorded.props.map(propLabel).join(', '), time: formatTime(recorded.time) });
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

  function onUiPointerDown(event: PointerEvent) {
    inputKind = event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse';
  }

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
    if (current.multi || !current.selecting || !compactLayout || mobile || !engine || !container) return;
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

  // «Reemplazar…» de la barra contextual: otra imagen en el mismo nodo.
  let replaceInput = $state<HTMLInputElement | null>(null);
  let replaceTarget: string | null = null;

  function pickReplacement(id: string) {
    replaceTarget = id;
    replaceInput?.click();
  }

  async function onReplacementPicked(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const id = replaceTarget;
    replaceTarget = null;
    const target = engine;
    if (!file || !id || !target || engineReadOnly) return;
    showToast({ message: m.editor_image_uploading() });
    try {
      const asset = await uploadCanvasImage(file, projectId);
      if (engine === target) target.commands.replaceImage(id, { assetId: asset.id, width: asset.width, height: asset.height });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.editor_image_upload_error(), tone: 'error' });
    }
  }

  // «Más…» de la barra contextual abre el menú contextual debajo del botón; «Pegar» pega en ese punto.
  // Al cerrarse, el foco vuelve al botón que abrió el menú si sigue montado.
  let menuTrigger: HTMLElement | null = null;

  function openMoreMenu(at: { clientX: number; clientY: number }) {
    if (!engine || !container) return;
    menuTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = container.getBoundingClientRect();
    const world = engine.core.camera.screenToWorld(at.clientX - box.left, at.clientY - box.top);
    // En el móvil, «Más…» abre la misma hoja de acciones que la pulsación larga.
    menu = { clientX: at.clientX, clientY: at.clientY, at: { x: world.x, y: world.y }, pointerType: mobile ? 'touch' : 'mouse' };
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
    const trigger = menuTrigger;
    menuTrigger = null;
    if (!returnFocus) return;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else container?.focus({ preventScroll: true });
  }

  function startPresenting() {
    if (!engine) return;
    if (!presentationSlides(engine).length) {
      presentPageAsk = true;
      return;
    }
    beginPresenting('frames');
  }

  function beginPresenting(mode: 'frames' | 'page') {
    if (!engine) return;
    presentPageAsk = false;
    menu = null;
    viewer.close();
    presentMode = mode;
    presenting = true;
  }

  // El diálogo se cierra antes de presentar: si el portal de bits-ui cambia de destino (body → raíz) mientras se
  // cierra, el diálogo se vuelve a montar abierto y, al salir de Presentar, queda tapando el editor.
  async function presentWholePage() {
    presentPageAsk = false;
    await tick();
    beginPresenting('page');
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
    viewer.close();
    thumbnails.setRenderer(null);
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
    selectionRect = null;
    hud = null;
    activeVertex = null;
    pointLimit = false;
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
    if (event.key === 'Escape' && stopPreviewFrom(event.target)) {
      event.preventDefault();
      return;
    }
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
      if (target?.isContentEditable || target?.closest('input, textarea, select, [role="dialog"], [data-own-stage]')) return;
      event.preventDefault();
      if (!engineReadOnly) pickImages();
    }
  }

  // Esc con el foco en un panel lateral detiene la vista previa de una animación (en el lienzo la detiene el motor).
  function stopPreviewFrom(target: EventTarget | null): boolean {
    if (!engine?.anim.state.get().preview || !(target instanceof Element)) return false;
    if (!target.closest('[data-testid="left-panel"], [data-testid="right-panel"]')) return false;
    engine.anim.preview(null);
    return true;
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

  function focusedButton(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && !container?.contains(active) ? active : null;
  }

  // Abre la ventana de conversación en una pestaña (o la saca de la píldora) y lleva el foco a su compositor.
  function showConversation(tab: 'team' | 'ai') {
    conversationOpener = focusedButton();
    layout.conversation.tab = tab;
    layout.conversation.open = true;
    layout.conversation.minimized = false;
    void conversationWindow?.focus();
  }

  // Pulsado con la pestaña visible, el botón cierra la ventana; si no, la abre (o la cambia) en su pestaña.
  function toggleChat() {
    if (chatOpen) layout.conversation.open = false;
    else showConversation('team');
  }

  async function toggleAi() {
    if (aiOpen) {
      layout.conversation.open = false;
      return;
    }
    await openAi();
  }

  // «Enviar al chat de IA» desde la galería: abre la pestaña IA en el chat con la imagen adjunta.
  async function sendToAiChat(asset: { assetId: string; name: string }) {
    // En el móvil, la conversación sustituye a la hoja de la galería.
    if (mobile) closeMobileSurfaces();
    await openAi();
    aiAttachment = { ...asset, n: (aiAttachment?.n ?? 0) + 1 };
  }

  async function loadAiPanel(): Promise<boolean> {
    if (AiPanel) return true;
    if (aiLoading) return false;
    aiLoading = true;
    aiLoadFailed = false;
    try {
      AiPanel = (await import('./editor/ai/AiPanel.svelte')).default;
      return true;
    } catch {
      aiLoadFailed = true;
      return false;
    } finally {
      aiLoading = false;
    }
  }

  async function openAi() {
    const opener = focusedButton();
    // Pulsar IA es un intento explícito: reintenta aunque la última descarga fallara. Si falla, la pestaña lo dice.
    await loadAiPanel();
    showConversation('ai');
    conversationOpener = opener;
  }

  // Si el botón que la abrió ya no está (panel plegado, interfaz minimizada), el foco va al botón de su pestaña.
  function conversationReturn(): HTMLElement | null {
    if (conversationOpener?.isConnected && conversationOpener.checkVisibility()) return conversationOpener;
    const testid = conversationTab === 'ai' ? 'ai-toggle' : 'chat-toggle';
    return root?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? container;
  }

  function toggleGallery() {
    if (layout.gallery.open) {
      layout.gallery.open = false;
      return;
    }
    galleryOpener = focusedButton();
    layout.gallery.open = true;
    void tick().then(() => galleryWindow?.focus());
  }

  function galleryReturn(): HTMLElement | null {
    return galleryOpener?.isConnected && galleryOpener.checkVisibility() ? galleryOpener : container;
  }

  // Posiciones por defecto de las ventanas: el chat abajo a la derecha, a 16 px del panel derecho (o del borde) y a
  // 72 px del borde inferior para no tapar la barra de herramientas; la galería arriba, a la izquierda del panel.
  const WINDOW_GAP = 16;
  const CONVERSATION_SIZE = { w: 380, h: 560 };
  const GALLERY_SIZE = { w: 360, h: 520 };

  function conversationDefault(): WindowRect {
    const { w, h } = CONVERSATION_SIZE;
    return { x: viewport.width - rightEdge - WINDOW_GAP - w, y: viewport.height - 72 - h, w, h };
  }

  function galleryDefault(): WindowRect {
    const { w, h } = GALLERY_SIZE;
    return { x: viewport.width - rightEdge - WINDOW_GAP - w, y: rightOpen ? 8 : 56, w, h };
  }

  // focus: «Animar…» lleva el foco a la fila de lo seleccionado. record: los accesos de «animar esto» encienden Grabar.
  async function openTimeline(focus: boolean, record = false) {
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
    layout.openTimeline({ record: record && !engineReadOnly });
    if (focus) timelineFocus += 1;
  }

  function toggleTimeline() {
    if (timelineOpen) layout.closeTimeline();
    else void openTimeline(false);
  }

  // En el móvil solo hay una superficie no modal abierta a la vez: abrir una cierra las demás.
  function closeMobileSurfaces() {
    mobileMenuOpen = false;
    renaming = null;
    mobileSheet = null;
    layout.conversation.open = false;
    layout.gallery.open = false;
    if (layout.timeline.open) layout.closeTimeline();
  }

  function openMobileSheet(sheet: ContentSheet) {
    closeMobileSurfaces();
    mobileSheet = sheet;
  }

  // Solo la persona cierra una hoja (× o deslizar); esconderla mientras está suspendida no la cierra.
  function closeContentSheet(sheet: ContentSheet, open: boolean) {
    if (!open && mobileSheet === sheet) mobileSheet = null;
  }

  function toggleMobileMenu() {
    if (mobileMenuOpen) {
      mobileMenuOpen = false;
      return;
    }
    renaming = null;
    mobileMenuOpen = true;
  }

  function onMobileMenu(entry: MobileMenuEntry) {
    mobileMenuOpen = false;
    switch (entry) {
      case 'layers':
      case 'animations':
      case 'versions':
        openMobileSheet(entry);
        return;
      case 'timeline':
        closeMobileSurfaces();
        void openTimeline(false);
        return;
      case 'chat':
        closeMobileSurfaces();
        showConversation('team');
        return;
      case 'gallery':
        closeMobileSurfaces();
        layout.gallery.open = true;
        return;
      case 'export':
        exportOpen = true;
        return;
      case 'share':
        openShare();
        return;
      case 'present':
        startPresenting();
        return;
      case 'publish':
        publishOpen = true;
        return;
      case 'download':
        void downloadLocal();
    }
  }

  // «Propiedades» de la barra inferior: abre la hoja de propiedades o la cierra si ya se ve. Con la línea de tiempo
  // abierta no la cierra: la hoja la tapa y, con lo que se cambie en ella, se graba en el cabezal.
  const propertiesOpen = $derived(mobileSheet === 'properties');

  function toggleProperties() {
    if (propertiesOpen) {
      mobileSheet = null;
      return;
    }
    mobileMenuOpen = false;
    renaming = null;
    layout.conversation.open = false;
    layout.gallery.open = false;
    mobileSheet = 'properties';
  }

  // Muestra del botón «Propiedades»: el relleno del primer elemento (el color en un texto).
  const selectionFill = $derived.by((): string | null => {
    const first = selection[0];
    if (!first) return null;
    if ('fill' in first && typeof first.fill === 'string') return first.fill;
    if (first.type === 'text') return first.color;
    return null;
  });

  function renameProject() {
    mobileMenuOpen = false;
    renaming = { kind: 'project' };
  }

  // «Renombrar» del menú contextual: en el móvil, hoja con el nombre; si no, edición en la fila de capas.
  function renameNode(id: string) {
    const record = engine?.core.store.get(id);
    if (!mobile || !engine || !record) {
      void leftPanel?.rename(id);
      return;
    }
    const text = record.type === 'text' ? engine.core.store.text(id) : '';
    mobileMenuOpen = false;
    renaming = { kind: 'node', id, name: record.name ?? displayName(record, kindLabel(kindOf(record)), text) };
  }

  function saveRename(name: string): Promise<boolean> | boolean {
    const target = renaming;
    if (target?.kind === 'project') return rename(name);
    if (target?.kind === 'node') engine?.commands.renameNode(target.id, name);
    return true;
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
  <!-- Presentando a pantalla completa solo se ve la raíz del editor: lo que vaya en portal tiene que ir dentro. -->
  <BitsConfig defaultPortalTo={presenting && root ? root : 'body'}>
    <!-- Orden del DOM = orden de tabulación: panel izquierdo, lienzo, barra contextual, barras, línea de tiempo, panel
         derecho y ventanas.
         La posición de cada pieza la da el CSS: el lienzo ocupa toda la ventana y lo demás flota encima. -->
    <!-- Un toque en los paneles también cuenta como último puntero: en un portátil táctil, los controles sin hover se
         ven aunque el dedo aún no haya tocado el lienzo. -->
    <div
      bind:this={root}
      onpointerdowncapture={onUiPointerDown}
      class={['relative h-dvh overflow-hidden', inputKind === 'touch' ? 'touch-ui' : '']}
      data-ui={layout.ui}
    >
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
            {engine}
            records={selection}
            readOnly={engineReadOnly}
            {tool}
            preset={framePreset}
            pageName={pages.find((item) => item.id === activePage)?.name ?? ''}
            onpreset={(next) => engine?.core.framePreset.set(next)}
            onexport={() => (exportOpen = true)}
            onkeyframes={() => void openTimeline(true, true)}
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
            {activePage}
            onclose={() => (layout.rightView = 'design')}
          />
        {/if}
      {/snippet}

      <!-- Mientras se presenta solo quedan el lienzo, su HUD y la presentación: nada más puede tapar la diapositiva.
           La maqueta (anchos, plegado, línea de tiempo) no cambia y todo vuelve igual al salir. -->
      {#if mobile && !hideUi && collabState}
        <MobileTopBar
          bind:height={topBarHeight}
          name={projectName}
          {canRename}
          collab={collabState}
          {people}
          {following}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          readOnly={engineReadOnly}
          menuOpen={mobileMenuOpen}
          onleave={publishBeforeLeaving}
          onrename={renameProject}
          onundo={() => engine?.commands.undo()}
          onredo={() => engine?.commands.redo()}
          onfollow={(clientId) => engine?.follow(clientId)}
          onmenu={toggleMobileMenu}
        />
      {/if}
      {#if !presenting && !mobile}
        <LeftPanel
          bind:this={leftPanel}
          bind:width={leftWidth}
          bind:pillWidth={leftPillWidth}
          bind:pillHeight={leftPillHeight}
          {engine}
          readOnly={engineReadOnly}
          open={leftOpen}
          touch={inputKind === 'touch'}
          hidden={hideUi}
          clearance={panelClearance}
          header={fileHeader}
          raised={overlayDocked}
        />
      {/if}

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
      <CanvasHud
        restoring={contextState === 'lost'}
        hud={presenting ? null : hud}
        touch={inputKind === 'touch'}
        pointLimit={pointLimit && !presenting && !hideUi}
        recording={recordingAt !== null && recordMode === 'all' ? recordingAt : null}
        area={{ left: barsLeft, right: barsRight, bottom: bottomEdge }}
      />
      <div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      <div class="sr-only" aria-live="polite" aria-atomic="true" data-testid="record-announcer">{recordAnnouncement}</div>
      <input
        bind:this={replaceInput}
        type="file"
        accept={CANVAS_IMAGE_ACCEPT}
        class="hidden"
        tabindex="-1"
        aria-hidden="true"
        onchange={onReplacementPicked}
        data-testid="replace-image-input"
      />
      {#if engine && container && contextShown}
        <ContextBar
          {engine}
          records={selection}
          rect={selectionRect}
          {container}
          locked={selectionLocked}
          avoid={contextAvoid}
          touch={inputKind === 'touch'}
          vertex={activeVertex}
          pen={tool === 'pen' ? penPoints : null}
          editing={editingText}
          {mobile}
          bottom={contextBottom}
          create={createTool}
          onmore={openMoreMenu}
          onreplaceimage={pickReplacement}
          onescape={() => container?.focus({ preventScroll: true })}
        />
      {/if}

      {#if followed}
        <div aria-hidden="true" class="pointer-events-none absolute inset-0 border-2" style:border-color={followed.color}></div>
      {/if}
      <!-- Avisos arriba, centrados en el hueco que dejan los paneles. -->
      {#if !presenting}
        <div
          class="pointer-events-none absolute top-3 z-(--z-hud) flex touch-pan-x touch-pan-y flex-col items-center gap-2"
          style:left="{leftEdge + 12}px"
          style:right="{rightEdge + 12}px"
          hidden={!(followed || collabState.notice)}
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

        {#if mobile}
          <!-- Móvil: la barra de herramientas ocupa todo el ancho abajo. Deshacer y rehacer están en la barra superior y
               el zoom se hace con dos dedos. -->
          <div
            bind:offsetHeight={dockHeight}
            hidden={hideUi || keyboardUp}
            class="pointer-events-none absolute inset-x-0 bottom-0 z-(--z-toolbar) flex"
            data-testid="canvas-bars"
          >
            <FloatingToolbar
              dock
              touch={inputKind === 'touch'}
              {tool}
              {toolLocked}
              readOnly={engineReadOnly}
              gallery={layout.gallery.open}
              {timelineOpen}
              {timelineLoading}
              recording={recordingAt !== null && recordMode === 'all'}
              {aiAvailable}
              {aiOpen}
              properties={selection.length && !engineReadOnly ? { fill: selectionFill, open: propertiesOpen } : null}
              onselect={(next, locked) => engine?.commands.setTool(next, { locked: locked === true })}
              onimage={pickImages}
              ongallery={() => {
                if (layout.gallery.open) layout.gallery.open = false;
                else onMobileMenu('gallery');
              }}
              onanimate={() => {
                if (timelineOpen) layout.closeTimeline();
                else onMobileMenu('timeline');
              }}
              onai={() => {
                if (aiOpen) layout.conversation.open = false;
                else {
                  closeMobileSurfaces();
                  void openAi();
                }
              }}
              onproperties={toggleProperties}
            />
          </div>
        {:else}
          <!-- La barra de herramientas va antes que la de zoom en el DOM: es el orden de tabulación. La rejilla la centra en
               el hueco entre los paneles mientras cabe y, si no, sube el zoom y el minimapa a la fila de encima. -->
          <div
            bind:clientWidth={barsWidth}
            bind:offsetHeight={barsHeight}
            hidden={hideUi}
            class={['pointer-events-none absolute z-(--z-toolbar) grid items-end gap-2', barsStacked ? 'grid-cols-1' : 'grid-cols-[1fr_auto_1fr]']}
            style:left="{barsLeft + 12}px"
            style:right="{barsRight + 12}px"
            style:bottom="{barsBottom}px"
            data-testid="canvas-bars"
          >
            <div bind:offsetWidth={toolbarWidth} class={['flex', barsStacked ? 'col-start-1 row-start-2 justify-self-center' : 'col-start-2 row-start-1']}>
              <FloatingToolbar
                touch={inputKind === 'touch'}
                {tool}
                {toolLocked}
                readOnly={engineReadOnly}
                gallery={layout.gallery.open}
                {timelineOpen}
                {timelineLoading}
                recording={recordingAt !== null && recordMode === 'all'}
                {aiAvailable}
                {aiOpen}
                onselect={(next, locked) => engine?.commands.setTool(next, { locked: locked === true })}
                onimage={pickImages}
                ongallery={toggleGallery}
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
        {/if}

        {#if timelineLoading}
          <p role="status" class="sr-only">{m.timeline_loading()}</p>
        {/if}
        {#if Timeline && engine && !mobile}
          <!-- Flota abajo entre los paneles; su alto lo decide el asa del propio panel. En el móvil va en su hoja. -->
          <div
            bind:offsetHeight={timelineHeight}
            hidden={hideUi || !timelineOpen}
            class="absolute bottom-2 z-(--z-panel) touch-pan-x touch-pan-y"
            style:left="{leftEdge + 8}px"
            style:right="{rightEdge + 8}px"
          >
            <Timeline
              {engine}
              {projectId}
              readOnly={engineReadOnly}
              aiAnimation={!!aiFeatures?.animation && !engineReadOnly}
              open={timelineOpen}
              touch={inputKind === 'touch'}
              focusRequest={timelineFocus}
              onclose={() => layout.closeTimeline()}
            />
          </div>
        {/if}

        {#if !mobile}
          <RightPanel
            bind:width={rightWidth}
            bind:pillWidth={rightPillWidth}
            bind:pillHeight={rightPillHeight}
            open={rightOpen}
            hidden={hideUi}
            clearance={panelClearance}
            header={sessionBar}
            {design}
            versions={versionsView}
            raised={overlayDocked}
          />
        {/if}
      {/if}

      <!-- Ventanas flotantes. Al presentar, la conversación solo se oculta (sigue contando y recibiendo, sin marcar
           nada como leído); la galería no se monta. -->
      {#if chatSession}
        <ConversationWindow
          bind:this={conversationWindow}
          {projectId}
          session={chatSession}
          me={{ id: chatSession.user.id, name: chatSession.user.name, avatarAssetId: session.me?.user.avatarAssetId ?? null }}
          role={collabState.role ?? 'viewer'}
          status={collabState.status}
          {typingNames}
          unread={chatUnread}
          hidden={hideUi || (mobile && sheetsSuspended)}
          {mobile}
          bind:height={conversationSheetHeight}
          defaultRect={conversationDefault}
          pillAt={mobile ? { right: 12, bottom: mobileBarsHeight + 8 } : { right: barsRight + 12, bottom: barsBottom + barsHeight + 8 }}
          returnFocus={conversationReturn}
          {aiAvailable}
          {AiPanel}
          {aiFeatures}
          {engine}
          readOnly={engineReadOnly}
          {aiAttachment}
          aiFailed={aiLoadFailed}
          onretryai={() => void loadAiPanel()}
          ontyping={(value) => engine?.core.presence.update({ chatTyping: value })}
          onunread={(count) => (chatUnread = count)}
        />
      {/if}
      {#if layout.gallery.open && engine && !presenting && !mobile}
        <GalleryWindow
          bind:this={galleryWindow}
          {engine}
          {projectId}
          readOnly={engineReadOnly}
          {assetEvent}
          jobEvent={aiJobEvent}
          canGenerate={!!aiFeatures?.image && !engineReadOnly}
          onsendtochat={aiFeatures?.chat && !engineReadOnly ? (asset) => void sendToAiChat(asset) : null}
          hidden={hideUi}
          defaultRect={galleryDefault}
          returnFocus={galleryReturn}
        />
      {/if}

      {#if viewer.viewing && !presenting}
        <!-- Tapa el hueco del lienzo y sus barras sin dejar franjas del lienzo vivo; las pastillas de los paneles plegados
             quedan encima, dentro de su barra. -->
        <VersionOverlay
          canEdit={!engineReadOnly}
          left={leftEdge + 8}
          right={rightEdge + 8}
          top={8}
          pills={overlayPills}
          fullscreen={viewport.mode === 'mobile'}
        />
      {/if}

      {#if presenting && engine && root}
        <Present bind:this={presenter} {engine} host={root} mode={presentMode} onclose={stopPresenting} />
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
              class={[
                'absolute top-2 right-2 inline-flex size-8 cursor-pointer touch-pan-x touch-pan-y items-center justify-center rounded-panel border border-edge/40 bg-surface-2 text-ink-muted shadow-float transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink',
                overlayDocked ? 'z-(--z-stage-pill)' : 'z-(--z-toolbar)',
              ]}
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
          onanimate={() => void openTimeline(true, true)}
          oncopypng={copyAsPng}
          onexport={() => (exportOpen = true)}
          onrename={renameNode}
          {mobile}
        />
      {/key}
    {/if}
    {#if mobile && !presenting && collabState}
      <MobileMenuSheet
        bind:open={mobileMenuOpen}
        bind:height={menuSheetHeight}
        {canShare}
        {canPublish}
        {chatUnread}
        downloading={downloadingLocal}
        onselect={onMobileMenu}
      />
      {#if renaming}
        {@const target = renaming}
        <RenameSheet
          bind:open={() => renaming !== null, (value) => {
            if (!value) renaming = null;
          }}
          bind:height={renameSheetHeight}
          label={target.kind === 'project' ? m.editor_name_label() : m.editor_mobile_rename_layer()}
          value={target.kind === 'project' ? projectName : target.name}
          onsave={saveRename}
        />
      {/if}
      {#if engine}
        {@const current = engine}
        <!-- Hojas de contenido: una a la vez. Cerrar una (× o deslizar) la quita; esconderla (menú, «Renombrar», vista
             previa de una versión) la conserva con su altura. -->
        <PropertiesSheet
          bind:open={() => sheetsShown && mobileSheet === 'properties', (value) => closeContentSheet('properties', value)}
          bind:height={contentSheetHeight}
          engine={current}
          records={selection}
          readOnly={engineReadOnly}
          {tool}
          preset={framePreset}
          pageName={pages.find((item) => item.id === activePage)?.name ?? ''}
          onpreset={(next) => current.core.framePreset.set(next)}
          onexport={() => (exportOpen = true)}
          onkeyframes={() => {
            mobileSheet = null;
            void openTimeline(true, true);
          }}
        />
        <LayersSheet
          bind:open={() => sheetsShown && mobileSheet === 'layers', (value) => closeContentSheet('layers', value)}
          bind:height={contentSheetHeight}
          engine={current}
          readOnly={engineReadOnly}
          onrename={renameNode}
        />
        <AnimationsSheet
          bind:open={() => sheetsShown && mobileSheet === 'animations', (value) => closeContentSheet('animations', value)}
          bind:height={contentSheetHeight}
          engine={current}
        />
        <VersionsSheet
          bind:open={() => sheetsShown && mobileSheet === 'versions', (value) => closeContentSheet('versions', value)}
          bind:height={contentSheetHeight}
          {projectId}
          canEdit={!engineReadOnly}
          {activePage}
        />
        {#if Timeline}
          <TimelineSheet
            bind:open={() => timelineSheetShown, (value) => {
              if (!value) layout.closeTimeline();
            }}
            bind:height={timelineSheetHeight}
            {Timeline}
            engine={current}
            {projectId}
            readOnly={engineReadOnly}
            aiAnimation={!!aiFeatures?.animation && !engineReadOnly}
            focusRequest={timelineFocus}
            onproperties={selection.length && !engineReadOnly ? toggleProperties : null}
          />
        {/if}
        <GallerySheet
          bind:open={() => gallerySheetShown, (value) => {
            if (!value) layout.gallery.open = false;
          }}
          bind:height={gallerySheetHeight}
          engine={current}
          {projectId}
          readOnly={engineReadOnly}
          {assetEvent}
          jobEvent={aiJobEvent}
          canGenerate={!!aiFeatures?.image && !engineReadOnly}
          onsendtochat={aiFeatures?.chat && !engineReadOnly ? (asset) => void sendToAiChat(asset) : null}
        />
      {/if}
    {/if}
    {#if engine}
      <ExportDialog bind:open={exportOpen} {engine} {projectId} {projectName} />
    {/if}
    <ConfirmDialog
      bind:open={() => viewer.confirming !== null, (value) => {
        if (!value) viewer.confirming = null;
      }}
      title={m.editor_versions_restore_title()}
      description={m.editor_versions_restore_body()}
      confirmLabel={m.editor_versions_restore()}
      busy={viewer.restoreBusy}
      onconfirm={() => void viewer.restore()}
      onCloseAutoFocus={(event) => viewer.confirmCloseFocus(event)}
    />
    <ConfirmDialog
      bind:open={presentPageAsk}
      title={m.present_page_title()}
      description={m.present_page_body()}
      confirmLabel={m.present_page_confirm()}
      onconfirm={() => void presentWholePage()}
      onCloseAutoFocus={(event) => {
        // El botón que abrió el diálogo no está mientras se presenta: el foco va a la presentación.
        if (!presenting) return;
        event.preventDefault();
        presenter?.focus();
      }}
    />
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
  </BitsConfig>
{/if}
