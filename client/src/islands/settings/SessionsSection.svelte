<script lang="ts">
  import { onMount } from 'svelte';
  import type { AccountActions, AuthSessionItem } from '../../lib/auth.ts';
  import { describeUserAgent, formatRelative } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { describeFailure } from '../auth/validate.ts';

  type Props = { actions: AccountActions; onrevoked: () => void };
  let { actions, onrevoked }: Props = $props();

  let sessions = $state<AuthSessionItem[]>([]);
  let currentToken = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let busy = $state<string | null>(null);

  onMount(() => void load());

  async function load() {
    status = 'loading';
    const [list, token] = await Promise.all([actions.listSessions(), actions.currentSessionToken()]);
    if (!list.ok) {
      status = 'error';
      return;
    }
    currentToken = token;
    sessions = [...list.data].sort((a, b) => {
      if (a.token === token) return -1;
      if (b.token === token) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    status = 'ready';
  }

  function label(item: AuthSessionItem) {
    const { browser, system } = describeUserAgent(item.userAgent);
    if (browser && system) return m.settings_session_device({ browser, system });
    return browser ?? system ?? m.settings_session_unknown();
  }

  async function revokeOthers() {
    busy = 'others';
    const result = await actions.revokeOtherSessions();
    busy = null;
    if (!result.ok) {
      showToast({ message: describeFailure(result).message, tone: 'error' });
      return;
    }
    showToast({ message: m.settings_sessions_revoked(), tone: 'success' });
    await load();
    onrevoked();
  }

  async function revoke(item: AuthSessionItem) {
    busy = item.token;
    const result = await actions.revokeSession(item.token);
    busy = null;
    if (!result.ok) {
      showToast({ message: describeFailure(result).message, tone: 'error' });
      return;
    }
    sessions = sessions.filter((session) => session.token !== item.token);
    onrevoked();
  }

  const others = $derived(sessions.filter((item) => item.token !== currentToken).length);
</script>

<section aria-labelledby="sessions-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 id="sessions-heading" class="text-lg font-semibold">{m.settings_sessions()}</h2>
    {#if others > 0}
      <Button size="sm" loading={busy === 'others'} onclick={() => void revokeOthers()}>{m.settings_sessions_revoke_others()}</Button>
    {/if}
  </div>
  <p class="mt-1 text-sm text-ink-muted">{m.settings_sessions_lead()}</p>

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.settings_sessions_loading()}</p>
    <div class="mt-4 flex flex-col gap-2" aria-hidden="true"><Skeleton class="h-14 w-full" /><Skeleton class="h-14 w-full" /></div>
  {:else if status === 'error'}
    <div role="alert" class="mt-4 flex flex-col items-start gap-3">
      <p class="text-sm">{m.settings_sessions_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else}
    <ul class="mt-4 flex flex-col gap-1" aria-label={m.settings_sessions()}>
      {#each sessions as item (item.id)}
        <li class="flex flex-wrap items-center gap-3 rounded-panel bg-surface-2 px-4 py-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">
              {label(item)}{#if item.token === currentToken}<span class="font-normal text-sage"> · {m.settings_session_this()}</span>{/if}
            </p>
            <p class="text-xs text-ink-muted">
              {item.ipAddress ? `${item.ipAddress} · ` : ''}{m.settings_session_active({ when: formatRelative(item.updatedAt) })}
            </p>
          </div>
          {#if item.token !== currentToken}
            <Button size="sm" variant="ghost" loading={busy === item.token} onclick={() => void revoke(item)}>
              {m.settings_session_revoke()}
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
