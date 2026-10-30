<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { pointAnchor } from '../../../ui/anchor.ts';
  import Popover from '../../../ui/Popover.svelte';
  import ScrubInput from '../../../ui/ScrubInput.svelte';

  type Props = {
    // Punto de la ventana donde se abrió el menú; null = cerrado.
    at: { x: number; y: number } | null;
    min: number;
    max: number;
    onapply: (factor: number) => void;
    onclose: () => void;
  };

  let { at, min, max, onapply, onclose }: Props = $props();

  let factor = $state(1);
  const anchor = $derived(at ? pointAnchor(at.x, at.y) : null);

  function apply() {
    const value = Math.min(max, Math.max(min, Number(factor) || 1));
    onapply(value);
  }
</script>

<Popover
  open={at !== null}
  {anchor}
  label={m.timeline_stretch_title()}
  side="top"
  align="start"
  class="w-64"
  testid="stretch-popover"
  onOpenChange={(open) => {
    if (open) return;
    factor = 1;
    onclose();
  }}
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      apply();
    }}
    class="flex flex-col gap-3"
  >
    <p class="text-xs text-ink-muted">{m.timeline_stretch_hint()}</p>
    <ScrubInput
      value={factor}
      label={m.timeline_stretch_factor()}
      prefix="×"
      step={0.05}
      {min}
      {max}
      decimals={2}
      testid="stretch-factor"
      oncommit={(next) => (factor = next)}
    />
    <div class="flex justify-end gap-2">
      <button type="button" onclick={onclose} class="h-8 cursor-pointer rounded-full px-3 hover:bg-petrol pointer-coarse:h-11">{m.common_cancel()}</button>
      <button type="submit" class="h-8 cursor-pointer rounded-full bg-coral px-3 font-semibold text-coral-ink hover:bg-coral-hover pointer-coarse:h-11">
        {m.timeline_stretch_apply()}
      </button>
    </div>
  </form>
</Popover>
