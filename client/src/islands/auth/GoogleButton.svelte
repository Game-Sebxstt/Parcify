<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import type { StepContext } from './context.ts';
  import { describeFailure } from './validate.ts';

  type Props = { ctx: StepContext; onError: (message: string) => void };

  let { ctx, onError }: Props = $props();
  let pending = $state(false);

  async function start() {
    pending = true;
    const origin = window.location.origin;
    const result = await ctx.actions.signInWithGoogle(
      `${origin}${ctx.returnTo ?? '/app'}`,
      `${origin}/?acceso=entrar&error=google`,
    );
    // Si todo va bien, el navegador ya está saliendo hacia Google.
    if (!result.ok) {
      pending = false;
      onError(describeFailure(result).message);
    }
  }
</script>

<Button variant="secondary" class="w-full" loading={pending} onclick={start}>
  <svg viewBox="0 0 24 24" class="size-4.5" aria-hidden="true">
    <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
  </svg>
  {m.auth_google()}
</Button>
