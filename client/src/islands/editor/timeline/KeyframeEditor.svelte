<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { EASING_CURVES } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import { EASINGS, type AnimProp, type Keyframe } from '../../../shared/document/schema.js';
  import ColorPicker from '../../../ui/ColorPicker.svelte';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import { touchDensity } from '../../../ui/pointer.svelte.ts';
  import Select from '../../../ui/Select.svelte';
  import EasingCurve from './EasingCurve.svelte';
  import { fromDisplay, propLabel, stepOf, toDisplay, unitOf } from './model.ts';

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
  const EASING_ITEMS = [...EASINGS, 'custom' as const].map((value) => ({ value, label: EASING_LABELS[value]() }));
  const POINT_LABELS = ['X1', 'Y1', 'X2', 'Y2'] as const;

  // Copia local: se escribe al guardar.
  const start = untrack(() => ({ keyframe, delay, duration, prop }));
  const initial = start.keyframe;
  const isColor = typeof initial.v === 'string';
  let time = $state(Math.round(start.delay + initial.t * start.duration));
  let numeric = $state(typeof initial.v === 'number' ? toDisplay(start.prop, initial.v) : 0);
  // Los colores de las pistas van en #RRGGBBAA; uno sin alfa se completa opaco.
  let color = $state(typeof initial.v === 'string' ? (initial.v.length === 7 ? `${initial.v}FF` : initial.v).toUpperCase() : '#000000FF');
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

  function pickPreset(next: string) {
    const value = next as Preset | 'custom';
    // Al pasar a personalizada se parte de la curva del preset que había.
    if (value === 'custom' && preset !== 'custom' && preset in EASING_CURVES) points = curveOf(preset);
    preset = value;
  }

  function save() {
    if (readOnly) return;
    const t = Math.round(Math.min(1, Math.max(0, (Number(time) - delay) / duration)) * 10000) / 10000;
    const v = isColor ? color.toUpperCase() : fromDisplay(prop, Number(numeric) || 0);
    onsave({ t, v, e: easing });
  }

  // Enter en un campo confirma su valor (lo hace el propio campo) y guarda, salvo que el valor no fuera válido.
  async function saveFromField() {
    await tick();
    if (root?.querySelector('[aria-invalid="true"]')) return;
    save();
  }

  const focusFirst = (node: HTMLElement) => {
    node.querySelector<HTMLElement>('input, button')?.focus();
  };

  // Las listas y el selector de color salen por un portal: tocarlos no es salir del editor.
  const inside = (target: EventTarget | null) =>
    target instanceof Node && (!!root?.contains(target) || (target instanceof Element && !!target.closest('[data-floating]')));
</script>

<svelte:window
  onpointerdown={(event) => {
    if (root && !inside(event.target)) onclose();
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
    if (next && !inside(next)) onleave();
  }}
  onkeydown={(event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    } else if (event.key === 'Enter' && (event.target as HTMLElement).getAttribute('role') === 'spinbutton') {
      void saveFromField();
    }
  }}
  class="w-72 rounded-panel border border-edge/40 bg-surface-2 p-3 text-sm text-ink shadow-float"
  data-touch-density={touchDensity()}
  data-testid="keyframe-editor"
>
  <h3 id="{uid}-title" class="mb-3 font-semibold">{m.timeline_editor_title({ track: propLabel(prop) })}</h3>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      save();
    }}
    class="flex flex-col gap-3"
  >
    <fieldset disabled={readOnly} class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <span aria-hidden="true" class="text-xs text-ink-muted">{m.timeline_editor_time()}</span>
        <ScrubInput
          value={time}
          label={m.timeline_editor_time()}
          min={delay}
          max={delay + duration}
          step={10}
          decimals={0}
          readonly={readOnly}
          oncommit={(next) => (time = next)}
        />
      </div>
      {#if isColor}
        <div class="flex items-center justify-between gap-2">
          <span aria-hidden="true" class="text-xs text-ink-muted">{m.timeline_editor_color()}</span>
          <ColorPicker value={color} label={m.timeline_editor_color()} side="top" swatchSize={24} disabled={readOnly} oncommit={(next) => (color = next)} />
        </div>
      {:else}
        <div class="flex flex-col gap-1">
          <span aria-hidden="true" class="text-xs text-ink-muted">{m.timeline_editor_value({ unit: unitOf(prop) })}</span>
          <ScrubInput
            value={numeric}
            label={m.timeline_editor_value({ unit: unitOf(prop) })}
            step={stepOf(prop)}
            min={prop === 'opacity' ? 0 : undefined}
            max={prop === 'opacity' ? 100 : undefined}
            decimals={3}
            readonly={readOnly}
            oncommit={(next) => (numeric = next)}
          />
        </div>
      {/if}
      <div class="flex gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="flex flex-col gap-1">
            <span aria-hidden="true" class="text-xs text-ink-muted">{m.timeline_editor_easing()}</span>
            <Select items={EASING_ITEMS} value={preset} label={m.timeline_editor_easing()} size="md" side="top" disabled={readOnly} onValueChange={pickPreset} />
          </div>
          {#if preset === 'custom'}
            <div role="group" aria-labelledby="{uid}-points" class="grid grid-cols-2 gap-1.5">
              <span id="{uid}-points" class="col-span-2 text-xs text-ink-muted">{m.timeline_editor_points()}</span>
              {#each POINT_LABELS as label, i (label)}
                <ScrubInput
                  value={points[i] ?? 0}
                  {label}
                  prefix={label}
                  step={0.01}
                  min={i % 2 === 0 ? 0 : -10}
                  max={i % 2 === 0 ? 1 : 10}
                  readonly={readOnly}
                  oncommit={(next) => (points[i] = next)}
                />
              {/each}
            </div>
          {/if}
        </div>
        <EasingCurve {easing} label={m.timeline_editor_curve()} />
      </div>
    </fieldset>
    <div class="flex items-center gap-2">
      {#if !readOnly}
        <button type="button" onclick={ondelete} class="h-8 cursor-pointer rounded-full px-3 font-semibold text-danger hover:bg-petrol sheet:h-11">
          {m.timeline_editor_delete()}
        </button>
      {/if}
      <span class="flex-1"></span>
      <button type="button" onclick={onclose} class="h-8 cursor-pointer rounded-full px-3 hover:bg-petrol sheet:h-11">{m.common_cancel()}</button>
      {#if !readOnly}
        <button type="submit" class="h-8 cursor-pointer rounded-full bg-coral px-3 font-semibold text-coral-ink hover:bg-coral-hover sheet:h-11">{m.common_save()}</button>
      {/if}
    </div>
  </form>
</div>
