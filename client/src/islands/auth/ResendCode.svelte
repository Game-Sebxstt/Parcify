<script lang="ts">
  import { onDestroy } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import LinkButton from './LinkButton.svelte';
  import { RESEND_SECONDS } from './validate.ts';

  type Props = { onResend: () => Promise<boolean> };

  let { onResend }: Props = $props();

  let remaining = $state(RESEND_SECONDS);
  let sending = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  function startCountdown() {
    clearInterval(timer);
    remaining = RESEND_SECONDS;
    timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
  }

  startCountdown();
  onDestroy(() => clearInterval(timer));

  async function resend() {
    sending = true;
    const sent = await onResend();
    sending = false;
    if (sent) startCountdown();
  }
</script>

<div class="text-sm">
  {#if remaining > 0}
    <p class="tabular text-ink-muted">{m.auth_resend_in({ seconds: remaining })}</p>
  {:else}
    <LinkButton onclick={resend} disabled={sending}>{m.auth_resend()}</LinkButton>
  {/if}
</div>
