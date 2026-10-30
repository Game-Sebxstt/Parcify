<script lang="ts">
  import type { Hud } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';

  type Props = {
    // El navegador perdió el contexto WebGL y el lienzo espera a que lo devuelva.
    restoring: boolean;
    // Píldora de tamaño o de ángulo bajo la selección (null sin selección con caja).
    hud: Hud | null;
    // El último puntero fue un dedo: al imantar el giro, el móvil vibra.
    touch: boolean;
  };

  let { restoring, hud, touch }: Props = $props();

  const snapped = $derived(hud?.kind === 'angle' && hud.snapped);
  let wasSnapped = false;

  // Solo al entrar en el imán, no en cada frame que sigue imantado.
  $effect(() => {
    if (snapped && !wasSnapped && touch) navigator.vibrate?.(10);
    wasSnapped = snapped;
  });
</script>

{#if hud}
  <div
    class={[
      'pointer-events-none absolute top-0 left-0 h-5 rounded-xs px-1.5 text-2xs leading-5 font-semibold whitespace-nowrap tabular-nums',
      snapped ? 'bg-sage text-ground' : 'bg-coral text-coral-ink',
    ]}
    style:transform={`translate(${hud.x}px, ${hud.y}px) translate(-50%, ${hud.above ? '-100%' : '0'})`}
    data-testid="canvas-hud"
    data-kind={hud.kind}
    data-snapped={snapped}
    aria-hidden="true"
  >
    {hud.text}
  </div>
{/if}

<!-- La región existe siempre para que el lector de pantalla anuncie el aviso al aparecer. -->
<div class="pointer-events-none absolute inset-0 grid place-items-center">
  <div role="status">
    {#if restoring}
      <p class="rounded-panel bg-surface-2 px-4 py-3 text-sm shadow-float">{m.editor_canvas_restoring()}</p>
    {/if}
  </div>
</div>
