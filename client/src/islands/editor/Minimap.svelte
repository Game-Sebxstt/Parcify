<script lang="ts">
  import { untrack } from 'svelte';
  import type { Engine } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';

  type Props = { engine: Engine };

  let { engine }: Props = $props();

  const WIDTH = 200;
  const HEIGHT = 140;
  const PADDING = 8;
  const REFRESH_MS = 500;
  const BOX_COLOR = 'rgba(167, 179, 194, 0.55)';
  const VIEW_COLOR = '#fb8f5a';

  let canvas = $state<HTMLCanvasElement | null>(null);
  // Transformación de mundo a minimapa del último dibujo, para convertir los clics.
  let scale = 1;
  let originX = 0;
  let originY = 0;
  let dragging = false;

  // Se repinta cada 500 ms, y solo si cambiaron los nodos, la cámara o la página.
  $effect(() => {
    const target = canvas;
    const source = engine;
    if (!target) return;
    return untrack(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      target.width = WIDTH * dpr;
      target.height = HEIGHT * dpr;
      const context = target.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      let last = '';
      const draw = () => {
        const core = source.core;
        const key = `${core.contentVersion}:${core.camera.version}:${core.activePage}`;
        if (key === last) return;
        last = key;
        paint(context);
      };
      draw();
      const timer = setInterval(draw, REFRESH_MS);
      return () => clearInterval(timer);
    });
  });

  function paint(context: CanvasRenderingContext2D) {
    const core = engine.core;
    const view = core.camera.viewport();
    let minX = view.minX;
    let minY = view.minY;
    let maxX = view.maxX;
    let maxY = view.maxY;
    core.forEachBox((box) => {
      if (box.minX < minX) minX = box.minX;
      if (box.minY < minY) minY = box.minY;
      if (box.maxX > maxX) maxX = box.maxX;
      if (box.maxY > maxY) maxY = box.maxY;
    });
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    scale = Math.min((WIDTH - PADDING * 2) / w, (HEIGHT - PADDING * 2) / h);
    originX = minX - (WIDTH / scale - w) / 2;
    originY = minY - (HEIGHT / scale - h) / 2;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = BOX_COLOR;
    // A esta escala cada caja ocupa al menos un píxel.
    core.forEachBox((box) => {
      context.fillRect(
        (box.minX - originX) * scale,
        (box.minY - originY) * scale,
        Math.max(1, (box.maxX - box.minX) * scale),
        Math.max(1, (box.maxY - box.minY) * scale),
      );
    });
    context.strokeStyle = VIEW_COLOR;
    context.lineWidth = 1.5;
    context.strokeRect((view.minX - originX) * scale, (view.minY - originY) * scale, (view.maxX - view.minX) * scale, (view.maxY - view.minY) * scale);
  }

  function moveTo(event: PointerEvent) {
    const rect = canvas!.getBoundingClientRect();
    engine.core.centerOn(originX + (event.clientX - rect.left) / scale, originY + (event.clientY - rect.top) / scale);
  }
</script>

<section aria-label={m.editor_minimap()} class="rounded-panel bg-surface-1/95 p-1 shadow-float" data-testid="minimap">
  <p class="sr-only">{m.editor_minimap_hint()}</p>
  <canvas
    bind:this={canvas}
    aria-hidden="true"
    style:width="{WIDTH}px"
    style:height="{HEIGHT}px"
    class="block cursor-pointer touch-none rounded-[6px] bg-ground"
    onpointerdown={(event) => {
      dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      moveTo(event);
    }}
    onpointermove={(event) => {
      if (dragging) moveTo(event);
    }}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
  ></canvas>
</section>
