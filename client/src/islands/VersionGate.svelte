<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '../paraglide/messages.js';
  import { checkClientVersion, clientVersion } from '../lib/session.svelte.ts';
  import Button from '../ui/Button.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);

  onMount(() => {
    void checkClientVersion();
  });

  $effect(() => {
    if (clientVersion.reloadRequired && dialog && !dialog.open) dialog.showModal();
  });
</script>

<!-- Bloqueante: Escape no lo cierra; solo se sale recargando. -->
<dialog
  bind:this={dialog}
  aria-labelledby="version-title"
  aria-describedby="version-body"
  oncancel={(event) => event.preventDefault()}
  class="m-auto w-[min(24rem,calc(100vw-1.5rem))] rounded-panel bg-surface-1 p-6 text-ink shadow-float"
>
  <h2 id="version-title" class="text-lg font-semibold">{m.reload_required_title()}</h2>
  <p id="version-body" class="mt-2 text-sm text-ink-muted">{m.reload_required_body()}</p>
  <div class="mt-5 flex justify-end">
    <Button variant="primary" onclick={() => window.location.reload()}>{m.common_reload()}</Button>
  </div>
</dialog>
