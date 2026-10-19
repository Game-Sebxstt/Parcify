<script lang="ts">
  import { onMount } from 'svelte';
  import { attachDemo, landing } from '../landing/state.svelte.ts';
  import { m } from '../paraglide/messages.js';

  let container = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);

  onMount(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const start = async () => {
      if (cancelled || !canvas || !container) return;
      try {
        // El motor (Pixi y Yjs) llega aparte, cuando el navegador está libre.
        const { mountLandingDemo } = await import('../landing/live.ts');
        if (cancelled) return;
        const reducedMotion =
          window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === '1';
        const demo = await mountLandingDemo({ canvas, container, reducedMotion, anaName: 'Ana', visitorName: m.landing_visitor() });
        if (cancelled) {
          demo.destroy();
          return;
        }
        let samples: number[] = [];
        const stopFrames = demo.onFrameWork((ms) => {
          samples.push(ms);
          if (samples.length < 20) return;
          landing.frameMs = samples.reduce((a, b) => a + b, 0) / samples.length;
          samples = [];
        });
        // Ana solo se mueve sin pausa del visitante, con el hero a la vista y la pestaña delante.
        landing.paused = reducedMotion;
        let inView = true;
        const sync = () => demo.setPlaying(!landing.paused && inView && !document.hidden);
        const observer = new IntersectionObserver(([entry]) => {
          inView = entry?.isIntersecting ?? inView;
          sync();
        });
        observer.observe(container);
        document.addEventListener('visibilitychange', sync);
        sync();
        attachDemo(demo, sync);
        cleanup = () => {
          observer.disconnect();
          document.removeEventListener('visibilitychange', sync);
          stopFrames();
          attachDemo(null);
          demo.destroy();
        };
      } catch {
        // Sin WebGL se queda la captura estática.
      }
    };
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
    idle(() => void start(), { timeout: 2000 });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  });
</script>

<img
  src="/landing/lienzo.png"
  alt={m.landing_canvas_capture_alt()}
  width="1200"
  height="1200"
  fetchpriority="high"
  data-ui
  class={['landing-capture', landing.ready ? 'is-hidden' : ''].join(' ')}
/>
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={container}
  role="application"
  tabindex={landing.ready ? 0 : -1}
  aria-label={m.landing_canvas_label()}
  aria-hidden={!landing.ready}
  data-testid="landing-canvas"
  class={['landing-live', landing.ready ? 'is-ready' : ''].join(' ')}
>
  <canvas bind:this={canvas}></canvas>
</div>
