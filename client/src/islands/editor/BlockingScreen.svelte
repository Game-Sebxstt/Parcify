<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';

  type Props = { title: string; body: string; reload?: boolean };

  let { title, body, reload = false }: Props = $props();
</script>

<main class="grid h-dvh place-items-center px-6">
  <div class="flex max-w-md flex-col items-start gap-4" role="alert">
    <h1 class="text-lg font-semibold">{title}</h1>
    <p class="text-sm text-ink-muted">{body}</p>
    {#if reload}
      <Button variant="primary" onclick={() => window.location.reload()}>{m.common_reload()}</Button>
    {:else}
      <Button variant="primary" href="/app">{m.editor_back()}</Button>
    {/if}
  </div>
</main>
