<script lang="ts">
  import type { Hud } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import { formatTime } from './timeline/model.ts';

  type Props = {
    // El navegador perdió el contexto WebGL y el lienzo espera a que lo devuelva.
    restoring: boolean;
    // Píldora de tamaño o de ángulo bajo la selección (null sin selección con caja).
    hud: Hud | null;
    // El último puntero fue un dedo: al imantar el giro, el móvil vibra.
    touch: boolean;
    // La línea o el conector seleccionado ya no admite más puntos.
    pointLimit: boolean;
    // Grabar encendido: instante del cabezal en ms (null si no se graba todo).
    recording: number | null;
    // Hueco del lienzo que dejan los paneles y la línea de tiempo, en px desde cada borde.
    area: { left: number; right: number; bottom: number };
  };

  let { restoring, hud, touch, pointLimit, recording, area }: Props = $props();

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

{#if recording !== null}
  <!-- Estado real, no decoración: sin pulso. El botón Grabar de la línea de tiempo ya lo anuncia. -->
  <div
    class="pointer-events-none absolute top-0 border-2 border-danger"
    style:left="{area.left}px"
    style:right="{area.right}px"
    style:bottom="{area.bottom}px"
    aria-hidden="true"
    data-testid="recording-frame"
  >
    <p class="absolute top-3 left-1/2 h-6 -translate-x-1/2 rounded-full bg-danger/15 px-2.5 text-xs leading-6 font-semibold whitespace-nowrap text-danger tabular-nums">
      {m.editor_recording_pill({ time: formatTime(recording) })}
    </p>
  </div>
{/if}

<!-- Las regiones existen siempre para que el lector de pantalla anuncie el aviso al aparecer. -->
<div class="pointer-events-none absolute inset-0 grid place-items-center">
  <div role="status">
    {#if restoring}
      <p class="rounded-panel bg-surface-2 px-4 py-3 text-sm shadow-float">{m.editor_canvas_restoring()}</p>
    {/if}
  </div>
</div>
<div class="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
  <div role="status" data-testid="point-limit">
    {#if pointLimit}
      <p class="rounded-panel bg-surface-2 px-3 py-1.5 text-xs text-ink-muted shadow-float">{m.editor_point_limit()}</p>
    {/if}
  </div>
</div>
