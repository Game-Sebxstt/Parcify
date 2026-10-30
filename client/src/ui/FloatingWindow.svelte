<script lang="ts">
  import Minus from '@lucide/svelte/icons/minus';
  import X from '@lucide/svelte/icons/x';
  import { tick, type Component, type Snippet } from 'svelte';
  import { innerHeight, innerWidth } from 'svelte/reactivity/window';
  import { clampRect, resizeRect, windowStack, type ResizeEdge, type WindowRect, type WindowSize } from './floating-window.svelte.ts';
  import Tooltip from './Tooltip.svelte';

  type Props = {
    title: string;
    open: boolean;
    // Posición y tamaño elegidos por la persona; null mientras no se ha movido (manda `defaultRect`).
    rect?: WindowRect | null;
    minimized?: boolean;
    // Sin minimizar, Esc cierra la ventana.
    minimizable?: boolean;
    defaultRect: () => WindowRect;
    minSize?: WindowSize;
    // Presentando o con la interfaz oculta: la ventana sigue montada, pero no se ve.
    hidden?: boolean;
    // Distancia de la píldora minimizada a los bordes derecho e inferior.
    pillAt?: { right: number; bottom: number };
    icon?: Component<{ size?: number; 'aria-hidden'?: 'true' }>;
    badge?: number;
    // Texto del contador para el lector de pantalla, p. ej. «3 sin leer».
    badgeLabel?: string;
    badgeTestid?: string;
    closeLabel: string;
    minimizeLabel?: string;
    restoreLabel?: string;
    testid: string;
    // Controles extra de la cabecera (pestañas).
    header?: Snippet;
    children: Snippet;
    onclose: () => void;
    // Adónde vuelve el foco al minimizar o cerrar.
    returnFocus?: () => HTMLElement | null;
  };

  let {
    title,
    open,
    rect = $bindable(null),
    minimized = $bindable(false),
    minimizable = true,
    defaultRect,
    minSize = { w: 320, h: 360 },
    hidden = false,
    pillAt = { right: 12, bottom: 12 },
    icon: Icon,
    badge = 0,
    badgeLabel,
    badgeTestid,
    closeLabel,
    minimizeLabel = '',
    restoreLabel = '',
    testid,
    header,
    children,
    onclose,
    returnFocus,
  }: Props = $props();

  const uid = $props.id();
  let dialog = $state<HTMLElement | null>(null);
  let pill = $state<HTMLButtonElement | null>(null);

  const view = $derived({ w: innerWidth.current ?? 1024, h: innerHeight.current ?? 768 });
  // Siempre dentro de la vista actual: al encoger la ventana del navegador, la ventana se recoloca sin perder lo guardado.
  const shown = $derived(clampRect(rect ?? defaultRect(), view, minSize));
  const visible = $derived(open && !minimized && !hidden);
  const front = $derived(windowStack.front === uid);

  type Drag = { id: number; kind: 'move' | ResizeEdge; x: number; y: number; start: WindowRect };
  let drag = $state.raw<Drag | null>(null);

  // Lleva el foco al primer [data-autofocus] visible (el compositor del chat) o a la propia ventana.
  export async function focus() {
    await tick();
    if (!dialog || !visible) return;
    windowStack.raise(uid);
    const target = [...dialog.querySelectorAll<HTMLElement>('[data-autofocus]')].find((el) => el.checkVisibility?.() ?? el.offsetParent !== null);
    (target ?? dialog).focus({ preventScroll: true });
  }

  function giveBackFocus() {
    const target = returnFocus?.();
    if (target?.isConnected) target.focus({ preventScroll: true });
    else if (minimized) void tick().then(() => pill?.focus({ preventScroll: true }));
  }

  function minimize() {
    minimized = true;
    giveBackFocus();
  }

  function close() {
    onclose();
    giveBackFocus();
  }

  function restore() {
    minimized = false;
    void focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (minimizable) minimize();
    else close();
  }

  const INTERACTIVE = 'button, a, input, textarea, select, [role="radio"], [role="tab"], [contenteditable]';

  function down(kind: Drag['kind'], event: PointerEvent) {
    if (event.button !== 0 || drag) return;
    if (kind === 'move' && event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    windowStack.raise(uid);
    drag = { id: event.pointerId, kind, x: event.clientX, y: event.clientY, start: shown };
  }

  function move(event: PointerEvent) {
    const current = drag;
    if (!current || event.pointerId !== current.id) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const start = current.start;
    rect =
      current.kind === 'move'
        ? clampRect({ ...start, x: start.x + dx, y: start.y + dy }, view, minSize)
        : resizeRect(start, current.kind, dx, dy, view, minSize);
  }

  function up(event: PointerEvent) {
    if (drag?.id === event.pointerId) drag = null;
  }

  const HEADER_BUTTON =
    'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink touch:size-8';
  // Las asas conservan su dibujo; con el dedo, un ::before amplía la zona de toque hacia fuera de la ventana.
  const HANDLE = 'absolute z-10 touch-none before:absolute';
</script>

{#snippet headerButton(label: string, onclick: () => void, kind: 'minimize' | 'close')}
  <Tooltip text={label} side="bottom">
    {#snippet children(props)}
      <button {...props} type="button" aria-label={label} {onclick} class={HEADER_BUTTON} data-testid="{testid}-{kind}">
        {#if kind === 'minimize'}<Minus size={16} aria-hidden="true" />{:else}<X size={16} aria-hidden="true" />{/if}
      </button>
    {/snippet}
  </Tooltip>
{/snippet}

<div
  bind:this={dialog}
  role="dialog"
  aria-modal="false"
  aria-labelledby="{uid}-title"
  tabindex="-1"
  hidden={!visible}
  onkeydown={onKeydown}
  onfocusin={() => windowStack.raise(uid)}
  onpointerdowncapture={() => windowStack.raise(uid)}
  class="absolute flex flex-col rounded-panel border border-edge/40 bg-surface-1 text-sm text-ink shadow-float outline-none"
  style:left="{shown.x}px"
  style:top="{shown.y}px"
  style:width="{shown.w}px"
  style:height="{shown.h}px"
  style:z-index={front ? 'calc(var(--z-window) + 1)' : 'var(--z-window)'}
  data-testid={testid}
>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
    <!-- La cabecera es el asa de arrastre (solo con puntero); sus botones y pestañas no arrastran. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onpointerdown={(event) => down('move', event)}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      class={[
        'flex h-10 shrink-0 touch-none items-center gap-2 border-b border-edge/25 pr-1.5 pl-3 select-none',
        drag?.kind === 'move' ? 'cursor-grabbing' : 'cursor-grab',
      ]}
      data-testid="{testid}-header"
    >
      <h2 id="{uid}-title" class="min-w-0 truncate text-ui font-semibold">{title}</h2>
      {@render header?.()}
      <span class="flex-1"></span>
      {#if minimizable}
        {@render headerButton(minimizeLabel, minimize, 'minimize')}
      {/if}
      {@render headerButton(closeLabel, close, 'close')}
    </div>
    <div class="flex min-h-0 min-w-0 flex-1 touch-pan-x touch-pan-y flex-col overscroll-contain">
      {@render children()}
    </div>
  </div>

  <div
    aria-hidden="true"
    onpointerdown={(event) => down('left', event)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    class={[HANDLE, 'top-3 bottom-0 left-0 w-1.5 cursor-ew-resize touch:before:inset-y-0 touch:before:right-0 touch:before:-left-[18px]']}
    data-testid="{testid}-resize-left"
  ></div>
  <div
    aria-hidden="true"
    onpointerdown={(event) => down('top', event)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    class={[HANDLE, 'top-0 right-0 left-3 h-1.5 cursor-ns-resize touch:before:inset-x-0 touch:before:bottom-0 touch:before:-top-[18px]']}
    data-testid="{testid}-resize-top"
  ></div>
  <div
    aria-hidden="true"
    onpointerdown={(event) => down('corner', event)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    class={[HANDLE, 'top-0 left-0 size-3 cursor-nwse-resize touch:before:right-0 touch:before:bottom-0 touch:before:-top-5 touch:before:-left-5']}
    data-testid="{testid}-resize-corner"
  ></div>
</div>

{#if open && minimized && !hidden}
  <button
    bind:this={pill}
    type="button"
    aria-label={badge && badgeLabel ? `${restoreLabel}, ${badgeLabel}` : restoreLabel}
    onclick={restore}
    class="absolute z-(--z-window) inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-edge/40 bg-surface-2 px-3 text-ui text-ink shadow-float transition-colors duration-(--dur-fast) hover:bg-petrol"
    style:right="{pillAt.right}px"
    style:bottom="{pillAt.bottom}px"
    data-testid="{testid}-pill"
  >
    {#if Icon}<Icon size={16} aria-hidden="true" />{/if}
    <span>{title}</span>
    {#if badge > 0}
      <span
        aria-hidden="true"
        class="min-w-[18px] rounded-full bg-coral px-1 text-center text-2xs leading-[18px] font-semibold text-coral-ink tabular"
        data-testid={badgeTestid}
      >
        {badge > 99 ? '99+' : badge}
      </span>
    {/if}
  </button>
{/if}
