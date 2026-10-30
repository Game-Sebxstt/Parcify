<script lang="ts" generics="T extends { rowKey: string }">
  import { tick, untrack, type Snippet } from 'svelte';
  import { classifyWheel, OWN_WHEEL_ATTR, TwoFingerTracker } from '../../../engine/index.ts';
  import TimelineRuler from './TimelineRuler.svelte';
  import { clampZoom, LABEL_WIDTH, LANE_PAD, RULER_HEIGHT, rowOffsets, timeX, visibleRows } from './model.ts';

  type Props = {
    rows: readonly T[];
    heights: readonly number[];
    zoom: number;
    head: number;
    span: number;
    recording: boolean;
    touch: boolean;
    // Rejilla de filas: rol, nombre, teclado y descripción los pone quien la usa.
    grid: Record<string, unknown>;
    onseek: (ms: number) => void;
    onheadkey: (event: KeyboardEvent) => void;
    // Empieza un gesto de dos dedos: hay que soltar cualquier arrastre de un dedo en curso.
    oncancelgesture: () => void;
    // Un gesto de un dedo que no es scroll (la marquesina tras la pulsación larga): el navegador no debe desplazar.
    lockTouch: boolean;
    row: Snippet<[T, { top: number; height: number; index: number }]>;
    // Encima de las filas, en coordenadas de la rejilla (x desde el inicio de las pistas, y desde la primera fila).
    overlay?: Snippet;
  };

  let { rows, heights, zoom = $bindable(), head, span, recording, touch, grid, onseek, onheadkey, oncancelgesture, lockTouch, row, overlay }: Props = $props();

  // Margen a la derecha del final para que el último keyframe no quede pegado al borde.
  const TAIL = 32;
  const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  // GestureEvent solo existe en Safari y no está en los tipos del DOM.
  type SafariGestureEvent = Event & { scale: number; clientX: number };

  let scroller = $state<HTMLElement | null>(null);
  let ruler = $state<ReturnType<typeof TimelineRuler> | null>(null);
  let scrollX = $state(0);
  let scrollTop = $state(0);
  let viewWidth = $state(0);
  let viewHeight = $state(0);
  let fitted = false;

  const laneWidth = $derived(Math.max(0, viewWidth - LABEL_WIDTH));
  const contentWidth = $derived(Math.max(laneWidth, timeX(span, zoom) + TAIL));
  const offsets = $derived(rowOffsets(heights));
  const total = $derived(offsets[offsets.length - 1] ?? 0);
  const range = $derived(visibleRows(offsets, scrollTop, viewHeight - RULER_HEIGHT));
  const shown = $derived(rows.slice(range.start, range.end).map((item, i) => ({ item, index: range.start + i })));
  const fromMs = $derived((scrollX - LANE_PAD) / zoom);
  const toMs = $derived((scrollX + laneWidth - LANE_PAD) / zoom);

  // Encaja la duración en el ancho la primera vez que se mide.
  $effect(() => {
    if (fitted || laneWidth <= 0) return;
    fitted = true;
    untrack(() => fit());
  });

  // El cabezal no sale de la vista (al reproducir, con el teclado o al escribir el tiempo).
  $effect(() => {
    const time = head;
    untrack(() => {
      const x = timeX(time, zoom);
      if (!scroller || laneWidth <= 0) return;
      if (x > scrollX + laneWidth - 8 || x < scrollX) setScrollX(x - laneWidth * 0.1);
    });
  });

  function setScrollX(px: number) {
    if (!scroller) return;
    const max = Math.max(0, contentWidth - laneWidth);
    scroller.scrollLeft = Math.min(max, Math.max(0, px));
    scrollX = scroller.scrollLeft;
  }

  // Cambia la escala del tiempo dejando quieto el instante que hay en `anchorX` (px desde el inicio de las pistas).
  export async function zoomTo(next: number, anchorX = laneWidth / 2) {
    const at = (scrollX + anchorX - LANE_PAD) / zoom;
    zoom = clampZoom(next);
    // El ancho del contenido cambia con el zoom: el scroll se ajusta cuando ya está en el DOM.
    await tick();
    setScrollX(timeX(at, zoom) - anchorX);
  }

  export function zoomBy(factor: number, anchorX?: number) {
    return zoomTo(zoom * factor, anchorX);
  }

  // «Encajar tiempo»: toda la duración en el ancho visible.
  export async function fit() {
    zoom = clampZoom((laneWidth - TAIL - LANE_PAD) / Math.max(1, span));
    await tick();
    setScrollX(0);
  }

  export function timeAt(clientX: number): number {
    const left = (scroller?.getBoundingClientRect().left ?? 0) + LABEL_WIDTH;
    return (clientX - left + scrollX - LANE_PAD) / zoom;
  }

  // Punto de la ventana en coordenadas de la rejilla: x como timeX (px desde el inicio de las pistas) e y desde el
  // borde superior de la primera fila.
  export function gridPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = scroller?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0) - LABEL_WIDTH + (scroller?.scrollLeft ?? 0),
      y: clientY - (rect?.top ?? 0) - RULER_HEIGHT + (scroller?.scrollTop ?? 0),
    };
  }

  // Lleva a la vista la fila `index` y, si se indica, el instante `ms`.
  export function reveal(index: number, ms?: number) {
    if (!scroller) return;
    const top = offsets[index] ?? 0;
    const bottom = offsets[index + 1] ?? top;
    const visible = scroller.clientHeight - RULER_HEIGHT;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + visible) scroller.scrollTop = bottom - visible;
    scrollTop = scroller.scrollTop;
    if (ms === undefined) return;
    const x = timeX(ms, zoom);
    if (x < scrollX + 12 || x > scrollX + laneWidth - 12) setScrollX(x - laneWidth / 2);
  }

  const laneLeft = () => (scroller?.getBoundingClientRect().left ?? 0) + LABEL_WIDTH;

  // Rueda sobre las pistas (RF-5.6): el zoom (Ctrl/⌘+rueda o pellizco del touchpad) cambia la escala del tiempo en el
  // puntero; un pan con componente horizontal desplaza el tiempo; un pan solo vertical es el scroll nativo de las filas.
  // Con dos dedos sobre la pantalla, pellizco y arrastre hacen lo mismo; un dedo solo hace el scroll nativo.
  const gestures = (node: HTMLElement) => {
    // Pellizco del touchpad en Safari de macOS (gesturestart/change/end, con la escala acumulada).
    let safari: { zoom0: number; at: number; anchorX: number } | null = null;

    const onWheel = (event: WheelEvent) => {
      const rect = node.getBoundingClientRect();
      const action = classifyWheel(
        {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: (event.deltaMode === 1 || event.deltaMode === 2 ? event.deltaMode : 0) as 0 | 1 | 2,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          shift: event.shiftKey,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        { isMac: MAC, pref: 'pan', gestureActive: safari !== null, viewportHeight: window.innerHeight },
      );
      if (safari && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        return;
      }
      if (action.kind === 'zoom') {
        event.preventDefault();
        void zoomBy(action.factor, Math.max(0, event.clientX - laneLeft()));
      } else if (action.kind === 'pan' && action.dx !== 0) {
        event.preventDefault();
        setScrollX(scrollX - action.dx);
        node.scrollTop -= action.dy;
      }
    };

    // Dedos sobre las pistas, en el orden en que se apoyaron.
    let touches: Array<{ id: number; x: number; y: number }> = [];
    const tracker = new TwoFingerTracker();
    let pinching = false;
    const track = (event: PointerEvent) => touches.find((touch) => touch.id === event.pointerId);

    // En captura: el segundo dedo no debe llegar al rombo o a la barra que haya debajo.
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touches = [...touches.filter((touch) => touch.id !== event.pointerId), { id: event.pointerId, x: event.clientX, y: event.clientY }];
      if (touches.length === 2) {
        pinching = true;
        tracker.start(touches[0]!, touches[1]!);
        ruler?.cancel();
        oncancelgesture();
      }
      if (touches.length >= 2) event.stopPropagation();
    };
    const onMove = (event: PointerEvent) => {
      const touch = track(event);
      if (!touch) return;
      touch.x = event.clientX;
      touch.y = event.clientY;
      if (!pinching) return;
      event.stopPropagation();
      if (touches.length !== 2) return;
      const step = tracker.move(touches[0]!, touches[1]!);
      if (step.pan.x || step.pan.y) {
        setScrollX(node.scrollLeft - step.pan.x);
        node.scrollTop -= step.pan.y;
      }
      if (step.zoomFactor !== 1) void zoomBy(step.zoomFactor, Math.max(0, step.center.x - laneLeft()));
    };
    const onUp = (event: PointerEvent) => {
      if (!track(event)) return;
      touches = touches.filter((touch) => touch.id !== event.pointerId);
      if (pinching) event.stopPropagation();
      if (touches.length < 2) pinching = false;
    };
    // Con dos dedos, el navegador no debe desplazar las filas por su cuenta mientras se hace zoom.
    const onTouch = (event: TouchEvent) => {
      if ((event.touches.length >= 2 || lockTouch) && event.cancelable) event.preventDefault();
    };

    // En iOS y iPadOS el pellizco llega por Pointer Events (maxTouchPoints > 0) y lo llevan los dos dedos de arriba.
    const safariGestures = 'GestureEvent' in window && navigator.maxTouchPoints === 0;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      const anchorX = Math.max(0, (event as SafariGestureEvent).clientX - laneLeft());
      safari = { zoom0: zoom, at: (scrollX + anchorX - LANE_PAD) / zoom, anchorX };
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = safari;
      const scale = (event as SafariGestureEvent).scale;
      if (!gesture || !Number.isFinite(scale) || scale <= 0) return;
      zoom = clampZoom(gesture.zoom0 * scale);
      // El instante que había bajo los dedos al empezar sigue ahí, aunque los cambios lleguen antes del tick.
      void tick().then(() => setScrollX(timeX(gesture.at, zoom) - gesture.anchorX));
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      safari = null;
    };
    if (safariGestures) {
      node.addEventListener('gesturestart', onGestureStart);
      node.addEventListener('gesturechange', onGestureChange);
      node.addEventListener('gestureend', onGestureEnd);
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('pointerdown', onDown, { capture: true });
    node.addEventListener('pointermove', onMove, { capture: true });
    node.addEventListener('pointerup', onUp, { capture: true });
    node.addEventListener('pointercancel', onUp, { capture: true });
    node.addEventListener('touchstart', onTouch, { passive: false });
    node.addEventListener('touchmove', onTouch, { passive: false });
    node.setAttribute(OWN_WHEEL_ATTR, '');
    return () => {
      safari = null;
      node.removeEventListener('gesturestart', onGestureStart);
      node.removeEventListener('gesturechange', onGestureChange);
      node.removeEventListener('gestureend', onGestureEnd);
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', onDown, { capture: true });
      node.removeEventListener('pointermove', onMove, { capture: true });
      node.removeEventListener('pointerup', onUp, { capture: true });
      node.removeEventListener('pointercancel', onUp, { capture: true });
      node.removeEventListener('touchstart', onTouch);
      node.removeEventListener('touchmove', onTouch);
      node.removeAttribute(OWN_WHEEL_ATTR);
    };
  };
</script>

<div
  bind:this={scroller}
  bind:clientWidth={viewWidth}
  bind:clientHeight={viewHeight}
  {@attach gestures}
  onscroll={(event) => {
    scrollX = event.currentTarget.scrollLeft;
    scrollTop = event.currentTarget.scrollTop;
  }}
  class={['scroll-thin relative min-h-0 flex-1 overflow-auto overscroll-contain rounded-b-[9px]', lockTouch ? 'touch-none' : 'touch-pan-x touch-pan-y']}
  data-testid="timeline-tracks"
>
  <div class="relative" style:width="{LABEL_WIDTH + contentWidth}px" style:height="{Math.max(RULER_HEIGHT + total, viewHeight)}px">
    <div class="sticky top-0 z-20 flex" style:height="{RULER_HEIGHT}px">
      <div class="sticky left-0 z-10 shrink-0 border-b border-edge/40 bg-surface-1" style:width="{LABEL_WIDTH}px"></div>
      <TimelineRuler bind:this={ruler} {zoom} {fromMs} {toMs} width={contentWidth} {head} {span} {recording} {touch} {timeAt} {onseek} {onheadkey} />
    </div>
    <div {...grid} class="relative" style:height="{total}px" data-testid="timeline-grid">
      {#each shown as entry (entry.item.rowKey)}
        {@render row(entry.item, { top: offsets[entry.index] ?? 0, height: heights[entry.index] ?? 0, index: entry.index })}
      {/each}
    </div>
    {#if overlay}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute z-[6]"
        style:top="{RULER_HEIGHT}px"
        style:left="{LABEL_WIDTH}px"
        style:width="{contentWidth}px"
        style:height="{total}px"
      >
        {@render overlay()}
      </div>
    {/if}
    <span
      aria-hidden="true"
      class={['pointer-events-none absolute bottom-0 z-[5] w-px', recording ? 'bg-danger' : 'bg-coral']}
      style:top="{RULER_HEIGHT}px"
      style:left="{LABEL_WIDTH + timeX(head, zoom)}px"
    ></span>
  </div>
</div>
