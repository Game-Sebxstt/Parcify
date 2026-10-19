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
  import { motionReduced } from '../../lib/motion.ts';
  import { m } from '../../paraglide/messages.js';

  type Props = {
    engine: Engine;
    // Lo que pasa a pantalla completa: el lienzo y esta capa encima.
    host: HTMLElement;
    onclose: () => void;
  };

  let { engine, host, onclose }: Props = $props();

  // Los controles se ocultan tras un rato sin mover el puntero.
  const IDLE_MS = 2500;

  let root = $state<HTMLDivElement | null>(null);
  let slides = $state.raw<string[]>([]);
  let index = $state(0);
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let fitted = { width: -1, height: -1 };
  let shown = '';
  let released = false;
  let wasFullscreen = false;
  const cleanups: Array<() => void> = [];
  const keysId = $props.id();

  const current = $derived(slides[index] ?? null);
  const slideName = $derived(current ? (engine.core.record(current)?.name ?? '') : '');

  onMount(() => {
    slides = presentationSlides(engine);
    if (!slides.length) {
      onclose();
      return;
    }
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

    const onFullscreen = () => {
      if (document.fullscreenElement === host) wasFullscreen = true;
      else if (wasFullscreen) onclose();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    cleanups.push(() => document.removeEventListener('fullscreenchange', onFullscreen));
    // Sin permiso para la pantalla completa se presenta en el hueco del lienzo.
    if (typeof host.requestFullscreen === 'function') void host.requestFullscreen().catch(() => {});

    // Al cambiar el tamaño (al entrar en pantalla completa, por ejemplo) se vuelve a encajar el frame.
    cleanups.push(
      engine.onFrame(() => {
        const { width, height } = engine.core.camera;
        if (width !== fitted.width || height !== fitted.height) fit();
      }),
    );
    // Un frame borrado o añadido por otra persona mientras se presenta.
    cleanups.push(
      engine.state.layersVersion.subscribe(() => {
        if (released) return;
        const next = presentationSlides(engine);
        if (!next.length) {
          onclose();
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

    show(0);
    wake();
    root?.focus();
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

  function fit(): void {
    const id = slides[index];
    const box = id ? engine.core.geometryOf(id) : undefined;
    const camera = engine.core.camera;
    fitted = { width: camera.width, height: camera.height };
    if (!box) {
      rect = null;
      return;
    }
    camera.fit(box, 0, MAX_ZOOM);
    engine.core.requestFrame();
    const from = engine.core.worldToScreen(box.minX, box.minY);
    const to = engine.core.worldToScreen(box.maxX, box.maxY);
    rect = { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y };
  }

  // Al entrar en un frame se reproducen sus animaciones con autoplay «present» (salvo con movimiento reducido).
  function show(next: number): void {
    if (released || !slides.length) return;
    index = Math.max(0, Math.min(slides.length - 1, next));
    const frame = slides[index]!;
    // En la primera o la última, volver a pulsar no repite las animaciones.
    if (frame === shown) return;
    shown = frame;
    engine.anim.stop();
    engine.anim.present((id, animation) => animation.autoplay === 'present' && (id === frame || engine.core.tree.isDescendant(id, frame)));
    fit();
    if (!motionReduced()) engine.anim.play();
  }

  function wake(): void {
    idle = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = true), IDLE_MS);
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
        onclose();
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
</script>

<div
  bind:this={root}
  role="dialog"
  aria-modal="true"
  aria-label={m.present_label()}
  aria-describedby={keysId}
  tabindex="-1"
  onpointermove={wake}
  onfocusin={wake}
  class={['absolute inset-0 z-40 overflow-hidden outline-none', idle ? 'cursor-none' : ''].join(' ')}
  data-testid="present"
>
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

  <p id={keysId} class="sr-only">{m.present_keys()}</p>
  <p class="sr-only" aria-live="polite" aria-atomic="true">
    {m.present_slide({ current: index + 1, total: slides.length })}{slideName ? `. ${slideName}` : ''}
  </p>

  <div
    class={[
      'absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface-1 p-1 shadow-float transition-opacity duration-200 focus-within:opacity-100',
      idle ? 'opacity-0' : 'opacity-100',
    ].join(' ')}
  >
    <button
      type="button"
      aria-label={m.present_prev()}
      aria-disabled={index === 0}
      onclick={() => show(index - 1)}
      class="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted"
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
    <span aria-hidden="true" class="min-w-14 px-1 text-center text-xs text-ink-muted tabular" data-testid="present-counter">{index + 1} / {slides.length}</span>
    <button
      type="button"
      aria-label={m.present_next()}
      aria-disabled={index >= slides.length - 1}
      onclick={() => show(index + 1)}
      class="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted"
    >
      <ChevronRight size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      aria-label={m.present_exit()}
      onclick={onclose}
      class="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <X size={18} aria-hidden="true" />
    </button>
  </div>
</div>
