<script lang="ts">
  import { Popover } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { VirtualAnchor } from './anchor.ts';

  type Props = {
    open?: boolean;
    // Nombre accesible del contenido (role="dialog").
    label: string;
    trigger?: Snippet<[Record<string, unknown>]>;
    // Ancla distinta del disparador: un punto o una caja del lienzo, otro elemento.
    anchor?: VirtualAnchor | HTMLElement | null;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    testid?: string;
    class?: string;
    // 'touch': el disparador mide 44 px de alto (hojas y barras para el dedo).
    density?: 'default' | 'touch';
    onOpenChange?: (open: boolean) => void;
    children: Snippet;
  };

  let {
    open = $bindable(false),
    label,
    trigger,
    anchor = null,
    side = 'bottom',
    align = 'start',
    sideOffset = 6,
    testid,
    class: className = '',
    density = 'default',
    onOpenChange,
    children,
  }: Props = $props();
</script>

<Popover.Root bind:open onOpenChange={(value) => onOpenChange?.(value)}>
  {#if trigger}
    <Popover.Trigger>
      {#snippet child({ props })}
        {@render trigger(density === 'touch' ? { ...props, 'data-density': 'touch' } : props)}
      {/snippet}
    </Popover.Trigger>
  {/if}
  <Popover.Portal>
    <!-- data-own-keys: Esc cierra solo el popover y las flechas del área de color no mueven la selección del lienzo. -->
    <Popover.Content
      customAnchor={anchor}
      {side}
      {align}
      {sideOffset}
      collisionPadding={8}
      avoidCollisions
      trapFocus
      role="dialog"
      aria-label={label}
      data-testid={testid}
      data-floating=""
      data-own-keys=""
      class={[
        'z-(--z-popover) max-h-(--bits-popover-content-available-height) overflow-x-hidden overflow-y-auto scroll-thin rounded-panel border border-edge/40 bg-surface-2 p-3 text-ui text-ink shadow-float outline-none',
        className,
      ].join(' ')}
    >
      {@render children()}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
