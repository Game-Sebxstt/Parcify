<script lang="ts" module>
  // `clientId`: la conexión de Awareness que se sigue con «Seguir a».
  export type Collaborator = { id: string; clientId: number; name: string; color: string; avatarAssetId: string | null };
</script>

<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import History from '@lucide/svelte/icons/history';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import Play from '@lucide/svelte/icons/play';
  import Share from '@lucide/svelte/icons/share-2';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { assetUrl } from '../../lib/assets.ts';
  import type { CollabState } from '../../lib/collab.ts';
  import { m } from '../../paraglide/messages.js';
  import Avatar from '../../ui/Avatar.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';

  type Props = {
    name: string;
    canRename: boolean;
    collab: CollabState;
    people: Collaborator[];
    following: number | null;
    chatOpen: boolean;
    chatUnread: number;
    versionsOpen: boolean;
    aiAvailable: boolean;
    aiOpen: boolean;
    onai: () => void;
    onrename: (name: string) => Promise<boolean>;
    onfollow: (clientId: number | null) => void;
    onchat: () => void;
    onversions: () => void;
    onpresent: () => void;
    canPublish: boolean;
    onpublish: () => void;
    canShare: boolean;
    onshare: () => void;
    // Se espera antes de salir al dashboard (p. ej. la subida de la vista previa).
    onleave: () => Promise<void>;
  };

  let {
    name,
    canRename,
    collab,
    people,
    following,
    chatOpen,
    chatUnread,
    versionsOpen,
    aiAvailable,
    aiOpen,
    onai,
    onrename,
    onfollow,
    onchat,
    onversions,
    onpresent,
    canPublish,
    onpublish,
    canShare,
    onshare,
    onleave,
  }: Props = $props();

  let leaving = false;

  // Un clic normal espera a `onleave` antes de navegar; con modificadores se abre como un enlace más.
  function leave(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (leaving) return;
    leaving = true;
    const href = (event.currentTarget as HTMLAnchorElement).href;
    void onleave().finally(() => window.location.assign(href));
  }

  // Borrador editable que vuelve al nombre real cada vez que este cambia.
  let draft = $derived(name);
  let saving = $state(false);

  const MAX_AVATARS = 5;

  let avatars = $state<Record<string, string | null>>({});

  $effect(() => {
    for (const person of people.slice(0, MAX_AVATARS)) {
      const id = person.avatarAssetId;
      if (!id || id in avatars) continue;
      avatars[id] = null;
      void assetUrl(id).then((url) => (avatars[id] = url));
    }
  });

  const statusText = $derived.by(() => {
    switch (collab.status) {
      case 'connected':
        return m.editor_status_connected();
      case 'reconnecting':
        return m.editor_status_reconnecting();
      case 'compacting':
        return m.editor_status_compacting();
      case 'offline':
        return collab.localCopy ? m.editor_status_offline_saved() : m.editor_status_offline_unsaved();
      default:
        return m.editor_status_connecting();
    }
  });

  async function commit() {
    const next = draft.trim();
    if (!next || next === name) {
      draft = name;
      return;
    }
    saving = true;
    const ok = await onrename(next);
    saving = false;
    if (!ok) draft = name;
  }
</script>

<header class="flex h-12 shrink-0 items-center gap-3 bg-surface-1 pr-3 pl-1.5">
  <a
    href="/app"
    aria-label={m.editor_back()}
    onclick={leave}
    class="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
  >
    <ChevronLeft size={18} aria-hidden="true" />
  </a>

  {#if canRename}
    <input
      aria-label={m.editor_name_label()}
      bind:value={draft}
      maxlength={80}
      disabled={saving}
      onblur={commit}
      onkeydown={(event) => {
        if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
        if (event.key === 'Escape') {
          draft = name;
          (event.currentTarget as HTMLInputElement).blur();
        }
      }}
      class="h-8 w-[min(22rem,40vw)] min-w-0 truncate rounded-panel bg-transparent px-2 text-sm font-semibold text-ink hover:bg-surface-2 focus:bg-surface-2"
    />
  {:else}
    <h1 class="truncate px-2 text-sm font-semibold">{name}</h1>
  {/if}

  {#if collab.readOnly}
    <span class="shrink-0 rounded-full bg-petrol px-2.5 py-1 text-xs font-medium">{m.editor_read_only()}</span>
  {/if}

  <div class="flex-1"></div>

  <p role="status" aria-live="polite" class="flex shrink-0 items-center gap-2 text-xs text-ink-muted" data-testid="connection-status">
    <span
      aria-hidden="true"
      class={['size-2 rounded-full', collab.status === 'connected' ? 'bg-sage' : collab.status === 'offline' ? 'bg-danger' : 'bg-ink-muted'].join(' ')}
    ></span>
    {statusText}
  </p>

  {#if people.length}
    <ul aria-label={m.editor_presence_label()} class="flex shrink-0 items-center -space-x-1.5">
      {#each people.slice(0, MAX_AVATARS) as person (person.id)}
        {@const active = following === person.clientId}
        <li class="rounded-full">
          <Tooltip text={m.editor_follow({ name: person.name })} side="bottom">
            {#snippet children(props)}
              <button
                {...props}
                type="button"
                aria-label={m.editor_follow({ name: person.name })}
                aria-pressed={active}
                onclick={() => onfollow(active ? null : person.clientId)}
                style:--tw-ring-color={active ? person.color : undefined}
                class={['block cursor-pointer rounded-full ring-2', active ? '' : 'ring-surface-1'].join(' ')}
              >
                <Avatar name={person.name} color={person.color} src={person.avatarAssetId ? (avatars[person.avatarAssetId] ?? null) : null} size="sm" />
              </button>
            {/snippet}
          </Tooltip>
        </li>
      {/each}
      {#if people.length > MAX_AVATARS}
        <li class="pl-2.5 text-xs text-ink-muted">{m.editor_presence_more({ count: people.length - MAX_AVATARS })}</li>
      {/if}
    </ul>
  {/if}

  {#if aiAvailable}
    <Tooltip text={aiOpen ? m.editor_ai_hide() : m.editor_ai_show()} side="bottom">
      {#snippet children(props)}
        <button
          {...props}
          type="button"
          aria-label={m.editor_ai_toggle()}
          aria-pressed={aiOpen}
          onclick={onai}
          class={[
            'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150',
            aiOpen ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
          ].join(' ')}
          data-testid="ai-toggle"
        >
          <Sparkles size={18} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
  {/if}

  <Tooltip text={versionsOpen ? m.editor_versions_hide() : m.editor_versions_show()} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-label={m.editor_versions_toggle()}
        aria-pressed={versionsOpen}
        onclick={onversions}
        class={[
          'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150',
          versionsOpen ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        ].join(' ')}
        data-testid="versions-toggle"
      >
        <History size={18} aria-hidden="true" />
      </button>
    {/snippet}
  </Tooltip>

  <Tooltip text={chatOpen ? m.editor_chat_hide() : m.editor_chat_show()} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-label={chatUnread ? m.editor_chat_toggle_unread({ count: chatUnread }) : m.editor_chat_toggle()}
        aria-pressed={chatOpen}
        onclick={onchat}
        class={[
          'relative inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150',
          chatOpen ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        ].join(' ')}
        data-testid="chat-toggle"
      >
        <MessageSquare size={18} aria-hidden="true" />
        {#if chatUnread}
          <span
            aria-hidden="true"
            class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-coral px-1 text-center text-[10px] leading-4 font-semibold text-coral-ink tabular"
            data-testid="chat-unread"
          >
            {chatUnread > 99 ? '99+' : chatUnread}
          </span>
        {/if}
      </button>
    {/snippet}
  </Tooltip>

  {#if canPublish}
    <Tooltip text={m.publish_template_hint()} side="bottom">
      {#snippet children(props)}
        <button
          {...props}
          type="button"
          aria-label={m.publish_template_title()}
          onclick={onpublish}
          class="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          data-testid="publish-template"
        >
          <LayoutTemplate size={18} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
  {/if}

  <Tooltip text={m.editor_present_hint()} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        onclick={onpresent}
        class="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-sm font-semibold text-ink hover:bg-petrol"
        data-testid="present"
      >
        <Play size={14} aria-hidden="true" />
        {m.editor_present()}
      </button>
    {/snippet}
  </Tooltip>
  <Tooltip text={canShare ? m.editor_share_hint() : m.editor_share_admin_only()} side="bottom">
    {#snippet children(props)}
      {#if canShare}
        <button
          {...props}
          type="button"
          aria-haspopup="dialog"
          onclick={onshare}
          class="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-coral px-3.5 text-sm font-semibold text-coral-ink hover:bg-coral-hover"
          data-testid="share"
        >
          <Share size={14} aria-hidden="true" />
          {m.editor_share()}
        </button>
      {:else}
        <button
          {...props}
          type="button"
          aria-disabled="true"
          aria-describedby="share-admin-only"
          class="inline-flex h-8 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full bg-coral px-3.5 text-sm font-semibold text-coral-ink opacity-60"
          data-testid="share"
        >
          <Share size={14} aria-hidden="true" />
          {m.editor_share()}
        </button>
      {/if}
    {/snippet}
  </Tooltip>
  {#if !canShare}
    <span id="share-admin-only" class="sr-only">{m.editor_share_admin_only()}</span>
  {/if}
</header>
