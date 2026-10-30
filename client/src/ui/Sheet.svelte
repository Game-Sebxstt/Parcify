<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { m } from '../paraglide/messages.js';

  type Props = {
    open?: boolean;
    title: string;
    // left: cajón lateral de 280 px; bottom: hoja que sube desde abajo.
    side?: 'left' | 'bottom';
    // Modal: fondo oscuro, foco atrapado y sin scroll detrás; un toque fuera la cierra. Sin modal, el resto sigue usable.
    modal?: boolean;
    testid?: string;
    class?: string;
    onOpenChange?: (open: boolean) => void;
    children: Snippet;
  };

  let {
    open = $bindable(false),
    title,
    side = 'bottom',
    modal = true,
    testid,
    class: className = '',
    onOpenChange,
    children,
  }: Props = $props();

  const SIDES = {
    left: [
      'inset-y-0 left-0 w-[280px] max-w-[calc(100vw-48px)]',
      'pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]',
      'data-[state=open]:animate-sheet-left-in data-[state=closed]:animate-sheet-left-out',
    ],
    bottom: [
      'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet',
      'data-[state=open]:animate-sheet-bottom-in data-[state=closed]:animate-sheet-bottom-out',
    ],
  } as const;
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Portal>
    {#if modal}
      <Dialog.Overlay
        class="fixed inset-0 z-(--z-sheet) bg-[rgb(0_6_16/0.5)] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
      />
    {/if}
    <Dialog.Content
      trapFocus={modal}
      preventScroll={modal}
      onInteractOutside={(event) => {
        if (!modal) event.preventDefault();
      }}
    >
      {#snippet child({ props })}
        <div
          {...props}
          aria-modal={modal ? 'true' : 'false'}
          data-testid={testid}
          class={[
            'fixed z-(--z-sheet) flex flex-col overflow-hidden bg-surface-1 text-ink shadow-float outline-none',
            ...SIDES[side],
            className,
          ].join(' ')}
        >
          {#if side === 'bottom'}
            <div aria-hidden="true" class="flex h-5 shrink-0 items-center justify-center">
              <span class="h-1 w-9 rounded-full bg-ink-muted/50"></span>
            </div>
          {/if}
          <div class="flex h-12 shrink-0 items-center gap-2 pl-4">
            <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={m.common_close()}
              class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-card text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <XIcon size={20} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            {@render children()}
          </div>
        </div>
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
