<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch, queryString } from '../../lib/api.ts';
  import { describeUserAgent, formatDate } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import { SecurityEventsResponseSchema, type SecurityEvent } from '../../shared/api/me.js';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';

  let events = $state<SecurityEvent[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingMore = $state(false);

  const TITLES: Record<SecurityEvent['type'], () => string> = {
    'security.session_created': m.security_session_created,
    'security.session_revoked': m.security_session_revoked,
    'security.email_changed': m.security_email_changed,
    'security.password_changed': m.security_password_changed,
    'security.account_linked': m.security_account_linked,
  };

  // Recargar el historial cuando cambian las sesiones desde otra sección.
  export function refresh() {
    void load();
  }

  onMount(() => void load());

  async function load(more = false) {
    if (more) loadingMore = true;
    else status = 'loading';
    try {
      const params = queryString({ limit: '10', cursor: more ? nextCursor : null });
      const page = await apiFetch(`/v1/me/security-events?${params}`, { schema: SecurityEventsResponseSchema });
      events = more ? [...events, ...page.items] : page.items;
      nextCursor = page.nextCursor;
      status = 'ready';
    } catch {
      if (!more) status = 'error';
    } finally {
      loadingMore = false;
    }
  }

  function detail(event: SecurityEvent) {
    const parts: string[] = [];
    if (event.provider === 'google') parts.push('Google');
    const { browser, system } = describeUserAgent(event.userAgent);
    if (browser && system) parts.push(m.settings_session_device({ browser, system }));
    if (event.ipAddress) parts.push(event.ipAddress);
    parts.push(formatDate(event.createdAt, { dateStyle: 'medium', timeStyle: 'short' }));
    return parts.join(' · ');
  }
</script>

<section aria-labelledby="security-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <h2 id="security-heading" class="text-lg font-semibold">{m.settings_security_log()}</h2>
  <p class="mt-1 text-sm text-ink-muted">{m.settings_security_log_lead()}</p>
  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.settings_security_loading()}</p>
    <div class="mt-4 flex flex-col gap-2" aria-hidden="true"><Skeleton class="h-10 w-full" /><Skeleton class="h-10 w-full" /></div>
  {:else if status === 'error'}
    <div role="alert" class="mt-4 flex flex-col items-start gap-3">
      <p class="text-sm">{m.settings_security_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else if events.length === 0}
    <p class="mt-4 text-sm">{m.settings_security_empty()}</p>
  {:else}
    <ul class="mt-4 flex flex-col" aria-label={m.settings_security_log()}>
      {#each events as event (event.id)}
        <li class="flex flex-col gap-0.5 py-2.5">
          <p class="text-sm font-medium">{TITLES[event.type]()}</p>
          <p class="text-xs text-ink-muted">{detail(event)}</p>
        </li>
      {/each}
    </ul>
    {#if nextCursor}
      <div class="mt-3"><Button size="sm" loading={loadingMore} onclick={() => void load(true)}>{m.dashboard_load_more()}</Button></div>
    {/if}
  {/if}
</section>
