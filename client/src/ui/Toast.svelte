<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import { m } from '../paraglide/messages.js';
  import { dismissToast, toasts } from './toast.svelte.ts';

  const TONES = {
    info: 'text-ink',
    success: 'text-sage',
    error: 'text-danger',
  } as const;
</script>

<!-- En el móvil, arriba, debajo de la barra superior: abajo taparían la barra de herramientas, las hojas y los
     controles de Presentar justo cuando se van a tocar. -->
<section
  aria-label={m.common_notifications()}
  aria-live="polite"
  class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 max-sm:top-[calc(3.5rem+env(safe-area-inset-top))] max-sm:bottom-auto"
>
  {#each toasts as toast (toast.id)}
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      class="pointer-events-auto flex animate-toast-in items-center gap-3 rounded-panel bg-surface-2 py-2.5 pr-2 pl-4 text-sm shadow-float pointer-coarse:py-1"
    >
      <p class={['min-w-0 flex-1', TONES[toast.tone]].join(' ')}>{toast.message}</p>
      {#if toast.action}
        <button
          type="button"
          class="h-8 shrink-0 cursor-pointer rounded-full px-3 font-semibold text-coral hover:bg-petrol pointer-coarse:h-11"
          onclick={() => {
            toast.action?.run();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      {/if}
      <button
        type="button"
        class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-petrol hover:text-ink pointer-coarse:size-11"
        aria-label={m.common_close()}
        onclick={() => dismissToast(toast.id)}
      >
        <XIcon size={16} aria-hidden="true" />
      </button>
    </div>
  {/each}
</section>
