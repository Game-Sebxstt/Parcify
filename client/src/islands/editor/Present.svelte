<script lang="ts" module>
  import type { Engine } from '../../engine/index.ts';

  // Diapositivas: los frames visibles de la página activa que no están dentro de otro frame, en orden de capas.
  export function presentationSlides(engine: Engine): string[] {
    const core = engine.core;
    const pageId = core.activePage;
    if (!pageId) return [];
    return core.tree.paintOrder(pageId).filter((id) => {
      const record = core.record(id);
      if (record?.type !== 'frame' || record.visible === false || core.tree.hiddenAbove(id)) return false;
      for (let parent = core.tree.parent(id); parent; parent = core.tree.parent(parent)) {
        if (core.record(parent)?.type === 'frame') return false;
      }
      return true;
    });
  }
</script>

<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import { onMount } from 'svelte';
  import { MAX_ZOOM } from '../../engine/render/Camera.ts';
  import type { AABB } from '../../engine/types.ts';
  import { motionReduced } from '../../lib/motion.ts';
  import { m } from '../../paraglide/messages.js';
  import { showToast } from '../../ui/toast.svelte.ts';

  type Props = {
    engine: Engine;
    // Lo que pasa a pantalla completa: la raíz del editor, con el lienzo y esta capa encima.
    host: HTMLElement;
    // 'page': una sola diapositiva con todo el contenido de la página (páginas sin frames).
    mode?: 'frames' | 'page';
    onclose: () => void;
  };

  let { engine, host, mode = 'frames', onclose }: Props = $props();

  // Los controles se ocultan tras un rato sin mover el puntero.
  const IDLE_MS = 2500;
  // Fuera de pantalla completa la diapositiva no toca los bordes de la ventana.
  const WINDOW_MARGIN = 24;
  const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
  // Deslizar con el dedo: más de 48 px en horizontal en 600 ms como mucho.
  const SWIPE_PX = 48;
  const SWIPE_MS = 600;
  // Un toque que se mueve más que esto ya no es un toque.
  const TAP_SLOP = 10;

  let root = $state<HTMLDivElement | null>(null);
  let slides = $state.raw<string[]>([]);
  let index = $state(0);
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let idle = $state(false);
  // El último puntero fue un dedo: controles de 44 px. Antes del primer toque, lo que diga la pantalla.
  let touchUi = $state(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let fitted: { width: number; height: number; box: AABB | null } = { width: -1, height: -1, box: null };
  let shown = '';
  let released = false;
  let closing = false;
  let wasFullscreen = false;
  let pageId: string | null = null;
  // Nodos de la página presentada: las animaciones «al presentar» de cualquiera de ellos se reproducen.
  let onPage = new Set<string>();
  let gesture: { id: number; x: number; y: number; time: number; wasIdle: boolean } | null = null;
  const cleanups: Array<() => void> = [];
  const keysId = $props.id();

  const current = $derived(slides[index] ?? null);
  const slideName = $derived(mode === 'frames' && current ? (engine.core.record(current)?.name ?? '') : '');

  onMount(() => {
    pageId = engine.core.activePage;
    slides = mode === 'page' ? (pageId ? [pageId] : []) : presentationSlides(engine);
    if (!slides.length) {
      onclose();
      return;
    }
    if (pageId) onPage = new Set(engine.core.tree.paintOrder(pageId));
    const camera = engine.camera();
    engine.follow(null);
    engine.core.stopTextEdit();
    engine.anim.stop();
    engine.renderer.setPresenting(true);
    cleanups.push(() => {
      engine.anim.stop();
      engine.anim.present(null);
      engine.renderer.setPresenting(false);
      engine.core.camera.set(camera);
      engine.core.requestFrame();
    });

    // El teclado y el portapapeles no llegan al editor mientras se presenta: sus atajos cambiarían el documento.
    const onKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.type === 'keydown') onkeydown(event);
    };
    const onClipboard = (event: Event) => event.stopImmediatePropagation();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    for (const type of ['copy', 'cut', 'paste']) window.addEventListener(type, onClipboard, true);
    cleanups.push(() => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      for (const type of ['copy', 'cut', 'paste']) window.removeEventListener(type, onClipboard, true);
    });

    // Al entrar o salir de pantalla completa cambia el margen además del tamaño.
    const onFullscreen = () => {
      if (document.fullscreenElement === host) wasFullscreen = true;
      else if (wasFullscreen) {
        close();
        return;
      }
      fit();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    cleanups.push(() => document.removeEventListener('fullscreenchange', onFullscreen));
    // Girar el dispositivo o abrir la barra del navegador en el móvil.
    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', fit);
      cleanups.push(() => viewport.removeEventListener('resize', fit));
    }
    // Sin permiso para la pantalla completa se presenta en el hueco del editor.
    if (typeof host.requestFullscreen === 'function') void host.requestFullscreen().catch(() => {});

    // Si la cámara cambia de tamaño o la diapositiva de caja (alguien la mueve o cambia el contenido), se vuelve a encajar.
    cleanups.push(
      engine.onFrame(() => {
        const { width, height } = engine.core.camera;
        if (width !== fitted.width || height !== fitted.height || !sameBox(slideBox(), fitted.box)) fit();
      }),
    );
    // Lo que otra persona añade o borra mientras se presenta.
    cleanups.push(
      engine.state.layersVersion.subscribe(() => {
        if (released || closing) return;
        if (mode === 'page') {
          if (pageId) onPage = new Set(engine.core.tree.paintOrder(pageId));
          fit();
          return;
        }
        const next = presentationSlides(engine);
        if (!next.length) {
          close(m.present_frames_gone());
          return;
        }
        const keep = current ? next.indexOf(current) : -1;
        slides = next;
        if (keep >= 0) {
          index = keep;
          fit();
        } else {
          show(Math.min(index, next.length - 1));
        }
      }),
    );
    // Otra persona borra la página: el editor pasa a otra y la presentación ya no tiene qué mostrar.
    cleanups.push(
      engine.state.pageId.subscribe((value) => {
        if (!released && !closing && value !== pageId) close(m.present_page_gone());
      }),
    );

    show(0);
    wake();
    // Si se llega desde un diálogo que se cierra a la vez, su trampa de foco lo retiene un instante: se reclama unos
    // frames más, salvo que ya esté dentro.
    let tries = 0;
    let focusFrame = 0;
    const claimFocus = () => {
      if (released) return;
      if (!root?.contains(document.activeElement)) focus();
      if (++tries < 4) focusFrame = requestAnimationFrame(claimFocus);
    };
    claimFocus();
    cleanups.push(() => cancelAnimationFrame(focusFrame));
    return release;
  });

  // Devuelve el lienzo como estaba. Editor lo llama antes de destruir el motor.
  export function release(): void {
    if (released) return;
    released = true;
    if (idleTimer) clearTimeout(idleTimer);
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    if (document.fullscreenElement === host) void document.exitFullscreen().catch(() => {});
  }

  // Para quien abrió la presentación desde un diálogo: al cerrarse, el diálogo devuelve el foco y lo trae aquí.
  export function focus(): void {
    root?.focus({ preventScroll: true });
  }

  function close(notice?: string): void {
    if (closing) return;
    closing = true;
    if (notice) showToast({ message: notice });
    onclose();
  }

  function slideBox(): AABB | null {
    if (mode === 'page') return engine.core.pageBounds();
    const id = slides[index];
    return (id && engine.core.geometryOf(id)) || null;
  }

  function sameBox(a: AABB | null, b: AABB | null): boolean {
    if (!a || !b) return a === b;
    return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
  }

  function fit(): void {
    if (released) return;
    const box = slideBox();
    const camera = engine.core.camera;
    // Una página vacía deja la cámara donde está y se ve el fondo.
    if (!box) {
      fitted = { width: camera.width, height: camera.height, box: null };
      rect = null;
      return;
    }
    const margin = document.fullscreenElement === host ? 0 : WINDOW_MARGIN;
    // Sin tamaño todavía: el siguiente frame lo vuelve a intentar.
    if (!camera.fit(box, margin, MAX_ZOOM, NO_INSETS)) {
      fitted = { width: -1, height: -1, box: null };
      return;
    }
    fitted = { width: camera.width, height: camera.height, box: { ...box } };
    engine.core.requestFrame();
    const from = engine.core.worldToScreen(box.minX, box.minY);
    const to = engine.core.worldToScreen(box.maxX, box.maxY);
    rect = { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y };
  }

  // Al entrar en una diapositiva se reproducen sus animaciones con autoplay «present» (salvo con movimiento reducido).
  function show(next: number): void {
    if (released || !slides.length) return;
    index = Math.max(0, Math.min(slides.length - 1, next));
    const slide = slides[index]!;
    // En la primera o la última, volver a pulsar no repite las animaciones.
    if (slide === shown) return;
    shown = slide;
    engine.anim.stop();
    if (mode === 'page') engine.anim.present((id, animation) => animation.autoplay === 'present' && onPage.has(id));
    else engine.anim.present((id, animation) => animation.autoplay === 'present' && (id === slide || engine.core.tree.isDescendant(id, slide)));
    fit();
    if (!motionReduced()) engine.anim.play();
  }

  function wake(): void {
    idle = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = true), IDLE_MS);
  }

  function hideControls(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    idle = true;
  }

  // Con el dedo o el lápiz no hay movimiento sin pulsar que despierte los controles: los despierta el toque.
  function onpointerdown(event: PointerEvent): void {
    touchUi = event.pointerType === 'touch';
    const wasIdle = idle;
    wake();
    if (event.pointerType === 'mouse' || !event.isPrimary) {
      gesture = null;
      return;
    }
    if (event.target instanceof Element && event.target.closest('[data-present-controls]')) {
      gesture = null;
      return;
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, wasIdle };
    try {
      root?.setPointerCapture(event.pointerId);
    } catch {
      // Un puntero que ya no está activo no se puede capturar.
    }
  }

  // Deslizar cambia de diapositiva. Un toque en el tercio izquierdo o derecho retrocede o avanza, y en el central
  // muestra u oculta los controles.
  function onpointerup(event: PointerEvent): void {
    const start = gesture;
    if (!start || event.pointerId !== start.id) return;
    gesture = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) && event.timeStamp - start.time <= SWIPE_MS) {
      show(index + (dx < 0 ? 1 : -1));
      return;
    }
    if (Math.hypot(dx, dy) > TAP_SLOP || !root) return;
    const bounds = root.getBoundingClientRect();
    const at = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    if (at < 1 / 3) show(index - 1);
    else if (at > 2 / 3) show(index + 1);
    else if (!start.wasIdle) hideControls();
  }

  function onpointercancel(event: PointerEvent): void {
    if (gesture?.id === event.pointerId) gesture = null;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const onButton = event.target instanceof HTMLButtonElement;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
        show(index + 1);
        break;
      case ' ':
        if (onButton) return;
        show(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        show(index - 1);
        break;
      case 'Home':
        show(0);
        break;
      case 'End':
        show(slides.length - 1);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        trapFocus(event);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  // El foco no sale de la presentación (fuera de pantalla completa el resto del editor sigue en la página).
  function trapFocus(event: KeyboardEvent): void {
    const buttons = [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (!buttons.length) return;
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const BUTTON =
    'inline-flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-surface-2 touch:size-11 aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted';
</script>

<div
  bind:this={root}
  role="dialog"
  aria-modal="true"
  aria-label={m.present_label()}
  aria-describedby={keysId}
  tabindex="-1"
  onpointermove={wake}
  {onpointerdown}
  {onpointerup}
  {onpointercancel}
  onfocusin={wake}
  class={['absolute inset-0 z-(--z-stage) touch-none overflow-hidden outline-none select-none', idle ? 'cursor-none' : '', touchUi ? 'touch-ui' : '']}
  data-testid="present"
  data-mode={mode}
>
  {#if mode === 'frames'}
    {#if rect}
      <!-- Lo que queda fuera del frame se tapa: la sombra cubre el resto de la pantalla. -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute"
        style:left="{rect.x}px"
        style:top="{rect.y}px"
        style:width="{rect.w}px"
        style:height="{rect.h}px"
        style:box-shadow="0 0 0 100vmax #000"
      ></div>
    {:else}
      <div aria-hidden="true" class="absolute inset-0 bg-black"></div>
    {/if}
  {/if}

  <p id={keysId} class="sr-only">{touchUi ? m.present_touch_keys() : m.present_keys()}</p>
  <p class="sr-only" aria-live="polite" aria-atomic="true">
    {m.present_slide({ current: index + 1, total: slides.length })}{slideName ? `. ${slideName}` : ''}
  </p>

  <div
    data-present-controls
    class={[
      'absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface-1 p-1 shadow-float transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100',
      idle ? 'pointer-events-none opacity-0' : 'opacity-100',
    ]}
  >
    <button type="button" aria-label={m.present_prev()} aria-disabled={index === 0} onclick={() => show(index - 1)} class={[BUTTON, 'text-ink']}>
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
    <span aria-hidden="true" class="min-w-14 px-1 text-center text-xs text-ink-muted tabular" data-testid="present-counter">{index + 1} / {slides.length}</span>
    <button
      type="button"
      aria-label={m.present_next()}
      aria-disabled={index >= slides.length - 1}
      onclick={() => show(index + 1)}
      class={[BUTTON, 'text-ink']}
    >
      <ChevronRight size={18} aria-hidden="true" />
    </button>
    <button type="button" aria-label={m.present_exit()} onclick={() => close()} class={[BUTTON, 'text-ink-muted hover:text-ink']}>
      <X size={18} aria-hidden="true" />
    </button>
  </div>
</div>
