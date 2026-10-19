<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Repeat from '@lucide/svelte/icons/repeat';
  import SkipBack from '@lucide/svelte/icons/skip-back';
  import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import { tick, untrack } from 'svelte';
  import { displayName, kindOf } from '../../../engine/a11y/describe.ts';
  import { rowWindow } from '../../../engine/a11y/layers.ts';
  import { AI_PREVIEW_COLOR, type AnimationState, type Engine } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import { ANIMATION_LIMITS } from '../../../shared/document/limits.js';
  import type { Animation, AnimProp, Keyframe } from '../../../shared/document/schema.js';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import { kindLabel } from '../kinds.ts';
  import ToolButton from '../ToolButton.svelte';
  import AiAnimate from './AiAnimate.svelte';
  import KeyframeEditor from './KeyframeEditor.svelte';
  import {
    buildRows,
    formatTime,
    formatValue,
    keyframeAt,
    MAX_ZOOM,
    MIN_ZOOM,
    propLabel,
    ROW_HEIGHT,
    spanOf,
    tickStep,
    type NodeRow,
    type Row,
    type TimelineKeyframe,
    type TrackRow,
  } from './model.ts';

  type Props = {
    engine: Engine;
    projectId: string;
    readOnly: boolean;
    // Hay modelo de animación y permiso para usarlo: muestra «Animar con IA».
    aiAnimation: boolean;
    open: boolean;
    // Sube cada vez que «Animar…» pide llevar el foco a la selección.
    focusRequest: number;
    onclose: () => void;
  };

  let { engine, projectId, readOnly: canNotEdit, aiAnimation, open, focusRequest, onclose }: Props = $props();

  // Animaciones propuestas por la IA en vista previa: sus pistas se pintan en violeta y, mientras están, el
  // timeline no edita (lo que se ve no es el documento).
  let proposed = $state.raw<ReadonlyMap<string, Animation> | null>(null);
  let aiOpen = $state(false);
  const readOnly = $derived(canNotEdit || proposed !== null);
  const animationOf = (id: string) => proposed?.get(id) ?? engine.core.store.animation(id);

  const uid = $props.id();
  const LABEL_WIDTH = 360;
  const SPEEDS = [0.5, 1, 2] as const;
  // Margen a la derecha de la regla para que el último keyframe no quede pegado al borde.
  const TAIL = 32;
  const DRAG_THRESHOLD = 3;
  const NUDGE = 0.01;

  type Focus = { row: string; key: string | null };
  type Drag = { id: string; prop: AnimProp; key: string; startX: number; startT: number; t: number; duration: number; moved: boolean };

  let version = $state(0);
  let layers = $state(0);
  let pageId = $state<string | null>(null);
  let selection = $state.raw<readonly string[]>([]);
  let player = $state.raw<AnimationState>({ status: 'stopped', time: 0, duration: 0 });
  let head = $state(0);
  let speed = $state<number>(1);
  let repeat = $state(false);
  let recording = $state(false);
  let zoom = $state(0.25);
  let fitted = false;
  let scroll = $state(0);
  let laneWidth = $state(0);
  let scrollTop = $state(0);
  let gridHeight = $state(160);
  let collapsed = $state.raw<ReadonlySet<string>>(new Set());
  let focus = $state<Focus | null>(null);
  let pendingFocus = $state<Focus | null>(null);
  let editing = $state<{ id: string; prop: AnimProp; key: string; left: number; bottom: number } | null>(null);
  let drag = $state<Drag | null>(null);
  let scrubbing = false;
  let wasPlaying = false;
  let grid = $state<HTMLElement | null>(null);
  let ruler = $state<HTMLElement | null>(null);

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
      return () => {
        unsubscribe.forEach((run) => run());
        source.anim.record(null);
      };
    });
  });

  // El cabezal es local; solo sigue al reproductor mientras reproduce y en el frame en que termina.
  function onPlayer(state: AnimationState) {
    player = state;
    if (state.status === 'playing' || wasPlaying) head = state.time;
    wasPlaying = state.status === 'playing';
  }

  const playing = $derived(player.status === 'playing');

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

  const span = $derived.by(() => {
    void version;
    const animations = ids.map(animationOf).filter((item): item is Animation => !!item);
    return spanOf(animations, head);
  });

  const visibleMs = $derived(Math.max(1, laneWidth) / zoom);
  const maxScroll = $derived(Math.max(0, span + TAIL / zoom - visibleMs));
  const toX = (ms: number) => (ms - scroll) * zoom;

  const ticks = $derived.by(() => {
    const step = tickStep(zoom);
    const result: number[] = [];
    for (let ms = Math.floor(scroll / step) * step; ms <= scroll + visibleMs; ms += step) if (ms >= 0) result.push(ms);
    return result;
  });

  const range = $derived(rowWindow(rows.length, scrollTop, gridHeight, ROW_HEIGHT));
  const shown = $derived(rows.slice(range.start, range.end));
  const current = $derived.by((): Focus | null => {
    const row = focus && rows.find((item) => item.rowKey === focus!.row);
    if (row && focus) return { row: row.rowKey, key: row.kind === 'track' && row.keyframes.some((kf) => kf.key === focus!.key) ? focus.key : null };
    return rows[0] ? { row: rows[0].rowKey, key: null } : null;
  });
  // Una sola celda entra en el orden de tabulación; si la activa no está pintada, la cabecera de la primera fila.
  const tabStop = $derived(current && shown.some((row) => row.rowKey === current.row) ? current : shown[0] ? { row: shown[0].rowKey, key: null } : null);

  const editTarget = $derived.by(() => {
    if (!editing) return null;
    const row = rows.find((item): item is TrackRow => item.kind === 'track' && item.id === editing!.id && item.prop === editing!.prop);
    const kf = row?.keyframes.find((item) => item.key === editing!.key);
    return row && kf && row.animation ? { row, kf, animation: row.animation } : null;
  });

  // Si el keyframe que se edita desaparece (borrado, deshacer o cambio remoto), el editor se cierra.
  $effect(() => {
    if (editing && !editTarget) untrack(() => (editing = null));
  });

  // Encaja la duración en el ancho la primera vez que se mide la regla.
  $effect(() => {
    if (fitted || laneWidth <= 0) return;
    fitted = true;
    zoom = clampZoom((laneWidth - TAIL) / untrack(() => span));
  });

  // Mientras reproduce, el cabezal no sale de la vista.
  $effect(() => {
    const time = head;
    untrack(() => {
      const x = toX(time);
      if (laneWidth > 0 && (x > laneWidth - 8 || x < 0)) scroll = clampScroll(time - visibleMs * 0.1);
    });
  });

  $effect(() => {
    engine.anim.record(recording && !readOnly && !playing ? head : null);
  });

  // Al grabar, la vista sigue mostrando la pose del cabezal aunque la duración cambie con los keyframes nuevos.
  $effect(() => {
    void version;
    untrack(() => {
      if (recording && !playing) engine.anim.seek(head);
    });
  });

  // Con una propuesta en vista previa no se graba ni se edita.
  $effect(() => {
    if (!proposed) return;
    untrack(() => {
      recording = false;
      editing = null;
    });
  });

  $effect(() => {
    if (open) return;
    untrack(() => {
      aiOpen = false;
      recording = false;
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

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(value) ? value : MIN_ZOOM));
  const clampScroll = (value: number) => Math.min(maxScroll, Math.max(0, value));
  const cellId = (position: Focus) => `${uid}-${position.row}-${position.key ?? 'h'}`;
  const isCurrent = (row: Row, key: string | null) => current?.row === row.rowKey && current.key === key;
  const isTab = (row: Row, key: string | null) => tabStop?.row === row.rowKey && tabStop.key === key;

  function nameOf(row: Row): string {
    const text = row.record.type === 'text' ? engine.core.store.text(row.id) : '';
    return displayName(row.record, kindLabel(kindOf(row.record)), text);
  }

  async function focusSelection() {
    const id = selection.find((item) => rows.some((row) => row.id === item)) ?? selection[0];
    if (!id) {
      await tick();
      grid?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
      return;
    }
    if (collapsed.has(id)) collapsed = new Set([...collapsed].filter((other) => other !== id));
    pendingFocus = { row: id, key: null };
  }

  async function reveal(index: number, position: Focus) {
    if (grid) {
      const top = index * ROW_HEIGHT;
      if (top < grid.scrollTop) grid.scrollTop = top;
      else if (top + ROW_HEIGHT > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + ROW_HEIGHT - grid.clientHeight;
      scrollTop = grid.scrollTop;
    }
    const row = rows[index];
    const kf = row?.kind === 'track' && position.key ? row.keyframes.find((item) => item.key === position.key) : undefined;
    if (kf) {
      const x = toX(kf.time);
      if (x < 12 || x > laneWidth - 12) scroll = clampScroll(kf.time - visibleMs / 2);
    }
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
    head = Math.max(0, Math.min(span, Math.round(ms)));
    engine.anim.seek(head);
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
    head = 0;
    scroll = 0;
    engine.anim.stop();
    if (recording) engine.anim.seek(0);
  }

  function toggleRecord() {
    if (readOnly) return;
    recording = !recording;
    if (recording) {
      if (playing) engine.anim.pause();
      engine.anim.seek(head);
    }
  }

  function pickSpeed(value: number) {
    speed = value;
    engine.anim.setSpeed(value);
  }

  function toggleRepeat() {
    repeat = !repeat;
    engine.anim.setRepeat(repeat);
  }

  function zoomBy(factor: number, anchorX = laneWidth / 2) {
    const at = scroll + anchorX / zoom;
    zoom = clampZoom(zoom * factor);
    scroll = clampScroll(at - anchorX / zoom);
  }

  // Ctrl+rueda acerca o aleja en el puntero; la rueda horizontal (o con Mayús) desplaza el tiempo.
  const wheel = (node: HTMLElement) => {
    const onWheel = (event: WheelEvent) => {
      const left = ruler?.getBoundingClientRect().left ?? 0;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(Math.exp(-event.deltaY * 0.002), Math.max(0, event.clientX - left));
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        scroll = clampScroll(scroll + (event.deltaX || event.deltaY) / zoom);
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  };

  function timeAt(clientX: number): number {
    const left = ruler?.getBoundingClientRect().left ?? 0;
    return scroll + (clientX - left) / zoom;
  }

  function scrubStart(event: PointerEvent) {
    if (event.button !== 0) return;
    scrubbing = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setHead(timeAt(event.clientX));
  }

  function scrubMove(event: PointerEvent) {
    if (scrubbing) setHead(timeAt(event.clientX));
  }

  function scrubEnd() {
    scrubbing = false;
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

  function addAtHead(row: TrackRow) {
    if (readOnly) return;
    const key = engine.anim.keyframes.keyframeAtTime(row.id, row.prop, head);
    if (!key) {
      showToast({ message: m.timeline_add_error(), tone: 'error' });
      return;
    }
    pendingFocus = { row: row.rowKey, key };
  }

  const SETTING_FIELDS = ['duration', 'delay', 'loop'] as const;
  type SettingField = (typeof SETTING_FIELDS)[number];
  const SETTING_LABELS: Record<SettingField, { short: () => string; long: (inputs: { name: string }) => string }> = {
    duration: { short: m.timeline_duration_short, long: m.timeline_duration },
    delay: { short: m.timeline_delay_short, long: m.timeline_delay },
    loop: { short: m.timeline_loop_short, long: m.timeline_loop },
  };
  const SETTING_RANGE: Record<SettingField, [number, number]> = {
    duration: [ANIMATION_LIMITS.minDurationMs, ANIMATION_LIMITS.maxDurationMs],
    delay: [0, ANIMATION_LIMITS.maxDelayMs],
    loop: [0, ANIMATION_LIMITS.maxLoop],
  };

  // Valida el campo y escribe el ajuste; si no es válido vuelve a mostrar el valor guardado.
  function commitSetting(row: NodeRow, field: SettingField, input: HTMLInputElement) {
    const saved = row.animation?.[field];
    const value = Math.round(Number(input.value));
    const [min, max] = SETTING_RANGE[field];
    if (readOnly || !row.animation || input.value.trim() === '' || !Number.isFinite(value) || value < min || value > max) {
      if (saved !== undefined) input.value = String(saved);
      return;
    }
    input.value = String(value);
    if (value !== saved) engine.anim.keyframes.setAnimation(row.id, { [field]: value });
  }

  function onSettingKey(event: KeyboardEvent, row: NodeRow, field: SettingField) {
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSetting(row, field, input);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.value = String(row.animation?.[field] ?? '');
    }
  }

  function nudge(row: TrackRow, kf: TimelineKeyframe, direction: 1 | -1) {
    if (readOnly) return;
    const t = Math.round(Math.min(1, Math.max(0, kf.keyframe.t + direction * NUDGE)) * 10000) / 10000;
    if (t !== kf.keyframe.t) engine.anim.keyframes.moveKeyframe(row.id, row.prop, kf.key, t);
    pendingFocus = { row: row.rowKey, key: kf.key };
  }

  function remove(row: TrackRow, kf: TimelineKeyframe) {
    if (readOnly) return;
    const index = row.keyframes.indexOf(kf);
    const next = row.keyframes[index + 1] ?? row.keyframes[index - 1];
    if (!engine.anim.keyframes.deleteKeyframe(row.id, row.prop, kf.key)) return;
    pendingFocus = { row: row.rowKey, key: next?.key ?? null };
  }

  function openEditor(row: TrackRow, kf: TimelineKeyframe) {
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
    if (!position || editing || (event.target as HTMLElement).closest('input')) return;
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

  // Espacio reproduce o pausa con el foco en cualquier parte del panel salvo en un control que ya lo usa.
  function onPanelKey(event: KeyboardEvent) {
    if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, [role="dialog"]')) return;
    event.preventDefault();
    togglePlay();
  }

  function dragStart(event: PointerEvent, row: TrackRow, kf: TimelineKeyframe) {
    focus = { row: row.rowKey, key: kf.key };
    if (event.button !== 0 || readOnly || !row.animation) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag = { id: row.id, prop: row.prop, key: kf.key, startX: event.clientX, startT: kf.keyframe.t, t: kf.keyframe.t, duration: row.animation.duration, moved: false };
  }

  function dragMove(event: PointerEvent) {
    const active = drag;
    if (!active) return;
    const dx = event.clientX - active.startX;
    if (!active.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    const t = Math.min(1, Math.max(0, active.startT + dx / zoom / active.duration));
    drag = { ...active, moved: true, t: Math.round(t * 10000) / 10000 };
  }

  // Se escribe una vez, al soltar.
  function dragEnd() {
    const active = drag;
    drag = null;
    if (!active?.moved || active.t === active.startT) return;
    engine.anim.keyframes.moveKeyframe(active.id, active.prop, active.key, active.t);
    pendingFocus = { row: `${active.id}:${active.prop}`, key: active.key };
  }

  function shownTime(row: TrackRow, kf: TimelineKeyframe): number {
    if (drag && drag.key === kf.key && drag.id === row.id && drag.prop === row.prop && row.animation) return keyframeAt(row.animation, drag.t);
    return kf.time;
  }

  function nodeLabel(row: NodeRow): string {
    const label = m.timeline_node({ name: nameOf(row), count: row.count });
    return proposed?.has(row.id) ? `${label} (${m.timeline_ai_proposed()})` : label;
  }
</script>

<!-- Espacio reproduce o pausa desde cualquier parte del panel. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  aria-labelledby="{uid}-title"
  hidden={!open}
  data-own-keys
  onkeydown={onPanelKey}
  class="relative flex h-64 shrink-0 flex-col border-t border-petrol bg-surface-1 text-sm"
  data-testid="timeline"
>
  {#if aiAnimation && aiOpen}
    <div id="{uid}-ai" class="absolute top-10 right-2 z-20 w-80">
      <AiAnimate {engine} {projectId} {selection} onclose={() => (aiOpen = false)} />
    </div>
  {/if}
  <div class="flex items-center gap-1 px-2 py-1">
    <h2 id="{uid}-title" class="px-2 font-semibold">{m.timeline_label()}</h2>
    <ToolButton side="top" label={playing ? m.timeline_pause() : m.timeline_play()} onclick={togglePlay}>
      {#if playing}<Pause size={16} aria-hidden="true" />{:else}<Play size={16} aria-hidden="true" />{/if}
    </ToolButton>
    <ToolButton side="top" label={m.timeline_rewind()} onclick={rewind}><SkipBack size={16} aria-hidden="true" /></ToolButton>
    <ToolButton side="top" label={m.timeline_repeat()} pressed={repeat} onclick={toggleRepeat}><Repeat size={16} aria-hidden="true" /></ToolButton>
    <div role="radiogroup" aria-label={m.timeline_speed()} class="flex gap-0.5 rounded-full bg-surface-2 p-0.5">
      {#each SPEEDS as option (option)}
        <button
          type="button"
          role="radio"
          aria-checked={speed === option}
          onclick={() => pickSpeed(option)}
          class={['h-7 min-w-10 cursor-pointer rounded-full px-2 text-xs tabular', speed === option ? 'bg-petrol text-ink' : 'text-ink-muted hover:text-ink'].join(' ')}
        >
          {String(option).replace('.', ',')}×
        </button>
      {/each}
    </div>
    {#if !readOnly}
      <button
        type="button"
        aria-pressed={recording}
        onclick={toggleRecord}
        class={[
          'ml-1 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold',
          recording ? 'bg-danger text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        ].join(' ')}
        data-testid="timeline-record"
      >
        <span aria-hidden="true" class={['size-2 rounded-full', recording ? 'bg-ink' : 'bg-danger'].join(' ')}></span>
        {m.timeline_record()}
      </button>
    {/if}
    {#if aiAnimation}
      <button
        type="button"
        aria-expanded={aiOpen}
        aria-controls="{uid}-ai"
        onclick={() => (aiOpen = !aiOpen)}
        class={[
          'ml-1 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold',
          aiOpen ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        ].join(' ')}
        data-testid="timeline-ai"
      >
        <WandSparkles size={14} aria-hidden="true" />
        {m.timeline_ai_animate()}
      </button>
    {/if}
    <span class="ml-2 text-xs text-ink-muted tabular" data-testid="timeline-time">{formatTime(head)} / {formatTime(span)}</span>
    <span class="flex-1"></span>
    <ToolButton side="top" label={m.timeline_zoom_out()} onclick={() => zoomBy(1 / 1.5)}><ZoomOut size={16} aria-hidden="true" /></ToolButton>
    <ToolButton side="top" label={m.timeline_zoom_in()} onclick={() => zoomBy(1.5)}><ZoomIn size={16} aria-hidden="true" /></ToolButton>
    <ToolButton side="top" label={m.timeline_hide()} onclick={onclose}><ChevronDown size={16} aria-hidden="true" /></ToolButton>
  </div>
  <p role="status" class={recording ? 'px-4 pb-1 text-xs text-ink-muted' : 'sr-only'}>
    {recording ? m.timeline_recording({ time: formatTime(head) }) : ''}
  </p>
  <p id="{uid}-hint" class="sr-only">{m.timeline_hint()}</p>

  {#if rows.length === 0}
    <p class="px-4 py-3 text-ink-muted">{m.timeline_empty()}</p>
  {:else}
    <div {@attach wheel} class="relative flex min-h-0 flex-1 flex-col">
      <div class="flex h-7 shrink-0">
        <div class="shrink-0" style:width="{LABEL_WIDTH}px"></div>
        <div
          bind:this={ruler}
          bind:clientWidth={laneWidth}
          role="presentation"
          onpointerdown={scrubStart}
          onpointermove={scrubMove}
          onpointerup={scrubEnd}
          onpointercancel={scrubEnd}
          class="relative min-w-0 flex-1 cursor-pointer touch-none overflow-hidden select-none"
          data-testid="timeline-ruler"
        >
          {#each ticks as ms (ms)}
            <span aria-hidden="true" class="absolute top-0 h-full border-l border-petrol pl-1 text-[11px] whitespace-nowrap text-ink-muted tabular" style:left="{toX(ms)}px">
              {formatTime(ms)}
            </span>
          {/each}
          <div
            role="slider"
            tabindex="0"
            aria-label={m.timeline_head()}
            aria-valuemin={0}
            aria-valuemax={Math.round(span)}
            aria-valuenow={Math.round(head)}
            aria-valuetext={formatTime(head)}
            onkeydown={onHeadKey}
            class="absolute top-0 h-full w-6 -translate-x-1/2 cursor-ew-resize outline-none focus-visible:ring-2 focus-visible:ring-coral"
            style:left="{toX(head)}px"
            data-testid="timeline-head"
          >
            <span aria-hidden="true" class="absolute top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-b-full bg-coral"></span>
          </div>
        </div>
      </div>

      <div
        bind:this={grid}
        bind:clientHeight={gridHeight}
        role="grid"
        tabindex="-1"
        aria-labelledby="{uid}-title"
        aria-describedby="{uid}-hint"
        aria-rowcount={rows.length}
        onkeydown={onGridKey}
        onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
        class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        data-testid="timeline-grid"
      >
        <div class="relative" style:height="{rows.length * ROW_HEIGHT}px">
          {#each shown as row, i (row.rowKey)}
            {@const header = { row: row.rowKey, key: null }}
            <div
              role="row"
              aria-rowindex={range.start + i + 1}
              class={['absolute inset-x-0 flex', row.kind === 'node' ? 'bg-surface-1' : ''].join(' ')}
              style:top="{(range.start + i) * ROW_HEIGHT}px"
              style:height="{ROW_HEIGHT}px"
            >
              {#if row.kind === 'node'}
                <!-- El teclado de las celdas lo lleva la rejilla. -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  id={cellId(header)}
                  role="rowheader"
                  tabindex={isTab(row, null) ? 0 : -1}
                  aria-label={nodeLabel(row)}
                  aria-expanded={row.expanded}
                  aria-selected={selection.includes(row.id)}
                  onfocus={() => (focus = header)}
                  onclick={() => {
                    focus = header;
                    engine.commands.select([row.id]);
                  }}
                  style:width="{LABEL_WIDTH}px"
                  class={[
                    'flex shrink-0 cursor-pointer items-center gap-1 rounded-[6px] pr-2 pl-1 outline-none select-none',
                    'focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-inset',
                    selection.includes(row.id) ? 'bg-petrol text-ink' : 'text-ink hover:bg-surface-2',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    title={row.expanded ? m.timeline_collapse({ name: nameOf(row) }) : m.timeline_expand({ name: nameOf(row) })}
                    onclick={(event) => {
                      event.stopPropagation();
                      toggle(row.id, !row.expanded);
                    }}
                    class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-surface-2"
                  >
                    <ChevronRight size={14} class={row.expanded ? 'rotate-90' : ''} />
                  </button>
                  <span class="min-w-0 flex-1 truncate font-medium">{nameOf(row)}</span>
                  {#if row.animation}
                    {@const node = row}
                    {@const settings = row.animation}
                    <!-- Los campos llevan su propio teclado; el clic no selecciona el nodo. -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="flex shrink-0 items-center gap-1" onclick={(event) => event.stopPropagation()}>
                      {#each SETTING_FIELDS as field (field)}
                        {@const long = SETTING_LABELS[field].long({ name: nameOf(node) })}
                        <label class="flex items-center gap-0.5 text-[11px] text-ink-muted" title={long}>
                          <span aria-hidden="true">{SETTING_LABELS[field].short()}</span>
                          <span class="sr-only">{long}</span>
                          <input
                            type="number"
                            inputmode="numeric"
                            tabindex={isTab(row, null) ? 0 : -1}
                            value={settings[field]}
                            min={SETTING_RANGE[field][0]}
                            max={SETTING_RANGE[field][1]}
                            step={field === 'loop' ? 1 : 10}
                            disabled={readOnly}
                            onchange={(event) => commitSetting(node, field, event.currentTarget)}
                            onkeydown={(event) => onSettingKey(event, node, field)}
                            class={[
                              'h-6 rounded-[6px] bg-surface-2 px-1 text-xs text-ink tabular outline-none',
                              'invalid:ring-1 invalid:ring-danger focus-visible:ring-2 focus-visible:ring-coral',
                              field === 'loop' ? 'w-10' : 'w-14',
                            ].join(' ')}
                            data-testid="timeline-{field}"
                          />
                        </label>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div role="none" class="relative min-w-0 flex-1 overflow-hidden">
                  {#each row.marks as ms (ms)}
                    <span
                      aria-hidden="true"
                      class="absolute top-1/2 size-2 -translate-1/2 rotate-45 bg-ink-muted"
                      style:left="{toX(ms)}px"
                      style:background-color={proposed?.has(row.id) ? AI_PREVIEW_COLOR : undefined}
                    ></span>
                  {/each}
                </div>
              {:else}
                {@const track = row}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  id={cellId(header)}
                  role="rowheader"
                  tabindex={isTab(row, null) ? 0 : -1}
                  aria-label={propLabel(track.prop)}
                  onfocus={() => (focus = header)}
                  onclick={() => (focus = header)}
                  style:width="{LABEL_WIDTH}px"
                  class={[
                    'flex shrink-0 cursor-default items-center gap-1 rounded-[6px] pr-1 pl-8 text-ink-muted outline-none select-none',
                    'focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-inset',
                  ].join(' ')}
                >
                  <span class="min-w-0 flex-1 truncate">{propLabel(track.prop)}</span>
                  {#if !readOnly}
                    <button
                      type="button"
                      tabindex="-1"
                      aria-hidden="true"
                      title={m.timeline_add({ track: propLabel(track.prop), time: formatTime(head) })}
                      onclick={(event) => {
                        event.stopPropagation();
                        addAtHead(track);
                      }}
                      class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-surface-2 hover:text-ink"
                    >
                      <Plus size={14} />
                    </button>
                  {/if}
                </div>
                <div
                  role="none"
                  onpointerdown={(event) => {
                    if (event.target === event.currentTarget) scrubStart(event);
                  }}
                  onpointermove={scrubMove}
                  onpointerup={scrubEnd}
                  class="relative min-w-0 flex-1 touch-none overflow-hidden border-b border-surface-2"
                >
                  {#each track.keyframes as kf (kf.key)}
                    {@const position = { row: track.rowKey, key: kf.key }}
                    {@const active = isCurrent(track, kf.key)}
                    <div
                      id={cellId(position)}
                      role="gridcell"
                      tabindex={isTab(track, kf.key) ? 0 : -1}
                      aria-selected={active}
                      aria-label={m.timeline_keyframe({ track: propLabel(track.prop), time: formatTime(kf.time), value: formatValue(track.prop, kf.keyframe.v) })}
                      onfocus={() => (focus = position)}
                      onpointerdown={(event) => dragStart(event, track, kf)}
                      onpointermove={dragMove}
                      onpointerup={dragEnd}
                      onpointercancel={() => (drag = null)}
                      ondblclick={() => openEditor(track, kf)}
                      style:left="{toX(shownTime(track, kf))}px"
                      class={[
                        'absolute top-0.5 grid size-6 -translate-x-1/2 cursor-grab place-items-center rounded-[4px] outline-none',
                        'focus-visible:ring-2 focus-visible:ring-coral',
                        readOnly ? 'cursor-pointer' : '',
                      ].join(' ')}
                      data-testid="keyframe"
                    >
                      <span
                        aria-hidden="true"
                        class={['size-2.5 rotate-45', active ? 'bg-coral' : 'bg-ink'].join(' ')}
                        style:background-color={proposed?.has(track.id) && !active ? AI_PREVIEW_COLOR : undefined}
                        data-proposed={proposed?.has(track.id) ? '' : undefined}
                      ></span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
      <span
        aria-hidden="true"
        class="pointer-events-none absolute top-0 bottom-0 w-px bg-coral"
        style:left="{LABEL_WIDTH + toX(head)}px"
        hidden={toX(head) < 0 || toX(head) > laneWidth}
      ></span>
    </div>
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
