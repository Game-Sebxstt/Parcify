<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { formatRulerTime, formatTime, rulerTicks, timeX } from './model.ts';

  type Props = {
    zoom: number;
    // Tramo de tiempo visible (ms): solo se pintan sus marcas.
    fromMs: number;
    toMs: number;
    // Ancho del tiempo en píxeles (todo el contenido, no solo lo visible).
    width: number;
    head: number;
    span: number;
    recording: boolean;
    touch: boolean;
    // Instante bajo una coordenada X de la ventana.
    timeAt: (clientX: number) => number;
    onseek: (ms: number) => void;
    onheadkey: (event: KeyboardEvent) => void;
  };

  let { zoom, fromMs, toMs, width, head, span, recording, touch, timeAt, onseek, onheadkey }: Props = $props();

  const ticks = $derived(rulerTicks(zoom, fromMs, toMs));
  let scrubbing: number | null = null;

  // Dos dedos sobre la regla pasan a ser zoom o pan del tiempo: quien los detecta corta el arrastre del cabezal.
  export function cancel() {
    scrubbing = null;
  }

  function onpointerdown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    scrubbing = event.pointerId;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Un puntero sintético no se puede capturar.
    }
    onseek(timeAt(event.clientX));
  }

  function onpointermove(event: PointerEvent) {
    if (scrubbing === event.pointerId) onseek(timeAt(event.clientX));
  }

  function end(event: PointerEvent) {
    if (scrubbing === event.pointerId) scrubbing = null;
  }
</script>

<!-- Arrastrar por la regla mueve el cabezal; con el teclado se mueve desde el propio cabezal. -->
<div
  role="presentation"
  {onpointerdown}
  {onpointermove}
  onpointerup={end}
  onpointercancel={end}
  class="relative h-full shrink-0 cursor-pointer touch-none border-b border-edge/40 bg-surface-1 select-none"
  style:width="{width}px"
  data-testid="timeline-ruler"
>
  {#each ticks as tick (tick.ms)}
    <span
      aria-hidden="true"
      class={['absolute bottom-0 w-px', tick.label ? 'h-2.5 bg-edge' : 'h-1.5 bg-edge/50']}
      style:left="{timeX(tick.ms, zoom)}px"
    ></span>
    {#if tick.label}
      <span aria-hidden="true" class="absolute top-0.5 pl-1 text-2xs whitespace-nowrap text-ink-muted tabular" style:left="{timeX(tick.ms, zoom)}px">
        {formatRulerTime(tick.ms)}
      </span>
    {/if}
  {/each}
  <div
    role="slider"
    tabindex="0"
    aria-label={m.timeline_head()}
    aria-valuemin={0}
    aria-valuemax={Math.round(span)}
    aria-valuenow={Math.round(head)}
    aria-valuetext={formatTime(head)}
    onkeydown={onheadkey}
    class={[
      'absolute top-0 flex h-full -translate-x-1/2 cursor-ew-resize justify-center rounded-xs outline-none',
      'focus-visible:outline-2 focus-visible:outline-coral',
      touch ? 'w-7' : 'w-4',
    ]}
    style:left="{timeX(head, zoom)}px"
    data-testid="timeline-head"
  >
    <span aria-hidden="true" class={['mt-1 h-3.5 w-2.5 rounded-xs', recording ? 'bg-danger' : 'bg-coral']}></span>
  </div>
</div>
