<script lang="ts">
  import { Slider } from 'bits-ui';

  type Props = {
    value: number;
    // Nombre accesible del pulgar.
    label: string;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    // Fondo propio del carril (tono, alfa sobre tablero). Con él, el carril mide 12 px y no se pinta el tramo recorrido.
    track?: string;
    valueText?: string;
    testid?: string;
    class?: string;
    // Solo vista previa, mientras se arrastra.
    oninput?: (value: number) => void;
    oncommit?: (value: number) => void;
    oncancel?: () => void;
  };

  let {
    value,
    label,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    track,
    valueText,
    testid,
    class: className = '',
    oninput,
    oncommit,
    oncancel,
  }: Props = $props();

  // Sigue al valor de fuera salvo mientras el usuario lo mueve.
  let current = $derived(value);
  // bits-ui reescribe (y emite) cualquier valor que no caiga en un paso: se le da ya ajustado para que no haya
  // vistas previas que nadie ha pedido.
  const decimals = $derived((String(step).split('.')[1] ?? '').length);
  const snapped = $derived(Number(Math.min(max, Math.max(min, Math.round((current - min) / step) * step + min)).toFixed(decimals)));
  let pending: number | null = null;
  let start = 0;
  // Tras Esc, bits-ui sigue con el arrastre hasta soltar: sus cambios se ignoran y el pulgar se queda en el valor de
  // partida, porque lee el valor del getter de la vinculación.
  let aborted = false;

  function onValueChange(next: number) {
    if (aborted) return;
    if (pending === null) start = value;
    current = next;
    pending = next;
    oninput?.(next);
  }

  // Se compara con el valor de partida: quien use el slider puede reflejar la vista previa en `value`.
  function onValueCommit(next: number) {
    if (aborted) {
      aborted = false;
      return;
    }
    if (pending === null) return;
    pending = null;
    if (next === start) oncancel?.();
    else oncommit?.(next);
  }

  // En captura sobre window, como ScrubInput: el foco puede no estar en el pulgar y el popover no debe cerrarse.
  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || pending === null) return;
    event.preventDefault();
    event.stopPropagation();
    current = start;
    pending = null;
    aborted = true;
    oncancel?.();
  }

  $effect(() => () => {
    if (pending !== null) oncommit?.(pending);
  });
</script>

<svelte:window onkeydowncapture={onWindowKeydown} />

<Slider.Root
  type="single"
  bind:value={() => snapped, onValueChange}
  {onValueCommit}
  {min}
  {max}
  {step}
  {disabled}
  thumbPositioning={track ? 'contain' : 'exact'}
  data-testid={testid}
  class={['relative flex h-4 w-full min-w-0 touch-none items-center select-none data-disabled:opacity-40', className]}
>
  <span
    class={['relative w-full overflow-hidden rounded-full', track ? 'h-3' : 'h-1 bg-edge']}
    style:background={track}
  >
    {#if !track}
      <Slider.Range class="absolute h-full bg-coral" />
    {/if}
  </span>
  <Slider.Thumb
    index={0}
    aria-label={label}
    aria-valuetext={valueText}
    class={[
      'block size-3.5 cursor-grab rounded-full border-2 border-ground bg-ink shadow-[0_1px_3px_rgb(0_0_0/0.4)] outline-none active:cursor-grabbing',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-coral',
    ]}
  />
</Slider.Root>
