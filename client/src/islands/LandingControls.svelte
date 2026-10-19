<script lang="ts">
  import { landing, toggleMany, togglePaused } from '../landing/state.svelte.ts';
  import { formatNumber } from '../lib/format.ts';
  import { m } from '../paraglide/messages.js';

  let toggled = $state(false);

  // La cifra del fotograma cambia varias veces por segundo: se ve, pero solo se anuncian los cambios de estado.
  const status = $derived(
    !landing.ready
      ? m.landing_canvas_loading()
      : toggled
        ? landing.many
          ? m.landing_many_added()
          : m.landing_many_removed()
        : m.landing_canvas_hint(),
  );
</script>

<div class="landing-controls">
  <button
    type="button"
    class="btn btn-ink"
    aria-pressed={landing.many}
    disabled={!landing.ready}
    onclick={() => {
      toggleMany();
      toggled = true;
    }}
  >
    {landing.many ? m.landing_many_remove() : m.landing_many_add({ count: formatNumber(1000, { useGrouping: 'always' }) })}
  </button>
  <button type="button" class="btn btn-ink" disabled={!landing.ready} onclick={togglePaused}>
    {landing.paused ? m.landing_resume() : m.landing_pause()}
  </button>
  <p>
    {#if landing.frameMs !== null}
      {m.landing_frame({ ms: formatNumber(landing.frameMs, { maximumFractionDigits: 1 }) })}
    {:else if landing.ready}
      {m.landing_canvas_hint()}
    {:else}
      {m.landing_canvas_loading()}
    {/if}
  </p>
  <p class="sr-only" aria-live="polite">{status}</p>
</div>
