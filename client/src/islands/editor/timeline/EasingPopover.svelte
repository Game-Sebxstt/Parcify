<script lang="ts" module>
  import { m } from '../../../paraglide/messages.js';
  import { EASINGS } from '../../../shared/document/schema.js';

  export type EasingPreset = (typeof EASINGS)[number];

  const LABELS: Record<EasingPreset, () => string> = {
    linear: m.timeline_easing_linear,
    easeIn: m.timeline_easing_easeIn,
    easeOut: m.timeline_easing_easeOut,
    easeInOut: m.timeline_easing_easeInOut,
    easeOutBack: m.timeline_easing_easeOutBack,
    step: m.timeline_easing_step,
  };

  export const easingLabel = (preset: EasingPreset) => LABELS[preset]();
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import { virtualAnchor } from '../../../ui/anchor.ts';
  import Popover from '../../../ui/Popover.svelte';
  import type { Keyframe } from '../../../shared/document/schema.js';
  import EasingCurve from './EasingCurve.svelte';

  type Props = {
    // Caja del tramo en la ventana; null = cerrado.
    at: DOMRect | null;
    easing: Keyframe['e'];
    readOnly: boolean;
    onpick: (easing: EasingPreset) => void;
    onclose: () => void;
  };

  let { at, easing, readOnly, onpick, onclose }: Props = $props();

  // La curva enseña la opción bajo el puntero o con el foco; si no, la del tramo.
  let hovered = $state<EasingPreset | null>(null);
  const anchor = $derived(at ? virtualAnchor(() => at) : null);
  const shown = $derived<Keyframe['e']>(hovered ?? easing);
</script>

<Popover
  open={at !== null}
  {anchor}
  label={m.timeline_easing_title()}
  side="top"
  align="center"
  class="w-auto"
  testid="easing-popover"
  onOpenChange={(open) => {
    if (open) return;
    hovered = null;
    onclose();
  }}
>
  <div class="flex gap-3">
    <div role="radiogroup" aria-label={m.timeline_editor_easing()} class="flex w-52 flex-col gap-0.5">
      {#each EASINGS as preset (preset)}
        {@const checked = easing === preset}
        <button
          type="button"
          role="radio"
          aria-checked={checked}
          disabled={readOnly}
          onclick={() => onpick(preset)}
          onpointerenter={() => (hovered = preset)}
          onpointerleave={() => (hovered = null)}
          onfocus={() => (hovered = preset)}
          onblur={() => (hovered = null)}
          class={[
            'flex h-8 cursor-pointer items-center gap-2 rounded-control px-2 text-left text-ui outline-none pointer-coarse:h-11',
            'hover:bg-petrol focus-visible:bg-petrol disabled:cursor-not-allowed disabled:text-ink-muted',
          ]}
        >
          <span aria-hidden="true" class="inline-flex size-4 shrink-0 items-center justify-center text-coral">
            {#if checked}<Check size={14} />{/if}
          </span>
          <span class="min-w-0 flex-1 truncate">{easingLabel(preset)}</span>
        </button>
      {/each}
      {#if typeof easing !== 'string'}
        <p class="px-2 pt-1 text-2xs text-ink-muted">{m.timeline_easing_custom_hint()}</p>
      {/if}
    </div>
    <EasingCurve easing={shown} label={m.timeline_editor_curve()} width={176} height={120} />
  </div>
</Popover>
