<script lang="ts">
  import { untrack } from 'svelte';
  import { EASING_CURVES } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import { EASINGS, type AnimProp, type Keyframe } from '../../../shared/document/schema.js';
  import EasingCurve from './EasingCurve.svelte';
  import { fromDisplay, propLabel, toDisplay, unitOf } from './model.ts';

  type Preset = (typeof EASINGS)[number];
  type Props = {
    prop: AnimProp;
    keyframe: Keyframe;
    delay: number;
    duration: number;
    readOnly: boolean;
    onsave: (next: Keyframe) => void;
    ondelete: () => void;
    onclose: () => void;
    // El foco ha salido del diálogo (Tab o Mayús+Tab): se cierra sin devolverlo.
    onleave: () => void;
  };

  let { prop, keyframe, delay, duration, readOnly, onsave, ondelete, onclose, onleave }: Props = $props();

  const uid = $props.id();
  const EASING_LABELS: Record<Preset | 'custom', () => string> = {
    linear: m.timeline_easing_linear,
    easeIn: m.timeline_easing_easeIn,
    easeOut: m.timeline_easing_easeOut,
    easeInOut: m.timeline_easing_easeInOut,
    easeOutBack: m.timeline_easing_easeOutBack,
    step: m.timeline_easing_step,
    custom: m.timeline_easing_custom,
  };
  const POINT_LABELS = ['X1', 'Y1', 'X2', 'Y2'] as const;

  // Copia local: se escribe al guardar.
  const start = untrack(() => ({ keyframe, delay, duration, prop }));
  const initial = start.keyframe;
  const color = typeof initial.v === 'string';
  let time = $state(Math.round(start.delay + initial.t * start.duration));
  let numeric = $state(typeof initial.v === 'number' ? toDisplay(start.prop, initial.v) : 0);
  let hex = $state(typeof initial.v === 'string' ? initial.v.slice(0, 7) : '#000000');
  let preset = $state<Preset | 'custom'>(typeof initial.e === 'string' ? initial.e : 'custom');
  const curveOf = (easing: Keyframe['e']): [number, number, number, number] => {
    if (typeof easing !== 'string') return [...easing];
    const [x1, y1, x2, y2] = easing in EASING_CURVES ? EASING_CURVES[easing as keyof typeof EASING_CURVES] : [0.25, 0.1, 0.25, 1];
    return [x1, y1, x2, y2];
  };
  let points = $state(curveOf(initial.e));
  let root = $state<HTMLElement | null>(null);

  const easing = $derived<Keyframe['e']>(preset === 'custom' ? clampPoints(points) : preset);

  function clampPoints([x1, y1, x2, y2]: readonly number[]): [number, number, number, number] {
    const unit = (v: number | undefined) => Math.min(1, Math.max(0, Number(v) || 0));
    const free = (v: number | undefined) => Math.min(10, Math.max(-10, Number(v) || 0));
    return [unit(x1), free(y1), unit(x2), free(y2)];
  }

  function pickPreset(next: Preset | 'custom') {
    // Al pasar a personalizada se parte de la curva del preset que había.
    if (next === 'custom' && preset !== 'custom' && preset in EASING_CURVES) points = curveOf(preset);
    preset = next;
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (readOnly) return;
    const t = Math.round(Math.min(1, Math.max(0, (Number(time) - delay) / duration)) * 10000) / 10000;
    const alpha = typeof initial.v === 'string' && initial.v.length === 9 ? initial.v.slice(7) : 'FF';
    const v = color ? `${hex.toUpperCase()}${alpha}` : fromDisplay(prop, Number(numeric) || 0);
    onsave({ t, v, e: easing });
  }

  const focusFirst = (node: HTMLElement) => {
    node.querySelector<HTMLElement>('input, select')?.focus();
  };
</script>

<svelte:window
  onpointerdown={(event) => {
    if (root && !root.contains(event.target as Node)) onclose();
  }}
/>

<div
  bind:this={root}
  {@attach focusFirst}
  role="dialog"
  aria-labelledby="{uid}-title"
  tabindex="-1"
  onfocusout={(event) => {
    // Sin destino es que la ventana perdió el foco: se deja abierto para no perder lo escrito.
    const next = event.relatedTarget as Node | null;
    if (next && root && !root.contains(next)) onleave();
  }}
  onkeydown={(event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    }
  }}
  class="w-72 rounded-panel bg-surface-2 p-3 text-sm text-ink shadow-float"
  data-testid="keyframe-editor"
>
  <h3 id="{uid}-title" class="mb-3 font-semibold">{m.timeline_editor_title({ track: propLabel(prop) })}</h3>
  <form onsubmit={save} class="flex flex-col gap-3">
    <fieldset disabled={readOnly} class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-ink-muted">{m.timeline_editor_time()}</span>
        <input type="number" bind:value={time} min={delay} max={delay + duration} step="10" class="h-8 rounded-[6px] bg-surface-1 px-2 tabular" />
      </label>
      {#if color}
        <label class="flex items-center justify-between gap-2">
          <span class="text-xs text-ink-muted">{m.timeline_editor_color()}</span>
          <input type="color" bind:value={hex} class="h-8 w-14 cursor-pointer rounded-[6px] bg-surface-1" />
        </label>
      {:else}
        <label class="flex flex-col gap-1">
          <span class="text-xs text-ink-muted">{m.timeline_editor_value({ unit: unitOf(prop) })}</span>
          <input
            type="number"
            bind:value={numeric}
            step={prop === 'scale' ? 0.05 : 1}
            min={prop === 'opacity' ? 0 : undefined}
            max={prop === 'opacity' ? 100 : undefined}
            class="h-8 rounded-[6px] bg-surface-1 px-2 tabular"
          />
        </label>
      {/if}
      <div class="flex gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <label class="flex flex-col gap-1">
            <span class="text-xs text-ink-muted">{m.timeline_editor_easing()}</span>
            <select
              value={preset}
              onchange={(event) => pickPreset(event.currentTarget.value as Preset | 'custom')}
              class="h-8 cursor-pointer rounded-[6px] bg-surface-1 px-1.5"
            >
              {#each [...EASINGS, 'custom' as const] as option (option)}
                <option value={option}>{EASING_LABELS[option]()}</option>
              {/each}
            </select>
          </label>
          {#if preset === 'custom'}
            <fieldset class="grid grid-cols-2 gap-1.5">
              <legend class="mb-1 text-xs text-ink-muted">{m.timeline_editor_points()}</legend>
              {#each POINT_LABELS as label, i (label)}
                <label class="flex items-center gap-1 text-xs">
                  <span class="w-5 text-ink-muted">{label}</span>
                  <input
                    type="number"
                    bind:value={points[i]}
                    step="0.05"
                    min={i % 2 === 0 ? 0 : -10}
                    max={i % 2 === 0 ? 1 : 10}
                    class="h-7 w-full min-w-0 rounded-[6px] bg-surface-1 px-1.5 tabular"
                  />
                </label>
              {/each}
            </fieldset>
          {/if}
        </div>
        <EasingCurve {easing} label={m.timeline_editor_curve()} />
      </div>
    </fieldset>
    <div class="flex items-center gap-2">
      {#if !readOnly}
        <button type="button" onclick={ondelete} class="h-8 cursor-pointer rounded-full px-3 font-semibold text-danger hover:bg-petrol">
          {m.timeline_editor_delete()}
        </button>
      {/if}
      <span class="flex-1"></span>
      <button type="button" onclick={onclose} class="h-8 cursor-pointer rounded-full px-3 hover:bg-petrol">{m.common_cancel()}</button>
      {#if !readOnly}
        <button type="submit" class="h-8 cursor-pointer rounded-full bg-coral px-3 font-semibold text-coral-ink hover:bg-coral-hover">{m.common_save()}</button>
      {/if}
    </div>
  </form>
</div>
