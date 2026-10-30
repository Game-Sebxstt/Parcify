<script lang="ts">
  import { WIDTH_STEP } from '../../../lib/editor-layout.svelte.ts';

  type Props = {
    // Borde del panel en el que está el asa: el derecho del panel izquierdo o el izquierdo del derecho.
    edge: 'left' | 'right';
    width: number;
    min: number;
    max: number;
    label: string;
    onresize: (width: number) => void;
  };

  let { edge, width, min, max, label, onresize }: Props = $props();

  let drag: { pointerId: number; x: number; width: number } | null = null;
  let dragging = $state(false);

  // Hacia la derecha crece el panel izquierdo y encoge el derecho.
  const sign = $derived(edge === 'right' ? 1 : -1);

  function onpointerdown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // Un puntero sintético no se puede capturar.
    }
    drag = { pointerId: event.pointerId, x: event.clientX, width };
    dragging = true;
  }

  function onpointermove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    onresize(drag.width + sign * (event.clientX - drag.x));
  }

  function end(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    dragging = false;
  }

  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? WIDTH_STEP : event.key === 'ArrowLeft' ? -WIDTH_STEP : 0;
    if (step) onresize(width + sign * step);
    else if (event.key === 'Home') onresize(min);
    else if (event.key === 'End') onresize(max);
    else return;
    event.preventDefault();
  }
</script>

<!-- El asa se mueve con el puntero y con ←/→; es un separador con valor, no un botón. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={width}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  data-own-keys
  {onpointerdown}
  {onpointermove}
  onpointerup={end}
  onpointercancel={end}
  {onkeydown}
  class={[
    'absolute inset-y-3 z-10 w-1 cursor-ew-resize touch-none rounded-full outline-none',
    'transition-colors duration-(--dur-fast) hover:bg-edge/60 focus-visible:bg-coral',
    'touch:before:absolute touch:before:inset-y-0 touch:before:-inset-x-2.5',
    edge === 'right' ? '-right-0.5' : '-left-0.5',
    dragging ? 'bg-coral' : '',
  ]}
  data-testid="panel-resizer-{edge === 'right' ? 'left' : 'right'}"
></div>
