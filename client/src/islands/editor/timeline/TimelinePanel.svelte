<script lang="ts">
  import Minus from '@lucide/svelte/icons/minus';
  import Pause from '@lucide/svelte/icons/pause';
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
    type Pose,
  } from '../../../engine/index.ts';
  import { getEditorLayout, TIMELINE_HEIGHT, WIDTH_STEP } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import { ANIMATION_LIMITS } from '../../../shared/document/limits.js';
  import type { Animation, AnimProp, Keyframe } from '../../../shared/document/schema.js';
  import type { MenuEntry } from '../../../ui/DropdownMenu.svelte';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import { kindLabel } from '../kinds.ts';
  import ToolButton from '../ToolButton.svelte';
  import AiAnimate from './AiAnimate.svelte';
  import KeyframeEditor from './KeyframeEditor.svelte';
  import TrackList from './TrackList.svelte';
  import TrackRow, { type CellPosition, type RangeMode, type RowActions } from './TrackRow.svelte';
  import {
    buildRows,
    formatTime,
    formatValue,
    fromDisplay,
    keyframeAt,
    propLabel,
    rowHeight,
    sliderToZoom,
    spanOf,
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
  };

  let { engine, projectId, readOnly: canNotEdit, aiAnimation, open, touch, focusRequest, onclose }: Props = $props();

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
  const NUDGE = 0.01;
  // Los arrastres de la barra de rango van de 10 en 10 ms.
  const RANGE_STEP = 10;

  type Drag = { pointerId: number; id: string; prop: AnimProp; key: string; startX: number; startT: number; t: number; duration: number; moved: boolean };
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
  let drag = $state<Drag | null>(null);
  let rangeDrag = $state<RangeDrag | null>(null);
  let scrubbing: number | null = null;
  // La acción del menú de una fila ya lleva el foco a otro sitio: el menú no lo devuelve a su botón.
  let keepMenuFocus = false;
  let wasPlaying = false;
  let wasPreview = false;
  let list = $state<ReturnType<typeof TrackList<Row>> | null>(null);
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
  const heights = $derived(rows.map((row) => rowHeight(row, touch)));

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
  const isCurrent = (row: Row, key: string | null) => current?.row === row.rowKey && current.key === key;

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
    switch (event.key) {
      case 'ArrowRight':
        if (event.altKey) {
          if (kf && row.kind === 'track') nudge(row, kf, 1);
        } else if (row.kind === 'node') {
          if (!row.expanded) toggle(row.id, true);
          else go(index + 1, null);
        } else if (at + 1 < kfs.length) go(index, kfs[at + 1]!.key);
        break;
      case 'ArrowLeft':
        if (event.altKey) {
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
        if (kf && row.kind === 'track') remove(row, kf);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // Espacio reproduce o pausa y K enciende o apaga Grabar, con el foco en cualquier parte del panel salvo en un
  // control que ya usa la tecla. Esc no cierra la línea de tiempo: solo la cierran × y el botón de la barra.
  function onPanelKey(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const record = event.key.toLowerCase() === 'k' && !event.shiftKey;
    if (event.key !== ' ' && !record) return;
    const target = event.target as HTMLElement;
    if (target.closest(record ? 'input, textarea, [role="dialog"]' : 'button, input, select, textarea, [role="dialog"]')) return;
    event.preventDefault();
    if (record) toggleRecord();
    else togglePlay();
  }

  // Los gestos de un dedo (arrastrar un keyframe, la barra o el cabezal) se sueltan sin escribir si empieza uno de dos.
  function cancelGestures() {
    drag = null;
    rangeDrag = null;
    scrubbing = null;
  }

  const capture = (event: PointerEvent) => {
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Un puntero sintético no se puede capturar.
    }
  };

  function dragStart(event: PointerEvent, row: TrackRowModel, kf: TimelineKeyframe) {
    focus = { row: row.rowKey, key: kf.key };
    if ((event.pointerType === 'mouse' && event.button !== 0) || readOnly || !row.animation) return;
    event.stopPropagation();
    capture(event);
    drag = { pointerId: event.pointerId, id: row.id, prop: row.prop, key: kf.key, startX: event.clientX, startT: kf.keyframe.t, t: kf.keyframe.t, duration: row.animation.duration, moved: false };
  }

  function dragMove(event: PointerEvent) {
    const active = drag;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    if (!active.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    const t = Math.min(1, Math.max(0, active.startT + dx / zoom / active.duration));
    drag = { ...active, moved: true, t: Math.round(t * 10000) / 10000 };
  }

  // Se escribe una vez, al soltar.
  function dragEnd(event: PointerEvent) {
    const active = drag;
    if (!active || active.pointerId !== event.pointerId) return;
    drag = null;
    if (!active.moved || active.t === active.startT) return;
    engine.anim.keyframes.moveKeyframe(active.id, active.prop, active.key, active.t);
    pendingFocus = { row: `${active.id}:${active.prop}`, key: active.key };
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

  // Un clic en el vacío de las pistas lleva el cabezal allí. Con el dedo, el vacío hace scroll.
  function laneDown(event: PointerEvent) {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    scrubbing = event.pointerId;
    capture(event);
    if (list) setHead(list.timeAt(event.clientX));
  }

  function laneMove(event: PointerEvent) {
    if (scrubbing === event.pointerId && list) setHead(list.timeAt(event.clientX));
  }

  function laneUp(event: PointerEvent) {
    if (scrubbing === event.pointerId) scrubbing = null;
  }

  function settingsOf(row: Row): { delay: number; duration: number } | null {
    if (rangeDrag?.id === row.id) return { delay: rangeDrag.delay, duration: rangeDrag.duration };
    return row.animation ? { delay: row.animation.delay, duration: row.animation.duration } : null;
  }

  function shownTime(row: TrackRowModel, kf: TimelineKeyframe): number {
    const settings = settingsOf(row);
    if (drag && drag.key === kf.key && drag.id === row.id && drag.prop === row.prop && settings) return keyframeAt(settings, drag.t);
    if (rangeDrag?.id === row.id && settings) return keyframeAt(settings, kf.keyframe.t);
    return kf.time;
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
    isCurrent,
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
    keyframeLabel: (row, kf) => m.timeline_keyframe({ track: propLabel(row.prop), time: formatTime(kf.time), value: formatValue(row.prop, kf.keyframe.v) }),
    dragStart,
    dragMove,
    dragEnd,
    dragCancel: () => (drag = null),
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
    onkeydown: onGridKey,
  });
</script>

<svelte:window bind:innerHeight />

<!-- Espacio reproduce o pausa desde cualquier parte del panel. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  aria-labelledby="{uid}-title"
  hidden={!open}
  data-own-keys
  onkeydown={onPanelKey}
  style:height="{height}px"
  style:box-shadow={recording ? 'inset 0 2px 0 var(--color-danger), var(--shadow-float)' : undefined}
  class="relative flex flex-col rounded-panel border border-edge/40 bg-surface-1 text-sm shadow-float"
  data-testid="timeline"
  data-recording={recording ? '' : undefined}
>
  <!-- El asa se mueve con el puntero y con ↑/↓; es un separador con valor, no un botón. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
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
  <div class="@container flex h-10 shrink-0 items-center gap-1 border-b border-edge/40 px-2" data-testid="timeline-header">
    <div class="scroll-thin flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto" data-testid="timeline-header-scroll">
      <ToolButton variant="tool" size="sm" side="top" label={playing ? m.timeline_pause() : m.timeline_play()} kbd="Espacio" ariaKeys="Space" onclick={togglePlay}>
        {#if playing}<Pause size={16} aria-hidden="true" />{:else}<Play size={16} aria-hidden="true" />{/if}
      </ToolButton>
      <ToolButton variant="tool" size="xs" side="top" label={m.timeline_rewind()} onclick={rewind}><SkipBack size={14} aria-hidden="true" /></ToolButton>
      <ScrubInput
        value={Math.round(head) / 1000}
        label={m.timeline_time_field()}
        unit="s"
        step={0.01}
        min={0}
        max={Math.round(span) / 1000}
        class="ml-1 w-16 shrink-0"
        testid="timeline-time-field"
        oncommit={(seconds) => setHead(seconds * 1000)}
      />
      <span class="shrink-0 text-xs whitespace-nowrap text-ink-muted tabular" data-testid="timeline-time">/ {formatTime(span)}</span>
      <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/40"></span>
      {#if !readOnly}
        <button
          type="button"
          aria-pressed={recording}
          aria-keyshortcuts="K"
          onclick={toggleRecord}
          class={[
            'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-xs transition-colors duration-(--dur-fast)',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
            recording ? 'bg-danger/15 text-danger' : 'text-ink hover:bg-petrol',
          ]}
          data-testid="timeline-record"
        >
          <span aria-hidden="true" class={['size-2 rounded-full border border-danger', recording && 'bg-danger']}></span>
          {recording ? m.timeline_recording_on() : m.timeline_record()}
        </button>
        <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/40"></span>
      {/if}
      <ToolButton variant="tool" size="xs" side="top" label={m.timeline_repeat()} pressed={repeat} onclick={toggleRepeat}>
        <Repeat size={14} aria-hidden="true" />
      </ToolButton>
      <Select items={SPEEDS} value={speed} label={m.timeline_speed()} size="sm" side="top" class="h-7 w-16 shrink-0" onValueChange={pickSpeed} testid="timeline-speed" />
      <span class="min-w-2 flex-1"></span>
      <ToolButton variant="tool" size="xs" side="top" label={m.timeline_zoom_out()} onclick={() => list?.zoomBy(1 / 1.5)}><Minus size={14} aria-hidden="true" /></ToolButton>
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
      <ToolButton variant="tool" size="xs" side="top" label={m.timeline_zoom_in()} onclick={() => list?.zoomBy(1.5)}><Plus size={14} aria-hidden="true" /></ToolButton>
    </div>
    <ToolButton variant="tool" size="xs" side="top" label={m.timeline_fit()} onclick={() => list?.fit()} testid="timeline-fit">
      <UnfoldHorizontal size={14} aria-hidden="true" />
    </ToolButton>
    {#if aiAnimation}
      <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/40"></span>
      <button
        type="button"
        aria-expanded={aiOpen}
        aria-controls="{uid}-ai"
        onclick={() => (aiOpen = !aiOpen)}
        class={[
          'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-xs transition-colors duration-(--dur-fast)',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
          aiOpen ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-petrol hover:text-ink',
        ]}
        data-testid="timeline-ai"
      >
        <WandSparkles size={14} aria-hidden="true" />
        {m.timeline_ai_animate()}
      </button>
    {/if}
    <ToolButton variant="tool" size="xs" side="top" label={m.timeline_hide()} onclick={onclose}><X size={14} aria-hidden="true" /></ToolButton>
  </div>
  <p role="status" class="sr-only">{recording ? m.timeline_recording({ time: formatTime(head) }) : ''}</p>
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
      onseek={setHead}
      onheadkey={onHeadKey}
      oncancelgesture={cancelGestures}
    >
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
        />
      {/snippet}
    </TrackList>
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
