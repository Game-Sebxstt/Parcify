<script lang="ts" module>
  import type { Component } from 'svelte';

  // merge: la confirmación sigue a otra de ↑/↓ de hace menos de 500 ms y va en el mismo paso de deshacer.
  export type ScrubCommit = { merge: boolean };
  export type ScrubSnap = (value: number, mods: { shift: boolean; ctrl: boolean }) => number;
</script>

<script lang="ts">
  import { m } from '../paraglide/messages.js';
  import { evaluate } from './expression.ts';

  type Props = {
    value: number;
    // Nombre accesible del campo.
    label: string;
    // Texto o icono del asa de arrastre («X», «An»). Sin ninguno de los dos, el campo no tiene asa.
    prefix?: string;
    icon?: Component<{ size?: number; class?: string }>;
    unit?: string;
    step?: number;
    min?: number;
    max?: number;
    decimals?: number;
    // Varios elementos con valores distintos: el campo se queda vacío con «Mixto».
    mixed?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    // Imán opcional durante el arrastre (Rotación usa snapRotation).
    snap?: ScrubSnap;
    testid?: string;
    class?: string;
    // Solo vista previa: durante el arrastre y mientras se escribe un valor válido.
    oninput?: (value: number) => void;
    oncommit?: (value: number, meta: ScrubCommit) => void;
    oncancel?: () => void;
  };

  let {
    value,
    label,
    prefix,
    icon: Icon,
    unit,
    step = 1,
    min = -Infinity,
    max = Infinity,
    decimals = 2,
    mixed = false,
    disabled = false,
    readonly = false,
    snap,
    testid,
    class: className = '',
    oninput,
    oncommit,
    oncancel,
  }: Props = $props();

  const MERGE_MS = 500;
  const INVALID_MS = 1000;

  let input = $state<HTMLInputElement | null>(null);
  let draft = $state<string | null>(null);
  let scrubbing = $state(false);
  let scrubValue = $state(0);
  let invalid = $state(false);

  // Último valor de vista previa sin confirmar ni descartar, y el valor que había antes de ella: quien use el campo
  // puede reflejar la vista previa en `value`, y «+15» se sigue sumando al valor de partida.
  let pending: number | null = null;
  let origin: number | null = null;
  let drag: { id: number; startX: number; lastX: number; raw: number; slop: number; active: boolean } | null = null;
  let lastArrowAt = -Infinity;
  let selectOnMouseUp = false;
  let invalidTimer: ReturnType<typeof setTimeout> | undefined;

  const interactive = $derived(!disabled && !readonly);
  const hasHandle = $derived(Boolean(prefix || Icon));
  const formatter = $derived(new Intl.NumberFormat('es', { maximumFractionDigits: decimals, useGrouping: false }));
  const format = (n: number) => formatter.format(Object.is(n, -0) ? 0 : n);
  const shown = $derived(scrubbing ? format(scrubValue) : (draft ?? (mixed ? '' : format(value))));
  const valueText = $derived(mixed ? m.ui_mixed() : `${format(value)}${unit ?? ''}`);

  function normalize(n: number): number {
    const factor = 10 ** decimals;
    return Math.round(Math.min(max, Math.max(min, n)) * factor) / factor;
  }

  const base = () => origin ?? value;

  function preview(next: number) {
    if (pending === null) origin = value;
    pending = next;
    oninput?.(next);
  }

  // Las flechas vuelven a abrir la ventana de fusión después de confirmar; cualquier otra confirmación la cierra.
  function commit(next: number, merge = false) {
    pending = null;
    origin = null;
    draft = null;
    lastArrowAt = -Infinity;
    oncommit?.(next, { merge });
  }

  function cancel() {
    const previewed = pending !== null;
    pending = null;
    origin = null;
    draft = null;
    if (previewed) oncancel?.();
  }

  function flagInvalid() {
    invalid = true;
    clearTimeout(invalidTimer);
    invalidTimer = setTimeout(() => (invalid = false), INVALID_MS);
  }

  // Enter o perder el foco. Escribir el mismo valor no deja un paso de deshacer vacío.
  function confirmDraft(fromEnter: boolean) {
    if (draft === null) {
      if (pending !== null) commit(pending);
      return;
    }
    const parsed = evaluate(draft, base());
    if (parsed === null) {
      // Vuelve al valor anterior; con Enter el borde rojo avisa durante 1 s.
      if (fromEnter) flagInvalid();
      cancel();
      return;
    }
    const next = normalize(parsed);
    if (next === base() && !mixed) cancel();
    else commit(next);
  }

  function onInput(event: Event & { currentTarget: HTMLInputElement }) {
    draft = event.currentTarget.value;
    const parsed = evaluate(draft, base());
    if (parsed !== null) preview(normalize(parsed));
    else if (pending !== null) {
      // Un borrador que deja de ser válido retira la vista previa anterior del lienzo.
      pending = null;
      origin = null;
      oncancel?.();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!interactive) return;
      confirmDraft(true);
      if (!invalid) input?.select();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      input?.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (!interactive) return;
      const from = draft !== null ? (evaluate(draft, base()) ?? value) : value;
      const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const next = normalize(from + (event.key === 'ArrowUp' ? 1 : -1) * step * factor);
      const now = performance.now();
      const merge = now - lastArrowAt < MERGE_MS;
      commit(next, merge);
      lastArrowAt = now;
    }
  }

  function onPointerDown() {
    selectOnMouseUp = document.activeElement !== input;
  }

  function onMouseUp(event: MouseEvent) {
    // Al entrar con un clic se selecciona todo el valor, como en Figma; el mouseup quitaría la selección.
    if (selectOnMouseUp) event.preventDefault();
    selectOnMouseUp = false;
  }

  function startScrub(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!interactive || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    if (draft !== null) confirmDraft(false);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Un puntero ya inactivo no se puede capturar; el arrastre sigue igual mientras no salga del asa.
    }
    const slop = event.pointerType === 'mouse' ? 2 : 6;
    drag = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, raw: value, slop, active: false };
  }

  function moveScrub(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.abs(event.clientX - drag.startX) < drag.slop) return;
      drag.active = true;
      drag.lastX = event.clientX;
      scrubValue = normalize(drag.raw);
      scrubbing = true;
      return;
    }
    const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    drag.raw = Math.min(max, Math.max(min, drag.raw + (event.clientX - drag.lastX) * step * factor));
    drag.lastX = event.clientX;
    const snapped = snap ? snap(drag.raw, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }) : drag.raw;
    const next = normalize(snapped);
    if (next !== scrubValue) {
      scrubValue = next;
      preview(next);
    }
  }

  function endScrub(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!drag || event.pointerId !== drag.id) return;
    const active = drag.active;
    drag = null;
    scrubbing = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // Un toque o un clic sin arrastre en el asa lleva al campo.
    if (!active) input?.focus();
    else if (pending !== null) commit(pending);
  }

  function cancelScrub() {
    drag = null;
    scrubbing = false;
    cancel();
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (!drag || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelScrub();
  }

  // Al desmontarse (panel plegado, hoja cerrada) se confirma lo que estuviera en vista previa, como al perder el foco.
  $effect(() => () => {
    clearTimeout(invalidTimer);
    if (pending === null) return;
    const last = pending;
    pending = null;
    origin = null;
    oncommit?.(last, { merge: false });
  });
</script>

<svelte:window onkeydowncapture={onWindowKeydown} />

<div
  class={[
    'relative flex h-6 min-w-0 items-center rounded-control border bg-surface-2 text-xs text-ink',
    'focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-coral',
    invalid ? 'border-danger' : 'border-transparent',
    interactive && !invalid && 'hover:border-edge/60',
    disabled && 'opacity-40',
    className,
  ]}
>
  {#if hasHandle}
    <span
      aria-hidden="true"
      class={[
        'flex h-full w-5 shrink-0 touch-none items-center justify-center text-2xs text-ink-muted select-none',
        interactive && 'cursor-ew-resize',
      ]}
      onpointerdown={startScrub}
      onpointermove={moveScrub}
      onpointerup={endScrub}
      onpointercancel={cancelScrub}
    >
      {#if Icon}<Icon size={12} />{:else}{prefix}{/if}
    </span>
  {/if}
  <input
    bind:this={input}
    type="text"
    inputmode="decimal"
    role="spinbutton"
    autocomplete="off"
    spellcheck="false"
    aria-label={label}
    aria-valuenow={mixed ? undefined : value}
    aria-valuemin={Number.isFinite(min) ? min : undefined}
    aria-valuemax={Number.isFinite(max) ? max : undefined}
    aria-valuetext={valueText}
    aria-invalid={invalid || undefined}
    aria-readonly={readonly || undefined}
    data-testid={testid}
    placeholder={mixed ? m.ui_mixed() : undefined}
    value={shown}
    {disabled}
    {readonly}
    class={['h-full min-w-0 flex-1 bg-transparent tabular outline-none placeholder:text-ink-muted', hasHandle ? 'pr-1.5' : 'px-1.5']}
    oninput={onInput}
    onkeydown={onKeydown}
    onfocus={() => input?.select()}
    onblur={() => {
      confirmDraft(false);
      lastArrowAt = -Infinity;
    }}
    onpointerdown={onPointerDown}
    onmouseup={onMouseUp}
  />
  {#if unit}
    <span aria-hidden="true" class="shrink-0 pr-1.5 text-ink-muted select-none">{unit}</span>
  {/if}
</div>
