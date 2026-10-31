<script lang="ts">
  import { AI_PREVIEW_COLOR } from '../../../engine/index.ts';

  type Props = {
    id: string;
    label: string;
    // Posición en la pista (px desde el inicio del tiempo).
    left: number;
    tabindex: number;
    // Está en la selección de keyframes: relleno coral.
    selected: boolean;
    // Cae en el cabezal: anillo coral alrededor.
    atHead: boolean;
    // Propuesto por la IA y aún sin aplicar.
    proposed: boolean;
    readOnly: boolean;
    // Con el dedo, la zona que se toca crece de 16 a 28 px.
    touch: boolean;
    onfocus: () => void;
    onpointerdown: (event: PointerEvent) => void;
    onpointermove: (event: PointerEvent) => void;
    onpointerup: (event: PointerEvent) => void;
    onpointercancel: (event: PointerEvent) => void;
    oncontextmenu: (event: MouseEvent) => void;
    ondblclick: () => void;
  };

  let {
    id,
    label,
    left,
    tabindex,
    selected,
    atHead,
    proposed,
    readOnly,
    touch,
    onfocus,
    onpointerdown,
    onpointermove,
    onpointerup,
    onpointercancel,
    oncontextmenu,
    ondblclick,
  }: Props = $props();
</script>

<!-- El teclado de la celda lo lleva la rejilla. -->
<div
  {id}
  role="gridcell"
  {tabindex}
  aria-selected={selected}
  aria-label={label}
  {onfocus}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onpointercancel}
  {oncontextmenu}
  {ondblclick}
  style:left="{left}px"
  class={[
    'group/kf absolute top-1/2 z-[1] grid -translate-1/2 touch-none place-items-center rounded-xs outline-none select-none',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
    touch ? 'size-7' : 'size-4',
    readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
  ]}
  data-testid="keyframe"
  data-touch-exempt=""
  data-selected={selected ? '' : undefined}
  data-at-head={atHead ? '' : undefined}
>
  <span
    aria-hidden="true"
    class={[
      'block size-[7px] rotate-45 rounded-[1px] border transition-colors duration-(--dur-fast)',
      selected ? 'border-coral bg-coral' : 'border-ink-muted bg-surface-2 group-hover/kf:border-ink',
      atHead && 'ring-1 ring-coral ring-offset-2 ring-offset-surface-1',
    ]}
    style:border-color={proposed && !selected ? AI_PREVIEW_COLOR : undefined}
    style:background-color={proposed && !selected ? AI_PREVIEW_COLOR : undefined}
    data-proposed={proposed ? '' : undefined}
  ></span>
</div>
