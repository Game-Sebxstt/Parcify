<script lang="ts">
  import { Dialog } from 'bits-ui';
  import XIcon from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { m } from '../paraglide/messages.js';

  type Props = {
    open?: boolean;
    title: string;
    description?: string;
    // Recibe las props que el disparador debe propagar a su botón.
    trigger?: Snippet<[Record<string, unknown>]>;
    children: Snippet;
    onOpenChange?: (open: boolean) => void;
    // lg: para contenido ancho, como la vista previa de una imagen.
    size?: 'md' | 'lg';
  };

  let { open = $bindable(false), title, description, trigger, children, onOpenChange, size = 'md' }: Props = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
  {#if trigger}
    <Dialog.Trigger>
      {#snippet child({ props })}
        {@render trigger(props)}
      {/snippet}
    </Dialog.Trigger>
  {/if}
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-ground/70" />
    <Dialog.Content
      class={[
        'fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel bg-surface-1 p-6 text-ink shadow-float',
        size === 'lg' ? 'w-[min(56rem,calc(100vw-2rem))]' : 'w-[min(28rem,calc(100vw-2rem))]',
      ].join(' ')}
    >
      <div class="flex items-start justify-between gap-4">
        <Dialog.Title class="text-lg font-semibold">{title}</Dialog.Title>
        <Dialog.Close
          class="-mt-1 -mr-2 inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
          aria-label={m.common_close()}
        >
          <XIcon size={18} aria-hidden="true" />
        </Dialog.Close>
      </div>
      {#if description}
        <Dialog.Description class="mt-2 text-sm text-ink-muted">{description}</Dialog.Description>
      {/if}
      <div class="mt-5">
        {@render children()}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
