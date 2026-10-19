<script lang="ts">
  import { untrack } from 'svelte';
  import { formatDate } from '../../lib/format.ts';
  import { createShareLink, listShareLinks, revokeShareLink, type ShareLink, type ShareLinkRole } from '../../lib/sharing.ts';
  import { m } from '../../paraglide/messages.js';
  import { SHARE_LINK_MAX_USES, SHARE_LINK_ROLES } from '../../shared/api/share-links.js';
  import Button from '../../ui/Button.svelte';
  import Input from '../../ui/Input.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { PROJECT_ROLE_LABEL, SELECT_CLASS } from './roles.ts';

  type Props = { projectId: string; fail: (error: unknown) => void; version: number };
  let { projectId, fail, version }: Props = $props();

  const uid = $props.id();
  const DAYS = [1, 7, 30] as const;

  let links = $state<ShareLink[]>([]);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let role = $state<ShareLinkRole>('viewer');
  let days = $state<(typeof DAYS)[number]>(7);
  let uses = $state('');
  let usesError = $state<string | null>(null);
  let creating = $state(false);
  let revoking = $state<string | null>(null);
  // La URL con el token solo existe aquí, en memoria, hasta que se cierra el panel.
  let created = $state<string | null>(null);
  let urlInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    void version;
    untrack(() => void load());
  });

  async function load() {
    status = links.length ? status : 'loading';
    try {
      links = (await listShareLinks(projectId)).items;
      status = 'ready';
    } catch {
      status = 'error';
    }
  }

  function parseUses(): number | undefined | null {
    const text = uses.trim();
    if (!text) return undefined;
    const value = Number(text);
    return Number.isInteger(value) && value >= 1 && value <= SHARE_LINK_MAX_USES ? value : null;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (creating) return;
    const maxUses = parseUses();
    usesError = maxUses === null ? m.share_link_uses_error({ max: SHARE_LINK_MAX_USES }) : null;
    if (maxUses === null) return;
    creating = true;
    try {
      const link = await createShareLink(projectId, { role, expiresInDays: days, ...(maxUses ? { maxUses } : {}) });
      const { url, ...rest } = link;
      created = url;
      links = [rest, ...links];
      uses = '';
    } catch (cause) {
      fail(cause);
    } finally {
      creating = false;
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      showToast({ message: m.share_link_copied(), tone: 'success' });
    } catch {
      urlInput?.select();
      showToast({ message: m.share_link_copy_error(), tone: 'error' });
    }
  }

  async function revoke(link: ShareLink) {
    revoking = link.id;
    try {
      await revokeShareLink(projectId, link.id);
      links = links.filter((item) => item.id !== link.id);
      showToast({ message: m.share_link_revoked(), tone: 'success' });
    } catch (cause) {
      fail(cause);
    } finally {
      revoking = null;
    }
  }

  function summary(link: ShareLink) {
    return m.share_link_summary({ role: PROJECT_ROLE_LABEL[link.role](), date: formatDate(link.expiresAt) });
  }

  function usage(link: ShareLink) {
    return link.maxUses === null
      ? m.share_link_uses_unlimited({ uses: link.uses })
      : m.share_link_uses_count({ uses: link.uses, max: link.maxUses });
  }
</script>

<section aria-labelledby="{uid}-title" class="flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <h3 id="{uid}-title" class="text-sm font-semibold">{m.share_links_title()}</h3>
    <p class="text-xs text-ink-muted">{m.share_links_hint()}</p>
  </div>

  <form onsubmit={create} class="flex flex-col gap-3" novalidate>
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium" for="{uid}-role">{m.share_link_role()}</label>
        <select id="{uid}-role" bind:value={role} class={SELECT_CLASS}>
          {#each SHARE_LINK_ROLES as option (option)}
            <option value={option}>{PROJECT_ROLE_LABEL[option]()}</option>
          {/each}
        </select>
      </div>
      <fieldset class="flex flex-col gap-1.5">
        <legend class="mb-1.5 text-xs font-medium">{m.share_link_expires()}</legend>
        <div class="flex rounded-full bg-surface-2 p-0.5">
          {#each DAYS as option (option)}
            <label
              class={[
                'cursor-pointer rounded-full px-3 py-1.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-coral',
                days === option ? 'bg-petrol font-semibold text-ink' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              <input type="radio" name="{uid}-days" value={option} bind:group={days} class="sr-only" />
              {option === 1 ? m.share_link_day() : m.share_link_days({ count: option })}
            </label>
          {/each}
        </div>
      </fieldset>
      <div class="flex w-40 flex-col gap-1.5">
        <label class="text-xs font-medium" for="{uid}-uses">{m.share_link_uses()}</label>
        <Input
          id="{uid}-uses"
          inputmode="numeric"
          autocomplete="off"
          bind:value={uses}
          invalid={Boolean(usesError)}
          describedBy="{uid}-uses-hint {uid}-uses-error"
          class="h-9 text-sm"
        />
      </div>
    </div>
    <p id="{uid}-uses-hint" class="text-xs text-ink-muted">{m.share_link_uses_hint({ max: SHARE_LINK_MAX_USES })}</p>
    <p id="{uid}-uses-error" aria-live="polite" class="text-sm text-danger empty:hidden">{usesError ?? ''}</p>
    <div><Button type="submit" size="sm" loading={creating}>{m.share_link_create()}</Button></div>
  </form>

  {#if created}
    <div class="flex flex-col gap-2 rounded-panel bg-petrol p-3" role="status">
      <p class="text-sm font-medium">{m.share_link_created()}</p>
      <div class="flex gap-2">
        <label class="sr-only" for="{uid}-url">{m.share_link_url_label()}</label>
        <input
          bind:this={urlInput}
          id="{uid}-url"
          readonly
          value={created}
          onfocus={(event) => event.currentTarget.select()}
          class="h-9 min-w-0 flex-1 rounded-panel border border-edge bg-surface-1 px-2.5 text-sm text-ink"
          data-testid="share-link-url"
        />
        <Button size="sm" variant="primary" class="h-9" onclick={() => void copy()}>{m.share_link_copy()}</Button>
      </div>
    </div>
  {/if}

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.share_links_loading()}</p>
    <Skeleton class="h-12 w-full" />
  {:else if status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3">
      <p class="text-sm">{m.share_links_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else if links.length === 0}
    <p class="text-sm text-ink-muted">{m.share_links_empty()}</p>
  {:else}
    <ul class="flex flex-col gap-1" aria-labelledby="{uid}-title">
      {#each links as link (link.id)}
        <li class="flex items-center gap-3 rounded-panel bg-surface-2 px-3 py-2" data-testid="share-link">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{summary(link)}</p>
            <p class="truncate text-xs text-ink-muted">
              {usage(link)}{#if link.email} · {m.share_link_for({ email: link.email })}{/if}
            </p>
          </div>
          <Button
            size="sm"
            variant="danger-ghost"
            label={m.share_link_revoke_label({ summary: summary(link) })}
            loading={revoking === link.id}
            onclick={() => void revoke(link)}
          >
            {m.share_link_revoke()}
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
