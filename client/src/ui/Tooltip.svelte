<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';

  type Props = {
    text: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    children: Snippet<[Record<string, unknown>]>;
  };

  let { text, side = 'top', children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={400}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        {@render children(props)}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        {side}
        sideOffset={6}
        class="z-50 rounded-[6px] bg-surface-2 px-2.5 py-1.5 text-xs text-ink shadow-float"
      >
        {text}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
