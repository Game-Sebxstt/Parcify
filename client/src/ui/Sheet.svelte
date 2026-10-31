<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { Viewport } from '../lib/viewport.svelte.ts';
  import { m } from '../paraglide/messages.js';

  type Props = {
    open?: boolean;
    title: string;
    // left: cajón lateral de 280 px; bottom: hoja que sube desde abajo.
    side?: 'left' | 'bottom';
    // Modal: fondo oscuro, foco atrapado y sin scroll detrás; un toque fuera la cierra. Sin modal, el resto sigue usable.
    modal?: boolean;
    // Alturas de reposo de la hoja inferior, de menor a mayor, en fracción del alto visible (como mucho 0,92). Sin
    // ellas, la hoja mide lo que su contenido.
    heights?: number[];
    // Altura de reposo actual (índice de `heights`).
    level?: number;
    // Lo que recibe el foco al abrir; por defecto, la cabecera.
    initialFocus?: () => HTMLElement | null | undefined;
    // Alto en pantalla de la hoja inferior (con el teclado, lo que queda por encima de él), para que la cámara la evite.
    height?: number;
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
    heights,
    level = $bindable(0),
    initialFocus,
    height = $bindable(0),
    testid,
    class: className = '',
    onOpenChange,
    children,
  }: Props = $props();

  const MAX = 0.92;
  // Un gesto hacia abajo más rápido que esto (px/ms) cierra la hoja o la baja una altura.
  const FLICK = 0.5;
  const viewport = new Viewport();

  // Con el teclado virtual abierto, la hoja se apoya encima de él.
  const keyboard = $derived(side === 'bottom' ? viewport.keyboardInset : 0);
  const available = $derived(Math.max(0, viewport.height - keyboard));
  const stops = $derived((heights ?? []).map((value) => Math.min(value, MAX) * available));
  const restHeight = $derived(stops.length ? stops[Math.min(Math.max(level, 0), stops.length - 1)]! : null);

  let sheet = $state<HTMLElement | null>(null);
  let header = $state<HTMLElement | null>(null);
  // Arrastre por el asa o la cabecera: desplazamiento vertical desde la pulsación (positivo hacia abajo).
  let drag = $state<{ id: number; startY: number; startHeight: number; dy: number; samples: Array<{ y: number; t: number }> } | null>(null);

  const shownHeight = $derived(restHeight === null ? null : drag ? Math.min(Math.max(drag.startHeight - drag.dy, 0), MAX * available) : restHeight);
  const offset = $derived(restHeight === null && drag ? Math.max(0, drag.dy) : 0);

  const SIDES = {
    left: [
      'inset-y-0 left-0 w-[280px] max-w-[calc(100vw-48px)]',
      'pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]',
      'data-[state=open]:animate-sheet-left-in data-[state=closed]:animate-sheet-left-out',
    ],
    bottom: ['inset-x-0 max-h-[92dvh] rounded-t-sheet', 'data-[state=open]:animate-sheet-bottom-in data-[state=closed]:animate-sheet-bottom-out'],
  } as const;

  // La hoja inferior lleva el foco a su cabecera; el cajón lateral deja el de bits-ui (su primera entrada).
  function onOpenAutoFocus(event: Event) {
    if (side !== 'bottom' && !initialFocus) return;
    event.preventDefault();
    (initialFocus?.() ?? header)?.focus({ preventScroll: true });
  }

  function startDrag(event: PointerEvent) {
    if (side !== 'bottom' || drag || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Un puntero sintético o ya soltado no se puede capturar; el arrastre sigue igual.
    }
    const height = sheet?.offsetHeight ?? 0;
    drag = { id: event.pointerId, startY: event.clientY, startHeight: height, dy: 0, samples: [{ y: event.clientY, t: event.timeStamp }] };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    drag.dy = event.clientY - drag.startY;
    drag.samples = [...drag.samples.filter((sample) => event.timeStamp - sample.t < 100), { y: event.clientY, t: event.timeStamp }];
  }

  // Velocidad de los últimos 100 ms, en px/ms (positiva hacia abajo).
  function velocity(samples: Array<{ y: number; t: number }>): number {
    const first = samples[0];
    const last = samples.at(-1);
    if (!first || !last || last.t <= first.t) return 0;
    return (last.y - first.y) / (last.t - first.t);
  }

  function close() {
    open = false;
    onOpenChange?.(false);
  }

  function endDrag(event: PointerEvent) {
    const current = drag;
    if (!current || current.id !== event.pointerId) return;
    drag = null;
    const speed = velocity(current.samples);
    if (restHeight === null) {
      if (speed > FLICK || current.dy > current.startHeight / 3) close();
      return;
    }
    if (speed > FLICK) {
      if (level <= 0) close();
      else level -= 1;
      return;
    }
    if (speed < -FLICK) {
      level = Math.min(level + 1, stops.length - 1);
      return;
    }
    // Se suelta en la altura de reposo más cercana; por debajo de la mitad de la menor, se cierra.
    const target = current.startHeight - current.dy;
    if (target < stops[0]! / 2) {
      close();
      return;
    }
    let nearest = 0;
    for (let index = 1; index < stops.length; index++) {
      if (Math.abs(stops[index]! - target) < Math.abs(stops[nearest]! - target)) nearest = index;
    }
    level = nearest;
  }

  function cancelDrag(event: PointerEvent) {
    if (drag?.id === event.pointerId) drag = null;
  }
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
      {onOpenAutoFocus}
      onInteractOutside={(event) => {
        if (!modal) event.preventDefault();
      }}
    >
      {#snippet child({ props })}
        <div
          {...props}
          bind:this={sheet}
          bind:offsetHeight={height}
          aria-modal={modal ? 'true' : 'false'}
          data-testid={testid}
          data-side={side}
          style:bottom={side === 'bottom' ? `${keyboard}px` : null}
          style:height={shownHeight === null ? null : `${shownHeight}px`}
          style:translate={offset ? `0 ${offset}px` : null}
          class={[
            'fixed z-(--z-sheet) flex flex-col overflow-hidden bg-surface-1 text-ink shadow-float outline-none',
            drag ? '' : 'transition-[height,translate] duration-(--dur-slow) ease-out',
            ...SIDES[side],
            className,
          ].join(' ')}
        >
          {#if side === 'bottom'}
            <!-- Asa y cabecera: arrastrarlas cambia la altura o cierra la hoja. La alternativa sin arrastre es el ×. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="shrink-0 touch-none"
              onpointerdown={startDrag}
              onpointermove={moveDrag}
              onpointerup={endDrag}
              onpointercancel={cancelDrag}
              data-sheet-grip=""
            >
              <div aria-hidden="true" class="flex h-5 items-center justify-center">
                <span class="h-1 w-9 rounded-full bg-ink-muted/50"></span>
              </div>
              {@render head()}
            </div>
          {:else}
            {@render head()}
          {/if}
          <div class="flex min-h-0 flex-1 touch-pan-x touch-pan-y flex-col overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            {@render children()}
          </div>
        </div>
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

{#snippet head()}
  <div bind:this={header} tabindex="-1" class="flex h-12 shrink-0 items-center gap-2 pl-4 outline-none">
    <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-semibold">{title}</Dialog.Title>
    <Dialog.Close
      aria-label={m.common_close()}
      class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-card text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <XIcon size={20} aria-hidden="true" />
    </Dialog.Close>
  </div>
{/snippet}
