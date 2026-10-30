<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';

  type Props = {
    text: string;
    // Atajo que se muestra a la derecha del texto, p. ej. «R» o «Ctrl+Shift+K».
    kbd?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    // Para elementos que solo necesitan tooltip en un estado (una barra plegada que deja solo el icono).
    disabled?: boolean;
    children: Snippet<[Record<string, unknown>]>;
  };

  let { text, kbd, side = 'top', disabled = false, children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={500}>
  <Tooltip.Root {disabled}>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        {@render children(props)}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        {side}
        sideOffset={6}
        collisionPadding={8}
        role="tooltip"
        data-floating=""
        class="z-(--z-popover) flex max-w-64 items-center gap-2 rounded-control border border-edge/40 bg-surface-2 px-2 py-1 text-2xs text-ink shadow-float"
      >
        <span>{text}</span>
        {#if kbd}
          <kbd class="rounded-xs bg-petrol px-1 font-sans text-2xs text-ink tabular">{kbd}</kbd>
        {/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
