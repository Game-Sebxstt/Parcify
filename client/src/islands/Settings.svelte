<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch, cached } from '../lib/api.ts';
  import type { AccountActions, LinkedAccount } from '../lib/auth.ts';
  import { lazyAccountActions } from '../lib/auth-lazy.ts';
  import { loadSession, session } from '../lib/session.svelte.ts';
  import { m } from '../paraglide/messages.js';
  import { MetaResponseSchema } from '../shared/api/meta.js';
  import Button from '../ui/Button.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import { showToast } from '../ui/toast.svelte.ts';
  import AccountsSection from './settings/AccountsSection.svelte';
  import DeleteAccountSection from './settings/DeleteAccountSection.svelte';
  import EmailSection from './settings/EmailSection.svelte';
  import PasswordSection from './settings/PasswordSection.svelte';
  import PreferencesSection from './settings/PreferencesSection.svelte';
  import ProfileSection from './settings/ProfileSection.svelte';
  import SecurityLog from './settings/SecurityLog.svelte';
  import SessionsSection from './settings/SessionsSection.svelte';

  type Props = { actions?: AccountActions };
  let { actions = lazyAccountActions }: Props = $props();

  let accounts = $state<LinkedAccount[]>([]);
  let accountsStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let googleEnabled = $state(false);
  let log = $state<{ refresh: () => void } | null>(null);

  const hasPassword = $derived(accounts.some((account) => account.providerId === 'credential'));

  onMount(() => {
    const url = new URL(window.location.href);
    const linked = url.searchParams.get('vinculada');
    const failed = url.searchParams.get('error');
    if (linked || failed) {
      url.searchParams.delete('vinculada');
      url.searchParams.delete('error');
      history.replaceState(history.state, '', `${url.pathname}${url.search}`);
      if (linked === 'google') showToast({ message: m.settings_google_linked_now(), tone: 'success' });
      if (failed === 'google') showToast({ message: m.auth_error_google(), tone: 'error' });
    }
    void loadSession();
    void loadAccounts();
    void cached('meta', () => apiFetch('/v1/meta', { schema: MetaResponseSchema, redirectOn401: false }))
      .then((meta) => (googleEnabled = meta.authProviders.includes('google')))
      .catch(() => (googleEnabled = false));
  });

  async function loadAccounts() {
    accountsStatus = 'loading';
    const result = await actions.listAccounts();
    if (!result.ok) {
      accountsStatus = 'error';
      return;
    }
    accounts = result.data;
    accountsStatus = 'ready';
  }

  function changed() {
    void loadAccounts();
    log?.refresh();
  }
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-8">
  <h1 class="mb-2 text-xl font-bold">{m.settings_title()}</h1>
  {#if session.status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3">
      <p>{m.app_load_error()}</p>
      <Button onclick={() => window.location.reload()}>{m.common_retry()}</Button>
    </div>
  {:else if !session.me}
    <p class="sr-only" role="status">{m.app_checking_session()}</p>
    <Skeleton class="h-56 w-full" />
    <Skeleton class="h-32 w-full" />
  {:else}
    {@const me = session.me}
    <ProfileSection {me} />
    <EmailSection email={me.user.email} {actions} />
    {#if accountsStatus === 'error'}
      <div role="alert" class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-5">
        <p class="text-sm">{m.settings_accounts_error()}</p>
        <Button size="sm" onclick={() => void loadAccounts()}>{m.common_retry()}</Button>
      </div>
    {:else if accountsStatus === 'loading'}
      <Skeleton class="h-40 w-full" />
    {:else}
      <PasswordSection {hasPassword} {actions} onchanged={changed} />
      <AccountsSection {accounts} {googleEnabled} {actions} onchanged={changed} />
    {/if}
    <SessionsSection {actions} onrevoked={() => log?.refresh()} />
    <SecurityLog bind:this={log} />
    <PreferencesSection {me} />
    <DeleteAccountSection {me} {hasPassword} {googleEnabled} />
  {/if}
</div>
