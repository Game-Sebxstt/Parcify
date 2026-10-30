<script lang="ts">
  import { easingFn } from '../../../engine/index.ts';
  import type { Keyframe } from '../../../shared/document/schema.js';

  // Tamaño en pantalla (px), con 4 px de margen alrededor de la curva.
  type Props = { easing: Keyframe['e']; label: string; width?: number; height?: number };

  let { easing, label, width = 112, height = 112 }: Props = $props();

  const SAMPLES = 48;
  const w = $derived(width - 8);
  const h = $derived(height - 8);

  // Muestras de la curva; el eje vertical se amplía si la curva se sale de 0..1 (rebote).
  const curve = $derived.by(() => {
    const fn = easingFn(easing);
    const points = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const x = i / SAMPLES;
      return { x, y: fn(x) };
    });
    const low = Math.min(0, ...points.map((point) => point.y));
    const high = Math.max(1, ...points.map((point) => point.y));
    const toY = (y: number) => h - ((y - low) / (high - low)) * h;
    const path = points.map((point, i) => `${i ? 'L' : 'M'}${(point.x * w).toFixed(1)} ${toY(point.y).toFixed(1)}`).join(' ');
    return { path, zero: toY(0), one: toY(1) };
  });
</script>

<svg role="img" aria-label={label} viewBox="-4 -4 {width} {height}" {width} {height} class="shrink-0 rounded-[6px] bg-surface-2">
  <line x1="0" x2={w} y1={curve.zero} y2={curve.zero} class="stroke-petrol" stroke-width="1" />
  <line x1="0" x2={w} y1={curve.one} y2={curve.one} class="stroke-petrol" stroke-width="1" />
  <path d={curve.path} fill="none" class="stroke-coral" stroke-width="2" stroke-linejoin="round" />
</svg>
