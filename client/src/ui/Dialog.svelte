<script lang="ts">
  import { Dialog } from 'bits-ui';
  import XIcon from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { m } from '../paraglide/messages.js';
  import { touchDensity } from './pointer.svelte.ts';

  type Props = {
    open?: boolean;
    title: string;
    description?: string;
    // Recibe las props que el disparador debe propagar a su botón.
    trigger?: Snippet<[Record<string, unknown>]>;
    children: Snippet;
    onOpenChange?: (open: boolean) => void;
    // Al cerrarse; con preventDefault, el foco no vuelve al elemento que tenía antes de abrirse.
    onCloseAutoFocus?: (event: Event) => void;
    // lg: para contenido ancho, como la vista previa de una imagen.
    size?: 'md' | 'lg';
  };

  let { open = $bindable(false), title, description, trigger, children, onOpenChange, onCloseAutoFocus, size = 'md' }: Props = $props();
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
      {onCloseAutoFocus}
      data-touch-density={touchDensity()}
      class={[
        // En móvil ocupa el ancho con 16 px de margen; si no cabe en alto, el contenido hace scroll dentro.
        'fixed top-1/2 left-1/2 z-50 max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 overflow-x-hidden overflow-y-auto scroll-thin rounded-panel bg-surface-1 p-5 text-ink shadow-float sm:p-6',
        size === 'lg' ? 'w-[min(56rem,calc(100vw-2rem))]' : 'w-[min(28rem,calc(100vw-2rem))]',
      ].join(' ')}
    >
      <div class="flex items-start justify-between gap-4">
        <Dialog.Title class="text-lg font-semibold">{title}</Dialog.Title>
        <Dialog.Close
          class="-mt-1 -mr-2 inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink sheet:-mt-2.5 sheet:-mr-3 sheet:size-11"
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
