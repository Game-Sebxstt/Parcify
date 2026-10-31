<script lang="ts">
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import Copy from '@lucide/svelte/icons/copy';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import ListPlus from '@lucide/svelte/icons/list-plus';
  import ListX from '@lucide/svelte/icons/list-x';
  import Minus from '@lucide/svelte/icons/minus';
  import MoveHorizontal from '@lucide/svelte/icons/move-horizontal';
  import Pause from '@lucide/svelte/icons/pause';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Spline from '@lucide/svelte/icons/spline';
  import Trash from '@lucide/svelte/icons/trash';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Repeat from '@lucide/svelte/icons/repeat';
  import SkipBack from '@lucide/svelte/icons/skip-back';
  import UnfoldHorizontal from '@lucide/svelte/icons/unfold-horizontal';
  import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
  import X from '@lucide/svelte/icons/x';
  import { tick, untrack } from 'svelte';
  import { displayName, kindOf } from '../../../engine/a11y/describe.ts';
  import {
    compileAnimation,
    keyframeTime,
    poseAtProgress,
    poseValue,
    type AnimationState,
    type Engine,
    type KeyframePasteResult,
    type KeyRef,
    type Pose,
  } from '../../../engine/index.ts';
  import { getEditorLayout, TIMELINE_HEIGHT, WIDTH_STEP } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import { ANIMATION_LIMITS } from '../../../shared/document/limits.js';
  import { EASINGS, type Animation, type AnimProp, type Keyframe } from '../../../shared/document/schema.js';
  import type { MenuEntry } from '../../../ui/DropdownMenu.svelte';
  import PointMenu from '../../../ui/PointMenu.svelte';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import ActionSheet from '../mobile/ActionSheet.svelte';
  import Select from '../../../ui/Select.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import { kindLabel } from '../kinds.ts';
  import ToolButton from '../ToolButton.svelte';
  import AiAnimate from './AiAnimate.svelte';
  import { onKeyframeClip, keyframeClip, setKeyframeClip } from './clipboard.ts';
  import EasingPopover, { easingLabel, type EasingPreset } from './EasingPopover.svelte';
  import KeyframeEditor from './KeyframeEditor.svelte';
  import { KeyframeSelection, refId } from './keyframe-selection.svelte.ts';
  import StretchPopover from './StretchPopover.svelte';
  import TrackList from './TrackList.svelte';
  import TrackRow, { type CellPosition, type RangeMode, type RowActions } from './TrackRow.svelte';
  import {
    buildRows,
    formatTime,
    formatValue,
    fromDisplay,
    keyframeAt,
    LABEL_WIDTH,
    LABEL_WIDTH_SHEET,
    propLabel,
    rowHeight,
    rowOffsets,
    sliderToZoom,
    spanOf,
    timeX,
    zoomToSlider,
    type NodeRow,
    type Row,
    type TimelineKeyframe,
    type TrackRow as TrackRowModel,
  } from './model.ts';

  type Props = {
    engine: Engine;
    projectId: string;
    readOnly: boolean;
    // Hay modelo de animación y permiso para usarlo: muestra «Animar con IA».
    aiAnimation: boolean;
    open: boolean;
    // El último puntero en el editor fue un dedo: filas y zonas de toque más grandes.
    touch: boolean;
    // Sube cada vez que «Animar…» pide llevar el foco a la selección.
    focusRequest: number;
    onclose: () => void;
    // Dentro de la hoja del móvil: ocupa la hoja (sin borde, sin asa ni ×), cabecera de 52 px con botones de 44 px,
    // filas de nodo de 44 px y el menú de los keyframes como hoja de acciones.
    sheet?: boolean;
  };

  let { engine, projectId, readOnly: canNotEdit, aiAnimation, open, touch, focusRequest, onclose, sheet = false }: Props = $props();

  const labelWidth = $derived(sheet ? LABEL_WIDTH_SHEET : LABEL_WIDTH);
  const toolSize = $derived(sheet ? 'lg' : 'sm');
  const smallToolSize = $derived(sheet ? 'lg' : 'xs');
  const smallIcon = $derived(sheet ? 20 : 14);

  // Animaciones propuestas por la IA en vista previa: sus pistas se pintan en violeta y, mientras están, el
  // timeline no edita (lo que se ve no es el documento).
  let proposed = $state.raw<ReadonlyMap<string, Animation> | null>(null);
  let aiOpen = $state(false);
  const readOnly = $derived(canNotEdit || proposed !== null);
  const animationOf = (id: string) => proposed?.get(id) ?? engine.core.store.animation(id);

  const uid = $props.id();
  const SPEEDS = [
    { value: '0.5', label: '0,5×' },
    { value: '1', label: '1×' },
    { value: '2', label: '2×' },
  ];
  const DRAG_THRESHOLD = 3;
  // Con el dedo, un arrastre empieza a los 8 px y la pulsación larga dura 500 ms.
  const TOUCH_SLOP = 8;
  const LONG_PRESS_MS = 500;
  const NUDGE = 0.01;
  // Las flechas mueven la selección un fotograma (1/60 s); con Mayús, diez.
  const FRAME_MS = 1000 / 60;
  // Imán de los arrastres de keyframes y del estirado.
  const SNAP_PX = 6;
  // Los arrastres de la barra de rango van de 10 en 10 ms.
  const RANGE_STEP = 10;

  type Range = { min: number; max: number };
  // Arrastre de keyframes: la vista previa suma `delta` a todos los de `ids` y se escribe una vez, al soltar.
  type KeyDrag = {
    pointerId: number;
    ids: ReadonlySet<string>;
    refs: KeyRef[];
    grabbedMs: number;
    startX: number;
    startY: number;
    threshold: number;
    limits: Range;
    targets: number[];
    // Clic sin mover sobre un keyframe que ya estaba en una selección mayor: la selección pasa a ser solo ese.
    collapseTo: KeyRef[] | null;
    // Toque sin mover con «Añadir a la selección» sobre un keyframe ya seleccionado: al soltar, sale de la selección.
    toggleOff: KeyRef[] | null;
    canMove: boolean;
    moved: boolean;
    delta: number;
    snap: number | null;
  };
  // Estirado desde un asa de la caja: el pivote es el asa contraria (con Alt, el centro).
  type Stretch = {
    pointerId: number;
    side: 'start' | 'end';
    startX: number;
    ids: ReadonlySet<string>;
    refs: KeyRef[];
    minMs: number;
    maxMs: number;
    limits: Range;
    centerLimits: Range;
    targets: number[];
    moved: boolean;
    pivot: number;
    factor: number;
    snap: number | null;
  };
  // Pulsación en el vacío de las pistas: clic (cabezal), arrastre (marquesina) o, con el dedo, scroll o pulsación larga.
  type LaneGesture = { pointerId: number; target: HTMLElement; startX: number; startY: number; origin: { x: number; y: number }; touch: boolean; additive: boolean; base: KeyRef[]; marquee: boolean };
  type RangeDrag = { pointerId: number; id: string; mode: RangeMode; startX: number; delay0: number; duration0: number; delay: number; duration: number; moved: boolean };

  let version = $state(0);
  let layers = $state(0);
  let pageId = $state<string | null>(null);
  let selection = $state.raw<readonly string[]>([]);
  let player = $state.raw<AnimationState>({ status: 'stopped', time: 0, duration: 0, preview: false, previewIds: null });
  // El cabezal y Grabar viven en la maqueta del editor, que los lleva al motor: desmontar el panel no los pierde.
  const layout = getEditorLayout();
  const head = $derived(layout.timeline.head);
  const recording = $derived(layout.timeline.recording);
  let speed = $state('1');
  let repeat = $state(false);
  let zoom = $state(0.25);
  let collapsed = $state.raw<ReadonlySet<string>>(new Set());
  let focus = $state<CellPosition | null>(null);
  let pendingFocus = $state<CellPosition | null>(null);
  let editing = $state<{ id: string; prop: AnimProp; key: string; left: number; bottom: number } | null>(null);
  const picked = new KeyframeSelection();
  let keyDrag = $state.raw<KeyDrag | null>(null);
  let stretch = $state.raw<Stretch | null>(null);
  let lane: LaneGesture | null = null;
  let lockTouch = $state(false);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPointer = 'mouse';
  // «Añadir a la selección» con el dedo (el mismo conmutador que la barra contextual del lienzo).
  let additive = $state(false);
  let hasClip = $state(false);
  let announcement = $state('');
  let menu = $state.raw<{ at: { x: number; y: number }; refs: KeyRef[] } | null>(null);
  // La acción del menú ya lleva el foco a otro sitio (editor, estirar): al cerrarse no vuelve a la celda.
  let menuKeepFocus = false;
  let easingTarget = $state.raw<{ ref: KeyRef; rect: DOMRect } | null>(null);
  let stretchAt = $state.raw<{ at: { x: number; y: number }; refs: KeyRef[]; pivot: number; limits: Range } | null>(null);
  let rangeDrag = $state<RangeDrag | null>(null);
  // La acción del menú de una fila ya lleva el foco a otro sitio: el menú no lo devuelve a su botón.
  let keepMenuFocus = false;
  let wasPlaying = false;
  let wasPreview = false;
  let list = $state<ReturnType<typeof TrackList<Row>> | null>(null);
  let section = $state<HTMLElement | null>(null);
  let innerHeight = $state(900);
  let resizing: { pointerId: number; y: number; height: number } | null = null;
  let resizeActive = $state(false);

  // Alto entre 160 px y el 60 % de la ventana.
  const maxHeight = $derived(Math.max(TIMELINE_HEIGHT.min, Math.min(TIMELINE_HEIGHT.max, Math.round(innerHeight * 0.6))));
  const height = $derived(Math.min(maxHeight, Math.max(TIMELINE_HEIGHT.min, layout.timeline.height)));

  $effect(() => {
    const source = engine;
    return untrack(() => {
      const unsubscribe = [
        source.anim.version.subscribe((value) => (version = value)),
        source.state.layersVersion.subscribe((value) => (layers = value)),
        source.state.pageId.subscribe((value) => (pageId = value)),
        source.state.selection.subscribe((value) => (selection = value)),
        source.anim.state.subscribe(onPlayer),
        source.core.aiAnimations.subscribe((value) => (proposed = value)),
        source.core.touchModifiers.subscribe((value) => (additive = value.additive)),
        onKeyframeClip((clip) => (hasClip = clip !== null)),
      ];
      return () => unsubscribe.forEach((run) => run());
    });
  });

  // El cabezal es local; solo sigue al reproductor mientras reproduce y en el frame en que termina. Una vista previa
  // de la biblioteca o de la sección Animación no lo mueve: al terminar, el lienzo vuelve a la pose del cabezal.
  function onPlayer(state: AnimationState) {
    player = state;
    const endedPreview = wasPreview && !state.preview;
    if (!state.preview && (state.status === 'playing' || (wasPlaying && !endedPreview))) layout.timeline.head = state.time;
    // Al parar o pausar, las vistas vuelven al documento: con la línea de tiempo abierta se vuelve a la pose del cabezal.
    if ((wasPlaying || endedPreview) && state.status !== 'playing' && !state.preview) {
      queueMicrotask(() => {
        if (open && player.status !== 'playing') engine.anim.seek(layout.timeline.head);
      });
    }
    wasPlaying = state.status === 'playing' && !state.preview;
    wasPreview = state.preview;
  }

  const playing = $derived(player.status === 'playing' && !player.preview);
  const previewing = $derived(new Set(player.preview ? (player.previewIds ?? []) : []));

  // Nodos animados de la página y los seleccionados, de arriba abajo como en el panel de capas.
  const ids = $derived.by(() => {
    void version;
    void layers;
    if (!pageId) return [];
    const wanted = new Set([...selection, ...[...engine.core.store.animations()].map(([id]) => id), ...(proposed?.keys() ?? [])]);
    return [...engine.core.tree.paintOrder(pageId)].filter((id) => wanted.has(id)).reverse();
  });

  const rows = $derived.by(() => {
    void version;
    void layers;
    return buildRows(ids, (id) => engine.core.store.get(id), animationOf, collapsed);
  });
  const heights = $derived(rows.map((row) => rowHeight(row, sheet ? 'sheet' : touch)));

  const span = $derived.by(() => {
    void version;
    const animations = ids.map(animationOf).filter((item): item is Animation => !!item);
    const preview = rangeDrag ? [{ delay: rangeDrag.delay, duration: rangeDrag.duration, loop: 1 }] : [];
    return spanOf([...animations, ...preview], head);
  });

  // Pose de cada nodo animado en el cabezal: el valor que muestran las filas de propiedad.
  const poses = $derived.by(() => {
    const entries = rows.flatMap((row): Array<[string, Pose]> =>
      row.kind === 'node' && row.animation ? [[row.id, poseAtProgress(compileAnimation(row.animation), keyframeTime(row.animation, head))]] : [],
    );
    return new Map(entries);
  });

  const current = $derived.by((): CellPosition | null => {
    const row = focus && rows.find((item) => item.rowKey === focus!.row);
    if (row && focus) return { row: row.rowKey, key: row.kind === 'track' && row.keyframes.some((kf) => kf.key === focus!.key) ? focus.key : null };
    return rows[0] ? { row: rows[0].rowKey, key: null } : null;
  });

  const editTarget = $derived.by(() => {
    if (!editing) return null;
    const row = rows.find((item): item is TrackRowModel => item.kind === 'track' && item.id === editing!.id && item.prop === editing!.prop);
    const kf = row?.keyframes.find((item) => item.key === editing!.key);
    return row && kf && row.animation ? { row, kf, animation: row.animation } : null;
  });

  // Si el keyframe que se edita desaparece (borrado, deshacer o cambio remoto), el editor se cierra.
  $effect(() => {
    if (editing && !editTarget) untrack(() => (editing = null));
  });

  // Con la línea de tiempo abierta, el lienzo muestra la pose del cabezal (lo que el panel de propiedades enseña y lo
  // que se graba), también cuando la duración cambia con los keyframes nuevos.
  $effect(() => {
    void version;
    if (!open) return;
    untrack(() => {
      if (player.status !== 'playing' && !player.preview) engine.anim.seek(head);
    });
  });

  // Con una propuesta en vista previa no se graba ni se edita.
  $effect(() => {
    if (!proposed) return;
    untrack(() => {
      layout.timeline.recording = false;
      editing = null;
    });
  });

  $effect(() => {
    if (open) return;
    untrack(() => {
      aiOpen = false;
      editing = null;
      menu = null;
      easingTarget = null;
      stretchAt = null;
      cancelGestures();
      picked.clear();
      engine.anim.stop();
    });
  });

  $effect(() => {
    if (focusRequest <= 0) return;
    untrack(() => void focusSelection());
  });

  // Un keyframe recién creado o movido recibe el foco cuando aparece su celda.
  $effect(() => {
    const wanted = pendingFocus;
    if (!wanted || !rows.length) return;
    const index = rows.findIndex((row) => row.rowKey === wanted.row);
    const row = rows[index];
    if (!row || (wanted.key && (row.kind !== 'track' || !row.keyframes.some((kf) => kf.key === wanted.key)))) return;
    untrack(() => {
      pendingFocus = null;
      focus = wanted;
      void reveal(index, wanted);
    });
  });

  const cellId = (position: CellPosition) => `${uid}-${position.row}-${position.key ?? 'h'}`;

  const keyframeOf = (ref: KeyRef) => animationOf(ref.nodeId)?.tracks[ref.prop]?.[ref.key];

  // Instante (ms) del keyframe en la primera iteración, o null si ya no existe.
  function msOf(ref: KeyRef): number | null {
    const animation = animationOf(ref.nodeId);
    const kf = animation?.tracks[ref.prop]?.[ref.key];
    return animation && kf ? keyframeAt(animation, kf.t) : null;
  }

  // La selección sin lo que ya no existe (borrado, deshacer o un cambio de otra persona) ni lo que no está en la página.
  const visibleIds = $derived(new Set(ids));
  const shownRef = (ref: KeyRef) => visibleIds.has(ref.nodeId) && keyframeOf(ref) !== undefined;
  const selectedRefs = $derived.by(() => {
    void version;
    void proposed;
    return picked.refs().filter(shownRef);
  });

  // Al cambiar de página, la selección y los gestos de la anterior se descartan.
  $effect(() => {
    void pageId;
    untrack(() => {
      cancelGestures();
      picked.clear();
      menu = null;
      easingTarget = null;
      stretchAt = null;
    });
  });
  const selectedIds = $derived(new Set(selectedRefs.map(refId)));
  const isSelected = (refs: readonly KeyRef[]) => refs.length > 0 && refs.every((ref) => selectedIds.has(refId(ref)));
  const rowIndex = $derived(new Map(rows.map((row, index) => [row.rowKey, index])));

  // Con la vista previa de un arrastre o de un estirado.
  function previewMs(ref: KeyRef, ms: number): number {
    const id = refId(ref);
    if (keyDrag?.moved && keyDrag.ids.has(id)) return ms + keyDrag.delta;
    if (stretch?.moved && stretch.ids.has(id)) return Math.max(0, stretch.pivot + (ms - stretch.pivot) * stretch.factor);
    return ms;
  }

  // Caja de estirado: con 2 o más keyframes seleccionados en al menos dos instantes distintos, de minMs a maxMs y 6 px
  // por debajo del rombo más bajo.
  const stretchBox = $derived.by(() => {
    if (selectedRefs.length < 2) return null;
    const offsets = rowOffsets(heights);
    let min = Infinity;
    let max = -Infinity;
    let bottom = -Infinity;
    for (const ref of selectedRefs) {
      const ms = msOf(ref);
      if (ms === null) continue;
      const shown = previewMs(ref, ms);
      min = Math.min(min, shown);
      max = Math.max(max, shown);
      const index = rowIndex.get(`${ref.nodeId}:${ref.prop}`) ?? rowIndex.get(ref.nodeId);
      if (index !== undefined) bottom = Math.max(bottom, (offsets[index] ?? 0) + (heights[index] ?? 0) / 2);
    }
    if (!Number.isFinite(bottom) || max - min < 0.5) return null;
    return { min, max, top: bottom + 4.5 + 6 };
  });
  const snapGuide = $derived(keyDrag?.snap ?? stretch?.snap ?? null);

  // Imán: el cabezal, 0, el final de cada iteración y los keyframes que no se mueven.
  function snapTargets(exclude: ReadonlySet<string>): number[] {
    const targets = [0, head];
    for (const id of ids) {
      const animation = animationOf(id);
      if (!animation) continue;
      targets.push(animation.delay + animation.duration);
      for (const [prop, track] of Object.entries(animation.tracks)) {
        for (const [key, kf] of Object.entries(track ?? {})) if (!exclude.has(`${id}:${prop}:${key}`)) targets.push(keyframeAt(animation, kf.t));
      }
    }
    return targets;
  }

  function snapTo(ms: number, targets: readonly number[]): number | null {
    let best: number | null = null;
    let distance = SNAP_PX / zoom;
    for (const target of targets) {
      const d = Math.abs(target - ms);
      if (d <= distance) {
        best = target;
        distance = d;
      }
    }
    return best;
  }

  const clamp = (value: number, range: Range) => Math.min(range.max, Math.max(range.min, value));

  // Lo que reciben copiar, duplicar, borrar y mover: la selección o, sin ella, el keyframe con el foco.
  function targets(): KeyRef[] {
    if (selectedRefs.length) return selectedRefs;
    const position = current;
    const row = position?.key ? rows[rowIndex.get(position.row) ?? -1] : undefined;
    return row?.kind === 'track' && position?.key ? [{ nodeId: row.id, prop: row.prop, key: position.key }] : [];
  }

  function announce(text: string) {
    // Vaciar y volver a escribir: así se anuncia también el mismo texto dos veces seguidas.
    announcement = '';
    queueMicrotask(() => (announcement = text));
  }

  const PASTE_ERRORS: Record<Exclude<KeyframePasteResult, { ok: true }>['reason'], () => string> = {
    track_full: m.timeline_paste_track_full,
    animation_limit: m.timeline_paste_animation_limit,
    too_long: m.timeline_paste_too_long,
    nothing: m.timeline_paste_nothing,
  };

  // Pegar y duplicar: la selección pasa a las copias.
  function pasted(result: KeyframePasteResult, done: (count: number) => string) {
    if (!result.ok) {
      showToast({ message: PASTE_ERRORS[result.reason](), tone: 'error' });
      return;
    }
    picked.set(result.refs);
    announce(done(result.refs.length));
  }

  function copySelection(): boolean {
    const refs = targets();
    const clip = refs.length ? engine.anim.keyframes.copyKeyframes(refs) : null;
    if (!clip) return false;
    setKeyframeClip(clip);
    announce(m.timeline_copied({ count: clip.items.length }));
    return true;
  }

  function pasteAtHead(): boolean {
    const clip = keyframeClip();
    if (!clip || readOnly) return false;
    pasted(engine.anim.keyframes.pasteKeyframes(clip, head, selection), (count) => m.timeline_pasted({ count, time: formatTime(head) }));
    return true;
  }

  function duplicateSelection(): boolean {
    const refs = targets();
    if (!refs.length || readOnly) return false;
    pasted(engine.anim.keyframes.duplicateKeyframes(refs), (count) => m.timeline_duplicated({ count }));
    return true;
  }

  function deleteSelection(): boolean {
    const refs = targets();
    if (!refs.length || readOnly) return false;
    const position = current;
    const row = position ? rows[rowIndex.get(position.row) ?? -1] : undefined;
    if (!engine.anim.keyframes.deleteKeyframes(refs)) return false;
    picked.clear();
    announce(m.timeline_deleted({ count: refs.length }));
    // Si el keyframe con el foco se ha ido, el foco pasa a la fila de su nodo.
    if (row && position?.key && refs.some((ref) => ref.nodeId === row.id && ref.key === position.key)) pendingFocus = { row: row.id, key: null };
    return true;
  }

  function moveSelection(direction: 1 | -1, big: boolean) {
    if (readOnly || !selectedRefs.length) return;
    engine.anim.keyframes.moveKeyframes(selectedRefs, direction * FRAME_MS * (big ? 10 : 1));
  }

  function clearSelection() {
    picked.clear();
  }

  function nameOf(row: Row): string {
    const text = row.record.type === 'text' ? engine.core.store.text(row.id) : '';
    return displayName(row.record, kindLabel(kindOf(row.record)), text);
  }

  async function focusSelection() {
    const id = selection.find((item) => rows.some((row) => row.id === item)) ?? selection[0];
    if (!id) {
      await tick();
      document.querySelector<HTMLElement>(`[data-testid="timeline"] [role="grid"] [tabindex="0"]`)?.focus();
      return;
    }
    if (collapsed.has(id)) collapsed = new Set([...collapsed].filter((other) => other !== id));
    pendingFocus = { row: id, key: null };
  }

  async function reveal(index: number, position: CellPosition) {
    const row = rows[index];
    const kf = row?.kind === 'track' && position.key ? row.keyframes.find((item) => item.key === position.key) : undefined;
    list?.reveal(index, kf?.time);
    await tick();
    document.getElementById(cellId(position))?.focus({ preventScroll: true });
  }

  function go(index: number, key: string | null) {
    const target = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[target];
    if (!row) return;
    const position = { row: row.rowKey, key };
    focus = position;
    void reveal(target, position);
  }

  // Al cambiar de fila se va al keyframe más cercano en el tiempo, o a la cabecera.
  function nearest(row: Row | undefined, time: number | undefined): string | null {
    if (!row || row.kind !== 'track' || time === undefined || !row.keyframes.length) return null;
    let best = row.keyframes[0]!;
    for (const kf of row.keyframes) if (Math.abs(kf.time - time) < Math.abs(best.time - time)) best = kf;
    return best.key;
  }

  function toggle(id: string, expand: boolean) {
    collapsed = expand ? new Set([...collapsed].filter((other) => other !== id)) : new Set([...collapsed, id]);
  }

  function setHead(ms: number) {
    layout.timeline.head = Math.max(0, Math.min(span, Math.round(ms)));
    engine.anim.seek(layout.timeline.head);
  }

  function togglePlay() {
    if (playing) {
      engine.anim.pause();
      return;
    }
    engine.anim.seek(head);
    engine.anim.play();
  }

  function rewind() {
    layout.timeline.head = 0;
    engine.anim.stop();
    engine.anim.seek(0);
  }

  function toggleRecord() {
    if (readOnly) return;
    layout.timeline.recording = !recording;
    if (layout.timeline.recording && playing) {
      engine.anim.pause();
      engine.anim.seek(head);
    }
  }

  function pickSpeed(value: string) {
    speed = value;
    engine.anim.setSpeed(Number(value));
  }

  function toggleRepeat() {
    repeat = !repeat;
    engine.anim.setRepeat(repeat);
  }

  function onHeadKey(event: KeyboardEvent) {
    const step = event.shiftKey ? span / 10 : span / 100;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') setHead(head + step);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') setHead(head - step);
    else if (event.key === 'Home') setHead(0);
    else if (event.key === 'End') setHead(span);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function addAtHead(row: TrackRowModel) {
    if (readOnly) return;
    const key = engine.anim.keyframes.keyframeAtTime(row.id, row.prop, head);
    if (!key) {
      showToast({ message: m.timeline_add_error(), tone: 'error' });
      return;
    }
    pendingFocus = { row: row.rowKey, key };
  }

  function addTrack(row: NodeRow, prop: AnimProp) {
    if (readOnly) return;
    const key = engine.anim.keyframes.keyframeAtTime(row.id, prop, head);
    if (!key) {
      showToast({ message: m.timeline_add_error(), tone: 'error' });
      return;
    }
    if (!row.expanded) toggle(row.id, true);
    keepMenuFocus = true;
    pendingFocus = { row: `${row.id}:${prop}`, key };
  }

  function removeAnimation(row: NodeRow) {
    if (readOnly || !engine.anim.keyframes.deleteAnimation(row.id)) return;
    keepMenuFocus = true;
    pendingFocus = { row: row.rowKey, key: null };
  }

  function rowMenu(row: NodeRow): MenuEntry[] {
    return [
      {
        kind: 'sub',
        id: 'add',
        label: m.timeline_add_track(),
        disabled: readOnly || row.addable.length === 0,
        items: row.addable.map((prop) => ({ kind: 'item', id: prop, label: propLabel(prop), onSelect: () => addTrack(row, prop) })),
      },
      { kind: 'separator', id: 'sep' },
      { kind: 'item', id: 'remove', label: m.timeline_remove_animation(), danger: true, disabled: readOnly || !row.animation, onSelect: () => removeAnimation(row) },
    ];
  }

  function nudge(row: TrackRowModel, kf: TimelineKeyframe, direction: 1 | -1) {
    if (readOnly) return;
    const t = Math.round(Math.min(1, Math.max(0, kf.keyframe.t + direction * NUDGE)) * 10000) / 10000;
    if (t !== kf.keyframe.t) engine.anim.keyframes.moveKeyframe(row.id, row.prop, kf.key, t);
    pendingFocus = { row: row.rowKey, key: kf.key };
  }

  function remove(row: TrackRowModel, kf: TimelineKeyframe) {
    if (readOnly) return;
    const index = row.keyframes.indexOf(kf);
    const next = row.keyframes[index + 1] ?? row.keyframes[index - 1];
    if (!engine.anim.keyframes.deleteKeyframe(row.id, row.prop, kf.key)) return;
    // La pista desaparece con su último keyframe: el foco pasa a la fila del nodo.
    pendingFocus = next ? { row: row.rowKey, key: next.key } : { row: row.id, key: null };
  }

  function openEditor(row: TrackRowModel, kf: TimelineKeyframe) {
    const cell = document.getElementById(cellId({ row: row.rowKey, key: kf.key }));
    const box = cell?.getBoundingClientRect();
    const left = Math.max(8, Math.min((box?.left ?? 8) - 136, window.innerWidth - 296));
    if (sheet) {
      // En la hoja del móvil, el editor del keyframe va centrado justo encima de ella.
      const top = section?.getBoundingClientRect().top ?? window.innerHeight / 2;
      editing = { id: row.id, prop: row.prop, key: kf.key, left: Math.max(8, (window.innerWidth - 288) / 2), bottom: window.innerHeight - top + 8 };
      return;
    }
    editing = { id: row.id, prop: row.prop, key: kf.key, left, bottom: window.innerHeight - (box?.top ?? window.innerHeight / 2) + 8 };
  }

  function closeEditor() {
    const target = editing;
    editing = null;
    if (target) pendingFocus = { row: `${target.id}:${target.prop}`, key: target.key };
  }

  function saveEditor(next: Keyframe) {
    const target = editing;
    if (target) engine.anim.keyframes.updateKeyframe(target.id, target.prop, target.key, next);
    closeEditor();
  }

  function deleteFromEditor() {
    const target = editTarget;
    editing = null;
    if (target) remove(target.row, target.kf);
  }

  function onGridKey(event: KeyboardEvent) {
    const position = current;
    if (!position || editing || (event.target as HTMLElement).closest('input, button')) return;
    const index = rows.findIndex((row) => row.rowKey === position.row);
    const row = rows[index];
    if (!row) return;
    const kfs = row.kind === 'track' ? row.keyframes : [];
    const at = position.key ? kfs.findIndex((kf) => kf.key === position.key) : -1;
    const kf = at >= 0 ? kfs[at] : undefined;
    lastPointer = 'keyboard';
    // Con el keyframe del foco en la selección, ←/→ mueven toda la selección un fotograma (Mayús: diez).
    const moving = !event.altKey && !event.ctrlKey && !event.metaKey && !!kf && row.kind === 'track' && selectedIds.has(refId({ nodeId: row.id, prop: row.prop, key: kf.key }));
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && kf && row.kind === 'track') {
      const ref = { nodeId: row.id, prop: row.prop, key: kf.key };
      if (!selectedIds.has(refId(ref))) picked.set([ref]);
      const box = document.getElementById(cellId(position))?.getBoundingClientRect();
      openMenu(box ? { x: box.right, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case ' ':
        // Espacio sobre un keyframe lo suma o lo quita de la selección; en el resto del panel, reproduce.
        if (!kf || row.kind !== 'track' || event.ctrlKey || event.metaKey || event.altKey) return;
        picked.toggle({ nodeId: row.id, prop: row.prop, key: kf.key });
        break;
      case 'ArrowRight':
        if (moving) moveSelection(1, event.shiftKey);
        else if (event.altKey) {
          if (kf && row.kind === 'track') nudge(row, kf, 1);
        } else if (row.kind === 'node') {
          if (!row.expanded) toggle(row.id, true);
          else go(index + 1, null);
        } else if (at + 1 < kfs.length) go(index, kfs[at + 1]!.key);
        break;
      case 'ArrowLeft':
        if (moving) moveSelection(-1, event.shiftKey);
        else if (event.altKey) {
          if (kf && row.kind === 'track') nudge(row, kf, -1);
        } else if (row.kind === 'node') {
          if (row.expanded) toggle(row.id, false);
        } else if (at > 0) go(index, kfs[at - 1]!.key);
        else if (at === 0) go(index, null);
        else go(rows.findIndex((item) => item.kind === 'node' && item.id === row.id), null);
        break;
      case 'ArrowDown':
        go(index + 1, nearest(rows[index + 1], kf?.time));
        break;
      case 'ArrowUp':
        go(index - 1, nearest(rows[index - 1], kf?.time));
        break;
      case 'Home':
        if (event.ctrlKey || event.metaKey) go(0, null);
        else go(index, null);
        break;
      case 'End':
        if (event.ctrlKey || event.metaKey) go(rows.length - 1, null);
        else go(index, kfs.at(-1)?.key ?? null);
        break;
      case 'Enter':
      case 'F2':
        if (kf && row.kind === 'track') openEditor(row, kf);
        else if (row.kind === 'track' && event.key === 'Enter') addAtHead(row);
        else if (row.kind === 'node' && event.key === 'Enter') engine.commands.select([row.id]);
        break;
      case 'Delete':
      case 'Backspace':
        if (selectedRefs.length) deleteSelection();
        else if (kf && row.kind === 'track') remove(row, kf);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // Espacio reproduce o pausa y K enciende o apaga Grabar, con el foco en cualquier parte del panel salvo en un
  // control que ya usa la tecla. Esc no cierra la línea de tiempo: solo la cierran × y el botón de la barra.
  function onPanelKey(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const inField = !!target.closest('input, textarea, [role="dialog"]');
    // Ctrl/⌘+C, V y D trabajan con los keyframes; sin keyframes que copiar, duplicar o pegar, el atajo sigue hasta el
    // lienzo (los nodos).
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !inField) {
      const key = event.key.toLowerCase();
      const done = key === 'c' ? copySelection() : key === 'v' ? pasteAtHead() : key === 'd' ? duplicateSelection() : false;
      if (!done) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && !inField && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (keyDrag || stretch || lane) cancelGestures();
      else if (selectedRefs.length) clearSelection();
      else document.querySelector<HTMLElement>('[role="application"]')?.focus();
      return;
    }
    if (event.key === 'Delete' && !inField && selectedRefs.length && !target.closest('[role="grid"]')) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const record = event.key.toLowerCase() === 'k' && !event.shiftKey;
    if (event.key !== ' ' && !record) return;
    if (target.closest(record ? 'input, textarea, [role="dialog"]' : 'button, input, select, textarea, [role="dialog"]')) return;
    event.preventDefault();
    if (record) toggleRecord();
    else togglePlay();
  }

  // Los gestos de un dedo (arrastrar un keyframe, la barra o el cabezal) se sueltan sin escribir si empieza uno de dos.
  function cancelGestures() {
    cancelPress();
    keyDrag = null;
    stretch = null;
    lane = null;
    lockTouch = false;
    picked.marquee = null;
    rangeDrag = null;
  }

  const capture = (event: PointerEvent) => {
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Un puntero sintético no se puede capturar.
    }
  };

  // Con el ratón, un arrastre sobre texto seleccionado empezaría un arrastre nativo (y un pointercancel): se anula la
  // acción por defecto y el foco se lleva a mano al rombo o a la rejilla, para que los atajos sigan llegando al panel.
  function holdPointer(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const target = event.currentTarget as HTMLElement;
    const focusable = target.getAttribute('role') === 'gridcell' ? target : target.closest<HTMLElement>('[role="grid"]');
    focusable?.focus({ preventScroll: true });
  }

  function cancelPress() {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  }

  // Rombo (o rombo resumen): clic selecciona; Mayús/Ctrl/⌘+clic (o «Añadir a la selección» con el dedo) suma o quita;
  // arrastrar mueve toda la selección con imán; con el dedo, la pulsación larga abre el menú.
  function keyDown(event: PointerEvent, refs: KeyRef[], ms: number, position: CellPosition | null) {
    lastPointer = event.pointerType;
    if (position) focus = position;
    const mouse = event.pointerType === 'mouse';
    if (mouse && event.button !== 0) return;
    event.stopPropagation();
    holdPointer(event);
    const touchLike = !mouse;
    const add = event.shiftKey || event.ctrlKey || event.metaKey || (touchLike && additive);
    let next: KeyRef[];
    let collapseTo: KeyRef[] | null = null;
    let toggleOff: KeyRef[] | null = null;
    if (add && isSelected(refs)) {
      // Con el ratón se quita en el acto. Con el dedo se decide al soltar: así la pulsación larga abre el menú con toda
      // la selección y un arrastre mueve el grupo.
      if (!touchLike) {
        const drop = new Set(refs.map(refId));
        picked.set(selectedRefs.filter((ref) => !drop.has(refId(ref))));
        return;
      }
      next = selectedRefs;
      toggleOff = refs;
    } else if (add) next = [...selectedRefs, ...refs];
    else if (isSelected(refs)) {
      next = selectedRefs;
      collapseTo = refs;
    } else next = refs;
    picked.set(next);
    const dragRefs = picked.refs().filter(shownRef);
    if (touchLike) startPress(event, refs);
    capture(event);
    keyDrag = {
      pointerId: event.pointerId,
      ids: new Set(dragRefs.map(refId)),
      refs: dragRefs,
      grabbedMs: ms,
      startX: event.clientX,
      startY: event.clientY,
      threshold: touchLike ? TOUCH_SLOP : DRAG_THRESHOLD,
      limits: readOnly ? { min: 0, max: 0 } : engine.anim.keyframes.moveLimits(dragRefs),
      targets: snapTargets(new Set(dragRefs.map(refId))),
      collapseTo,
      toggleOff,
      canMove: !readOnly,
      moved: false,
      delta: 0,
      snap: null,
    };
  }

  function startPress(event: PointerEvent, refs: KeyRef[]) {
    cancelPress();
    const at = { x: event.clientX, y: event.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      keyDrag = null;
      navigator.vibrate?.(10);
      if (!isSelected(refs)) picked.set(refs);
      openMenu(at);
    }, LONG_PRESS_MS);
  }

  function keyMove(event: PointerEvent) {
    const active = keyDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    if (!active.moved && Math.hypot(dx, event.clientY - active.startY) < active.threshold) return;
    cancelPress();
    if (!active.canMove) return;
    let delta = dx / zoom;
    let snap: number | null = null;
    if (!event.shiftKey) {
      const target = snapTo(active.grabbedMs + delta, active.targets);
      if (target !== null) {
        delta = target - active.grabbedMs;
        snap = target;
      }
    }
    delta = clamp(delta, active.limits);
    if (snap !== null && Math.abs(active.grabbedMs + delta - snap) > 1e-6) snap = null;
    keyDrag = { ...active, moved: true, delta: Math.round(delta * 1000) / 1000, snap };
  }

  // Se escribe una vez, al soltar: un paso de deshacer para todos los keyframes.
  function keyUp(event: PointerEvent) {
    const active = keyDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    cancelPress();
    keyDrag = null;
    if (!active.moved) {
      if (event.type !== 'pointerup') return;
      if (active.collapseTo) picked.set(active.collapseTo);
      else if (active.toggleOff) {
        const drop = new Set(active.toggleOff.map(refId));
        picked.set(selectedRefs.filter((ref) => !drop.has(refId(ref))));
      }
      return;
    }
    if (Math.abs(active.delta) < 1e-6) return;
    engine.anim.keyframes.moveKeyframes(active.refs, active.delta);
  }

  function keyCancel(event: PointerEvent) {
    if (keyDrag?.pointerId !== event.pointerId) return;
    cancelPress();
    keyDrag = null;
  }

  // Clic derecho sobre un rombo. Con el dedo, el menú lo abre la pulsación larga y el contextmenu nativo se descarta.
  function keyMenu(event: MouseEvent, refs: KeyRef[], position: CellPosition | null) {
    event.preventDefault();
    event.stopPropagation();
    if (lastPointer === 'touch' || lastPointer === 'pen') return;
    if (position) focus = position;
    if (!isSelected(refs)) picked.set(refs);
    openMenu({ x: event.clientX, y: event.clientY });
  }

  function laneMenu(event: MouseEvent) {
    event.preventDefault();
    if (lastPointer === 'touch' || lastPointer === 'pen') return;
    picked.clear();
    openMenu({ x: event.clientX, y: event.clientY });
  }

  function openMenu(at: { x: number; y: number }) {
    menu = { at, refs: selectedRefs };
  }

  function closeMenu(returnFocus: boolean) {
    menu = null;
    const keep = menuKeepFocus;
    menuKeepFocus = false;
    if (!returnFocus || keep || !current) return;
    document.getElementById(cellId(current))?.focus({ preventScroll: true });
  }

  // Marquesina: con el ratón, al arrastrar en el vacío; con el dedo, tras una pulsación larga en el vacío.
  function updateMarquee(clientX: number, clientY: number) {
    const gesture = lane;
    if (!gesture || !list) return;
    const end = list.gridPoint(clientX, clientY);
    const box = {
      x0: Math.min(gesture.origin.x, end.x),
      y0: Math.min(gesture.origin.y, end.y),
      x1: Math.max(gesture.origin.x, end.x),
      y1: Math.max(gesture.origin.y, end.y),
    };
    picked.marquee = box;
    const hits = refsIn(box);
    picked.set(gesture.additive ? [...gesture.base, ...hits] : hits);
  }

  // Keyframes cuyo rombo toca la caja (4 px de margen): los de las pistas y los resúmenes de las filas plegadas.
  function refsIn(box: { x0: number; y0: number; x1: number; y1: number }): KeyRef[] {
    const offsets = rowOffsets(heights);
    const hits: KeyRef[] = [];
    const inside = (x: number) => x >= box.x0 - 4 && x <= box.x1 + 4;
    rows.forEach((row, index) => {
      const y = (offsets[index] ?? 0) + (heights[index] ?? 0) / 2;
      if (y < box.y0 - 4 || y > box.y1 + 4) return;
      if (row.kind === 'track') {
        for (const kf of row.keyframes) if (inside(timeX(kf.time, zoom))) hits.push({ nodeId: row.id, prop: row.prop, key: kf.key });
      } else if (!row.expanded) {
        for (const mark of row.marks) if (inside(timeX(mark.ms, zoom))) hits.push(...mark.refs);
      }
    });
    return hits;
  }

  // Vacío de las pistas. Ratón: un clic lleva el cabezal allí y vacía la selección; arrastrar dibuja la marquesina. Dedo:
  // scroll nativo, un toque vacía la selección y la pulsación larga empieza la marquesina.
  function laneDown(event: PointerEvent) {
    lastPointer = event.pointerType;
    const touchLike = event.pointerType !== 'mouse';
    if (!touchLike && event.button !== 0) return;
    if (!list) return;
    const add = event.shiftKey || event.ctrlKey || event.metaKey || (touchLike && additive);
    const gesture: LaneGesture = {
      pointerId: event.pointerId,
      target: event.currentTarget as HTMLElement,
      startX: event.clientX,
      startY: event.clientY,
      origin: list.gridPoint(event.clientX, event.clientY),
      touch: touchLike,
      additive: add,
      base: add ? selectedRefs : [],
      marquee: false,
    };
    lane = gesture;
    if (!touchLike) {
      holdPointer(event);
      capture(event);
      return;
    }
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (lane !== gesture) return;
      navigator.vibrate?.(10);
      gesture.marquee = true;
      lockTouch = true;
      try {
        gesture.target.setPointerCapture(gesture.pointerId);
      } catch {
        // Un puntero sintético no se puede capturar.
      }
      updateMarquee(gesture.startX, gesture.startY);
    }, LONG_PRESS_MS);
  }

  function laneMove(event: PointerEvent) {
    const gesture = lane;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.marquee) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < (gesture.touch ? TOUCH_SLOP : DRAG_THRESHOLD)) return;
      if (gesture.touch) {
        // Es un scroll: lo hace el navegador.
        cancelPress();
        lane = null;
        return;
      }
      gesture.marquee = true;
    }
    updateMarquee(event.clientX, event.clientY);
  }

  function laneUp(event: PointerEvent) {
    const gesture = lane;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    cancelPress();
    lane = null;
    lockTouch = false;
    if (gesture.marquee) {
      picked.marquee = null;
      return;
    }
    if (event.type === 'pointercancel') return;
    if (!gesture.additive) picked.clear();
    if (!gesture.touch && list) setHead(list.timeAt(event.clientX));
  }

  // Asas de la caja de estirado: factor = (nuevo extremo − pivote) / (extremo − pivote), con imán en el asa.
  function stretchDown(event: PointerEvent, side: 'start' | 'end') {
    const box = stretchBox;
    if ((event.pointerType === 'mouse' && event.button !== 0) || readOnly || !box) return;
    event.stopPropagation();
    event.preventDefault();
    capture(event);
    const refs = selectedRefs;
    stretch = {
      pointerId: event.pointerId,
      side,
      startX: event.clientX,
      ids: new Set(refs.map(refId)),
      refs,
      minMs: box.min,
      maxMs: box.max,
      limits: engine.anim.keyframes.stretchLimits(refs, side === 'end' ? box.min : box.max),
      centerLimits: engine.anim.keyframes.stretchLimits(refs, (box.min + box.max) / 2),
      targets: snapTargets(new Set(refs.map(refId))),
      moved: false,
      pivot: side === 'end' ? box.min : box.max,
      factor: 1,
      snap: null,
    };
  }

  function stretchMove(event: PointerEvent) {
    const active = stretch;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    if (!active.moved && Math.abs(dx) < (event.pointerType === 'mouse' ? DRAG_THRESHOLD : TOUCH_SLOP)) return;
    const center = event.altKey;
    const pivot = center ? (active.minMs + active.maxMs) / 2 : active.side === 'end' ? active.minMs : active.maxMs;
    const original = active.side === 'end' ? active.maxMs : active.minMs;
    let edge = original + dx / zoom;
    let snap: number | null = null;
    if (!event.shiftKey) {
      const target = snapTo(edge, active.targets);
      if (target !== null) {
        edge = target;
        snap = target;
      }
    }
    const span = original - pivot;
    const factor = clamp(span !== 0 ? (edge - pivot) / span : 1, center ? active.centerLimits : active.limits);
    if (snap !== null && Math.abs(pivot + span * factor - snap) > 0.01) snap = null;
    stretch = { ...active, moved: true, pivot, factor, snap };
  }

  function stretchUp(event: PointerEvent) {
    const active = stretch;
    if (!active || active.pointerId !== event.pointerId) return;
    stretch = null;
    if (!active.moved || event.type === 'pointercancel' || Math.abs(active.factor - 1) < 1e-6) return;
    engine.anim.keyframes.stretchKeyframes(active.refs, active.pivot, active.factor);
  }

  // «Estirar…» del menú: un factor con el pivote en el primer keyframe seleccionado.
  function openStretch(at: { x: number; y: number }, refs: KeyRef[]) {
    const times = refs.map(msOf).filter((ms): ms is number => ms !== null);
    if (times.length < 2) return;
    const pivot = Math.min(...times);
    menuKeepFocus = true;
    stretchAt = { at, refs, pivot, limits: engine.anim.keyframes.stretchLimits(refs, pivot) };
  }

  function applyStretch(factor: number) {
    const target = stretchAt;
    stretchAt = null;
    if (target && !readOnly) engine.anim.keyframes.stretchKeyframes(target.refs, target.pivot, factor);
    refocusCell();
  }

  function refocusCell() {
    if (current) void tick().then(() => document.getElementById(cellId(current!))?.focus({ preventScroll: true }));
  }

  function openEasing(event: MouseEvent, row: TrackRowModel, kf: TimelineKeyframe) {
    if (readOnly) return;
    easingTarget = { ref: { nodeId: row.id, prop: row.prop, key: kf.key }, rect: (event.currentTarget as HTMLElement).getBoundingClientRect() };
  }

  const easingShown = $derived(easingTarget ? (keyframeOf(easingTarget.ref)?.e ?? null) : null);

  // Menú del keyframe: clic derecho, pulsación larga o la tecla de menú.
  const menuItems = $derived.by((): MenuEntry[] => {
    if (!menu) return [];
    const { refs, at } = menu;
    const has = refs.length > 0;
    const edit = !readOnly;
    const single = refs.length === 1 ? refs[0]! : null;
    const singleRow = single ? rows.find((row): row is TrackRowModel => row.kind === 'track' && row.id === single.nodeId && row.prop === single.prop) : undefined;
    const singleKf = single ? singleRow?.keyframes.find((kf) => kf.key === single.key) : undefined;
    const times = new Set(refs.map((ref) => Math.round(msOf(ref) ?? -1)));
    const easings = refs.map((ref) => keyframeOf(ref)?.e);
    return [
      {
        kind: 'item',
        id: 'edit',
        label: m.timeline_menu_edit(),
        icon: Pencil,
        disabled: !singleRow || !singleKf,
        onSelect: () => {
          if (!singleRow || !singleKf) return;
          menuKeepFocus = true;
          openEditor(singleRow, singleKf);
        },
      },
      { kind: 'separator', id: 'sep-edit' },
      { kind: 'item', id: 'copy', label: m.editor_menu_copy(), icon: Copy, keys: 'Ctrl+C', ariaKeys: 'Control+C', disabled: !has, onSelect: () => void copySelection() },
      { kind: 'item', id: 'paste', label: m.timeline_menu_paste(), icon: ClipboardPaste, keys: 'Ctrl+V', ariaKeys: 'Control+V', disabled: !edit || !hasClip, onSelect: () => void pasteAtHead() },
      { kind: 'item', id: 'duplicate', label: m.editor_menu_duplicate(), icon: CopyPlus, keys: 'Ctrl+D', ariaKeys: 'Control+D', disabled: !edit || !has, onSelect: () => void duplicateSelection() },
      { kind: 'item', id: 'delete', label: m.editor_menu_delete(), icon: Trash, keys: 'Supr', ariaKeys: 'Delete', danger: true, disabled: !edit || !has, onSelect: () => void deleteSelection() },
      { kind: 'separator', id: 'sep-time' },
      { kind: 'item', id: 'stretch', label: m.timeline_menu_stretch(), icon: MoveHorizontal, disabled: !edit || times.size < 2, onSelect: () => openStretch(at, refs) },
      {
        kind: 'sub',
        id: 'easing',
        label: m.timeline_menu_easing(),
        icon: Spline,
        disabled: !edit || !has,
        items: EASINGS.map((preset) => ({
          kind: 'check',
          id: preset,
          label: easingLabel(preset),
          checked: has && easings.every((easing) => easing === preset),
          onSelect: () => void engine.anim.keyframes.setEasing(refs, preset),
        })),
      },
    ];
  });

  function pickEasing(preset: EasingPreset) {
    if (easingTarget && !readOnly) engine.anim.keyframes.setEasing([easingTarget.ref], preset);
  }

  function toggleAdditive() {
    const current = engine.core.touchModifiers.get();
    engine.core.touchModifiers.set({ ...current, additive: !current.additive });
  }

  // Barra de rango: entera cambia el retardo; el extremo izquierdo, el inicio sin mover el final; el derecho, la
  // duración. Vista previa local durante el gesto y una escritura al soltar.
  function rangeDown(event: PointerEvent, row: NodeRow, mode: RangeMode) {
    if ((event.pointerType === 'mouse' && event.button !== 0) || readOnly || !row.animation) return;
    event.stopPropagation();
    capture(event);
    const { delay, duration } = row.animation;
    rangeDrag = { pointerId: event.pointerId, id: row.id, mode, startX: event.clientX, delay0: delay, duration0: duration, delay, duration, moved: false };
  }

  function rangeMove(event: PointerEvent) {
    const active = rangeDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    if (!active.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    const ms = Math.round(dx / zoom / RANGE_STEP) * RANGE_STEP;
    const { minDurationMs, maxDurationMs, maxDelayMs } = ANIMATION_LIMITS;
    const end = active.delay0 + active.duration0;
    let { delay, duration } = active;
    if (active.mode === 'move') delay = Math.min(maxDelayMs, Math.max(0, active.delay0 + ms));
    else if (active.mode === 'end') duration = Math.min(maxDurationMs, Math.max(minDurationMs, active.duration0 + ms));
    else {
      delay = Math.min(Math.min(maxDelayMs, end - minDurationMs), Math.max(0, end - maxDurationMs, active.delay0 + ms));
      duration = end - delay;
    }
    rangeDrag = { ...active, moved: true, delay, duration };
  }

  function rangeUp(event: PointerEvent) {
    const active = rangeDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    rangeDrag = null;
    if (!active.moved || (active.delay === active.delay0 && active.duration === active.duration0)) return;
    engine.anim.keyframes.setAnimation(active.id, { delay: active.delay, duration: active.duration });
  }

  function settingsOf(row: Row): { delay: number; duration: number } | null {
    if (rangeDrag?.id === row.id) return { delay: rangeDrag.delay, duration: rangeDrag.duration };
    return row.animation ? { delay: row.animation.delay, duration: row.animation.duration } : null;
  }

  function shownTime(row: TrackRowModel, kf: TimelineKeyframe): number {
    const settings = settingsOf(row);
    if (rangeDrag?.id === row.id && settings) return keyframeAt(settings, kf.keyframe.t);
    return previewMs({ nodeId: row.id, prop: row.prop, key: kf.key }, kf.time);
  }

  function markTime(row: NodeRow, ms: number, refs: readonly KeyRef[]): number {
    const settings = settingsOf(row);
    if (rangeDrag?.id === row.id && settings && row.animation) return settings.delay + ((ms - row.animation.delay) / (row.animation.duration || 1)) * settings.duration;
    return refs[0] ? previewMs(refs[0], ms) : ms;
  }

  function valueAt(row: TrackRowModel): number | string | null {
    const pose = poses.get(row.id);
    return pose ? poseValue(pose, row.prop) : null;
  }

  // Escribir el valor de una pista crea o actualiza el keyframe del cabezal, en un paso de deshacer.
  function commitValue(row: TrackRowModel, shown: number) {
    if (readOnly) return;
    const value = fromDisplay(row.prop, shown);
    if (!engine.anim.keyframes.recordAt(head, [{ id: row.id, prop: row.prop, value, mode: 'set' }])) {
      showToast({ message: m.timeline_add_error(), tone: 'error' });
    }
  }

  function playRow(row: NodeRow) {
    if (previewing.has(row.id)) engine.anim.preview(null);
    else engine.anim.preview([row.id]);
  }

  function nodeLabel(row: NodeRow): string {
    const label = m.timeline_node({ name: nameOf(row), count: row.count });
    return proposed?.has(row.id) ? `${label} (${m.timeline_ai_proposed()})` : label;
  }

  const actions: RowActions = {
    cellId,
    tabindex: (row, key) => (current?.row === row.rowKey && current.key === key ? 0 : -1),
    isSelected,
    focusCell: (position) => (focus = position),
    nameOf,
    nodeLabel,
    select: (row) => engine.commands.select([row.id]),
    toggle: (row, expand) => toggle(row.id, expand),
    play: playRow,
    menu: rowMenu,
    menuCloseFocus: (event) => {
      if (!keepMenuFocus) return;
      keepMenuFocus = false;
      event.preventDefault();
    },
    settingsOf,
    shownTime,
    rangeDown,
    rangeMove,
    rangeUp,
    laneDown,
    laneMove,
    laneUp,
    laneMenu,
    markTime,
    keyframeLabel: (row, kf) => m.timeline_keyframe({ track: propLabel(row.prop), time: formatTime(kf.time), value: formatValue(row.prop, kf.keyframe.v) }),
    keyDown,
    keyMove,
    keyUp,
    keyCancel,
    keyMenu,
    segment: openEasing,
    edit: openEditor,
    valueAt,
    commitValue,
    keyframeContext: () => ({ engine, at: head, version }),
  };

  // Asa del borde superior: arrastrar hacia arriba la hace más alta.
  function resizeDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    capture(event);
    resizing = { pointerId: event.pointerId, y: event.clientY, height };
    resizeActive = true;
  }

  function resizeMove(event: PointerEvent) {
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    resize(resizing.height - (event.clientY - resizing.y));
  }

  function resizeUp(event: PointerEvent) {
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    resizing = null;
    resizeActive = false;
  }

  function resize(next: number) {
    layout.timeline.height = Math.round(Math.min(maxHeight, Math.max(TIMELINE_HEIGHT.min, next)));
  }

  function resizeKey(event: KeyboardEvent) {
    if (event.key === 'ArrowUp') resize(height + WIDTH_STEP);
    else if (event.key === 'ArrowDown') resize(height - WIDTH_STEP);
    else if (event.key === 'Home') resize(TIMELINE_HEIGHT.min);
    else if (event.key === 'End') resize(maxHeight);
    else return;
    event.preventDefault();
  }

  const grid = $derived({
    role: 'grid',
    tabindex: -1,
    'aria-labelledby': `${uid}-title`,
    'aria-describedby': `${uid}-hint`,
    'aria-rowcount': rows.length,
    'aria-multiselectable': true,
    onkeydown: onGridKey,
  });
</script>

<svelte:window bind:innerHeight />

<!-- Espacio reproduce o pausa desde cualquier parte del panel. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  bind:this={section}
  aria-labelledby="{uid}-title"
  hidden={!open}
  data-own-keys
  onkeydown={onPanelKey}
  style:height={sheet ? null : `${height}px`}
  style:box-shadow={recording ? (sheet ? 'inset 0 2px 0 var(--color-danger)' : 'inset 0 2px 0 var(--color-danger), var(--shadow-float)') : undefined}
  class={[
    'relative flex flex-col bg-surface-1 text-sm',
    sheet ? 'min-h-0 flex-1' : 'rounded-panel border border-edge/40 shadow-float',
  ]}
  data-testid="timeline"
  data-recording={recording ? '' : undefined}
>
  <!-- El asa se mueve con el puntero y con ↑/↓; es un separador con valor, no un botón. En la hoja del móvil, el alto lo
       da el asa de la hoja. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    hidden={sheet}
    role="separator"
    aria-orientation="horizontal"
    aria-label={m.timeline_resize()}
    aria-valuenow={height}
    aria-valuemin={TIMELINE_HEIGHT.min}
    aria-valuemax={maxHeight}
    tabindex="0"
    onpointerdown={resizeDown}
    onpointermove={resizeMove}
    onpointerup={resizeUp}
    onpointercancel={resizeUp}
    onkeydown={resizeKey}
    class={[
      'absolute inset-x-3 top-0 z-40 h-1.5 cursor-ns-resize touch-none rounded-full outline-none',
      'transition-colors duration-(--dur-fast) hover:bg-edge/60 focus-visible:bg-coral',
      // Con el dedo, la zona de toque (24 px) crece hacia fuera del panel y no tapa los botones de la cabecera.
      'touch:before:absolute touch:before:inset-x-0 touch:before:-top-[18px] touch:before:bottom-0',
      resizeActive && 'bg-coral',
    ]}
    data-testid="timeline-resizer"
  ></div>

  {#if aiAnimation && aiOpen}
    <div id="{uid}-ai" class="absolute top-11 right-2 z-40 w-80">
      <AiAnimate {engine} {projectId} {selection} onclose={() => (aiOpen = false)} />
    </div>
  {/if}

  <h2 id="{uid}-title" class="sr-only">{m.timeline_label()}</h2>
  <!-- Encajar, IA y × quedan siempre a la vista; si no cabe el resto, se desplaza y el slider de zoom se oculta. -->
  <div
    class={['@container flex shrink-0 items-center gap-1 border-b border-edge/40 px-2', sheet ? 'h-13' : touch ? 'h-12' : 'h-10']}
    data-testid="timeline-header"
  >
    <div class="scroll-thin flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto" data-testid="timeline-header-scroll">
      <ToolButton variant="tool" size={toolSize} side="top" label={playing ? m.timeline_pause() : m.timeline_play()} kbd="Espacio" ariaKeys="Space" onclick={togglePlay}>
        {#if playing}<Pause size={sheet ? 20 : 16} aria-hidden="true" />{:else}<Play size={sheet ? 20 : 16} aria-hidden="true" />{/if}
      </ToolButton>
      {#if !sheet}
        <ToolButton variant="tool" size="xs" side="top" label={m.timeline_rewind()} onclick={rewind}><SkipBack size={14} aria-hidden="true" /></ToolButton>
      {/if}
      <ScrubInput
        value={Math.round(head) / 1000}
        label={m.timeline_time_field()}
        unit="s"
        step={0.01}
        min={0}
        max={Math.round(span) / 1000}
        size={sheet ? 'lg' : 'md'}
        class="ml-1 w-16 shrink-0"
        testid="timeline-time-field"
        oncommit={(seconds) => setHead(seconds * 1000)}
      />
      <!-- En la hoja del móvil la duración solo se lee (la regla ya la enseña): así Grabar y «Añadir a la selección»
           caben sin desplazar la cabecera. -->
      <span class={sheet ? 'sr-only' : 'shrink-0 text-xs whitespace-nowrap text-ink-muted tabular'} data-testid="timeline-time">/ {formatTime(span)}</span>
      <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/40"></span>
      {#if !readOnly}
        <button
          type="button"
          aria-pressed={recording}
          aria-keyshortcuts="K"
          onclick={toggleRecord}
          class={[
            'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2.5 transition-colors duration-(--dur-fast)',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
            sheet ? 'h-11 text-sm' : 'h-7 text-xs',
            recording ? 'bg-danger/15 text-danger' : 'text-ink hover:bg-petrol',
          ]}
          data-testid="timeline-record"
        >
          <span aria-hidden="true" class={['size-2 rounded-full border border-danger', recording && 'bg-danger']}></span>
          {recording ? m.timeline_recording_on() : m.timeline_record()}
        </button>
        <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/40"></span>
      {/if}
      {#if touch}
        <!-- Con el dedo no hay Mayús: cada toque suma o quita un rombo de la selección. -->
        <button
          type="button"
          aria-pressed={additive}
          aria-label={m.timeline_additive()}
          onclick={toggleAdditive}
          class={[
            'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control transition-colors duration-(--dur-fast)',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
            additive ? 'bg-coral text-coral-ink' : 'text-ink-muted hover:bg-petrol hover:text-ink',
          ]}
          data-testid="timeline-additive"
        >
          <ListPlus size={18} aria-hidden="true" />
        </button>
        {#if selectedRefs.length}
          <button
            type="button"
            aria-label={m.timeline_clear_selection()}
            onclick={clearSelection}
            class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral"
            data-testid="timeline-clear-selection"
          >
            <ListX size={18} aria-hidden="true" />
          </button>
        {/if}
        <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/40"></span>
      {/if}
      <ToolButton variant="tool" size={smallToolSize} side="top" label={m.timeline_repeat()} pressed={repeat} onclick={toggleRepeat}>
        <Repeat size={smallIcon} aria-hidden="true" />
      </ToolButton>
      <Select
        items={SPEEDS}
        value={speed}
        label={m.timeline_speed()}
        size="sm"
        side="top"
        density={sheet ? 'touch' : 'default'}
        class={sheet ? 'w-18 shrink-0' : 'h-7 w-16 shrink-0'}
        onValueChange={pickSpeed}
        testid="timeline-speed"
      />
      <span class="min-w-2 flex-1"></span>
      <ToolButton variant="tool" size={smallToolSize} side="top" label={m.timeline_zoom_out()} onclick={() => list?.zoomBy(1 / 1.5)}>
        <Minus size={smallIcon} aria-hidden="true" />
      </ToolButton>
      {#if !sheet}
        <Slider
          value={zoomToSlider(zoom)}
          label={m.timeline_zoom()}
          min={0}
          max={100}
          valueText={`${Math.round(zoom * 1000)} px/s`}
          class="w-20! shrink-0 @max-2xl:hidden!"
          testid="timeline-zoom"
          oninput={(value) => list?.zoomTo(sliderToZoom(value))}
          oncommit={(value) => list?.zoomTo(sliderToZoom(value))}
        />
      {/if}
      <ToolButton variant="tool" size={smallToolSize} side="top" label={m.timeline_zoom_in()} onclick={() => list?.zoomBy(1.5)}>
        <Plus size={smallIcon} aria-hidden="true" />
      </ToolButton>
    </div>
    <ToolButton variant="tool" size={smallToolSize} side="top" label={m.timeline_fit()} onclick={() => list?.fit()} testid="timeline-fit">
      <UnfoldHorizontal size={smallIcon} aria-hidden="true" />
    </ToolButton>
    {#if aiAnimation}
      <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/40"></span>
      <button
        type="button"
        aria-expanded={aiOpen}
        aria-controls="{uid}-ai"
        onclick={() => (aiOpen = !aiOpen)}
        class={[
          'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-control transition-colors duration-(--dur-fast)',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
          sheet ? 'size-11 justify-center' : 'h-7 px-2.5 text-xs',
          aiOpen ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-petrol hover:text-ink',
        ]}
        aria-label={sheet ? m.timeline_ai_animate() : undefined}
        data-testid="timeline-ai"
      >
        <WandSparkles size={smallIcon} aria-hidden="true" />
        {#if !sheet}{m.timeline_ai_animate()}{/if}
      </button>
    {/if}
    {#if !sheet}
      <ToolButton variant="tool" size="xs" side="top" label={m.timeline_hide()} onclick={onclose}><X size={14} aria-hidden="true" /></ToolButton>
    {/if}
  </div>
  <p role="status" class="sr-only">{recording ? m.timeline_recording({ time: formatTime(head) }) : ''}</p>
  <p role="status" class="sr-only" data-testid="timeline-announcement">{announcement}</p>
  <p id="{uid}-hint" class="sr-only">{m.timeline_hint()}</p>

  {#if rows.length === 0}
    <div class="flex min-h-0 flex-1 items-center justify-center px-6">
      <p class="max-w-xl text-center text-sm text-ink-muted">{m.timeline_empty()}</p>
    </div>
  {:else}
    <TrackList
      bind:this={list}
      bind:zoom
      {rows}
      {heights}
      {head}
      {span}
      {recording}
      {touch}
      {grid}
      {lockTouch}
      {labelWidth}
      onseek={setHead}
      onheadkey={onHeadKey}
      oncancelgesture={cancelGestures}
    >
      {#snippet overlay()}
        {#if picked.marquee}
          {@const box = picked.marquee}
          <div
            class="absolute rounded-xs border border-coral bg-coral/8"
            style:left="{box.x0}px"
            style:top="{box.y0}px"
            style:width="{box.x1 - box.x0}px"
            style:height="{box.y1 - box.y0}px"
            data-testid="timeline-marquee"
          ></div>
        {/if}
        {#if snapGuide !== null}
          <div class="absolute inset-y-0 w-px bg-sage" style:left="{timeX(snapGuide, zoom)}px" data-testid="timeline-snap"></div>
        {/if}
        {#if stretchBox && !readOnly}
          {@const left = timeX(stretchBox.min, zoom)}
          {@const right = timeX(stretchBox.max, zoom)}
          <div class="absolute h-1 rounded-xs bg-coral/20" style:left="{left}px" style:width="{right - left}px" style:top="{stretchBox.top}px" data-testid="timeline-stretch"></div>
          {#each ['start', 'end'] as const as side (side)}
            <span
              role="none"
              onpointerdown={(event) => stretchDown(event, side)}
              onpointermove={stretchMove}
              onpointerup={stretchUp}
              onpointercancel={stretchUp}
              class={['pointer-events-auto absolute -translate-x-1/2 cursor-ew-resize touch-none', touch ? 'size-6' : 'size-4']}
              style:left="{side === 'start' ? left : right}px"
              style:top="{stretchBox.top}px"
              data-testid="timeline-stretch-{side}"
            >
              <!-- La zona de toque crece solo hacia abajo desde la barra: no tapa los rombos de encima. -->
              <span class="pointer-events-none absolute top-0.5 left-1/2 block h-3 w-1 -translate-1/2 rounded-xs bg-coral"></span>
            </span>
          {/each}
        {/if}
      {/snippet}
      {#snippet row(item, place)}
        <TrackRow
          row={item}
          top={place.top}
          height={place.height}
          index={place.index}
          {zoom}
          {head}
          {touch}
          {readOnly}
          selected={item.kind === 'node' && selection.includes(item.id)}
          playing={item.kind === 'node' && previewing.has(item.id)}
          proposed={proposed?.has(item.id) ?? false}
          {actions}
          {sheet}
          {labelWidth}
        />
      {/snippet}
    </TrackList>
  {/if}

  {#if sheet}
    {#if menu}
      <ActionSheet items={menuItems} title={m.timeline_keyframe_menu()} onclose={closeMenu} testid="keyframe-menu" />
    {/if}
  {:else}
    <PointMenu items={menuItems} at={menu?.at ?? null} onclose={closeMenu} label={m.timeline_keyframe_menu()} testid="keyframe-menu" />
  {/if}
  {#if easingTarget && easingShown !== null}
    <EasingPopover at={easingTarget.rect} easing={easingShown} {readOnly} onpick={pickEasing} onclose={() => (easingTarget = null)} />
  {/if}
  {#if stretchAt}
    <StretchPopover
      at={stretchAt.at}
      min={stretchAt.limits.min}
      max={stretchAt.limits.max}
      onapply={applyStretch}
      onclose={() => {
        stretchAt = null;
        refocusCell();
      }}
    />
  {/if}

  {#if editing && editTarget}
    <div class="fixed z-50" style:left="{editing.left}px" style:bottom="{editing.bottom}px">
      {#key `${editing.id}:${editing.prop}:${editing.key}`}
        <KeyframeEditor
          prop={editTarget.row.prop}
          keyframe={editTarget.kf.keyframe}
          delay={editTarget.animation.delay}
          duration={editTarget.animation.duration}
          {readOnly}
          onsave={saveEditor}
          ondelete={deleteFromEditor}
          onclose={closeEditor}
          onleave={() => (editing = null)}
        />
      {/key}
    </div>
  {/if}
</section>
