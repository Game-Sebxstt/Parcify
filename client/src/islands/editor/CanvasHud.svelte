<script lang="ts">
  import { m } from '../../paraglide/messages.js';

  type Props = {
    // El navegador perdió el contexto WebGL y el lienzo espera a que lo devuelva.
    restoring: boolean;
  };

  let { restoring }: Props = $props();
</script>

<!-- La región existe siempre para que el lector de pantalla anuncie el aviso al aparecer. -->
<div class="pointer-events-none absolute inset-0 grid place-items-center">
  <div role="status">
    {#if restoring}
      <p class="rounded-panel bg-surface-2 px-4 py-3 text-sm shadow-float">{m.editor_canvas_restoring()}</p>
    {/if}
  </div>
</div>
