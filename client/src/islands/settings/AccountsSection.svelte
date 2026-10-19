<script lang="ts">
  import type { AccountActions, LinkedAccount } from '../../lib/auth.ts';
  import { formatDate } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { describeFailure } from '../auth/validate.ts';

  type Props = {
    accounts: LinkedAccount[];
    googleEnabled: boolean;
    actions: AccountActions;
    onchanged: () => void;
  };
  let { accounts, googleEnabled, actions, onchanged }: Props = $props();

  let busy = $state(false);

  const google = $derived(accounts.find((account) => account.providerId === 'google') ?? null);
  const hasPassword = $derived(accounts.some((account) => account.providerId === 'credential'));

  async function link() {
    busy = true;
    const origin = window.location.origin;
    const result = await actions.linkGoogle(`${origin}/app/ajustes?vinculada=google`, `${origin}/app/ajustes?error=google`);
    // Si va bien, el navegador ya está saliendo hacia Google.
    if (!result.ok) {
      busy = false;
      showToast({ message: describeFailure(result).message, tone: 'error' });
    }
  }

  async function unlink() {
    busy = true;
    const result = await actions.unlinkAccount(google?.id ?? '');
    busy = false;
    if (!result.ok) {
      const message = result.code === 'SESSION_NOT_FRESH' ? m.error_session_not_fresh() : describeFailure(result).message;
      showToast({ message, tone: 'error' });
      return;
    }
    showToast({ message: m.settings_google_unlinked(), tone: 'success' });
    onchanged();
  }
</script>

<section aria-labelledby="accounts-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <h2 id="accounts-heading" class="text-lg font-semibold">{m.settings_accounts()}</h2>
  <div class="mt-4 flex flex-wrap items-center gap-3 rounded-panel bg-surface-2 px-4 py-3">
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold">Google</p>
      <p class="text-xs text-ink-muted">
        {#if google}
          {m.settings_google_linked({ date: formatDate(google.createdAt) })}
        {:else if googleEnabled}
          {m.settings_google_not_linked()}
        {:else}
          {m.settings_google_unavailable()}
        {/if}
      </p>
    </div>
    {#if google}
      {#if hasPassword}
        <Button size="sm" variant="ghost" loading={busy} onclick={() => void unlink()}>{m.settings_google_unlink()}</Button>
      {:else}
        <p class="text-xs text-ink-muted">{m.settings_google_only_method()}</p>
      {/if}
    {:else if googleEnabled}
      <Button size="sm" loading={busy} onclick={() => void link()}>{m.settings_google_link()}</Button>
    {/if}
  </div>
</section>
