<script lang="ts" module>
  // `clientId`: la conexión de Awareness que se sigue con «Seguir a».
  export type Collaborator = { id: string; clientId: number; name: string; color: string; avatarAssetId: string | null };
</script>

<script lang="ts">
  import History from '@lucide/svelte/icons/history';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
  import Play from '@lucide/svelte/icons/play';
  import type { Snippet } from 'svelte';
  import { assetUrl } from '../../../lib/assets.ts';
  import { m } from '../../../paraglide/messages.js';
  import Avatar from '../../../ui/Avatar.svelte';
  import Tooltip from '../../../ui/Tooltip.svelte';

  type Props = {
    // Pastilla del panel plegado: sin avatares y con los botones en una sola fila.
    compact: boolean;
    people: Collaborator[];
    following: number | null;
    chatOpen: boolean;
    chatUnread: number;
    versionsOpen: boolean;
    aiAvailable: boolean;
    aiOpen: boolean;
    canShare: boolean;
    onfollow: (clientId: number | null) => void;
    onchat: () => void;
    onversions: () => void;
    onai: () => void;
    onpresent: () => void;
    onshare: () => void;
    ontoggle: () => void;
  };

  let {
    compact,
    people,
    following,
    chatOpen,
    chatUnread,
    versionsOpen,
    aiAvailable,
    aiOpen,
    canShare,
    onfollow,
    onchat,
    onversions,
    onai,
    onpresent,
    onshare,
    ontoggle,
  }: Props = $props();

  const MAX_AVATARS = 3;

  let avatars = $state<Record<string, string | null>>({});

  $effect(() => {
    for (const person of people.slice(0, MAX_AVATARS)) {
      const id = person.avatarAssetId;
      if (!id || id in avatars) continue;
      avatars[id] = null;
      void assetUrl(id).then((url) => (avatars[id] = url));
    }
  });

  const ICON = 'relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control transition-colors duration-(--dur-fast)';
  const iconState = (pressed: boolean) => (pressed ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-petrol hover:text-ink');
</script>

{#snippet iconButton(tip: string, label: string, pressed: boolean, onclick: () => void, testid: string, icon: Snippet)}
  <Tooltip text={tip} side="bottom">
    {#snippet children(props)}
      <button {...props} type="button" aria-label={label} aria-pressed={pressed} {onclick} class={[ICON, iconState(pressed)]} data-testid={testid}>
        {@render icon()}
      </button>
    {/snippet}
  </Tooltip>
{/snippet}

{#snippet chatIcon()}
  <MessageSquare size={16} aria-hidden="true" />
  {#if chatUnread}
    <span
      aria-hidden="true"
      class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-coral px-1 text-center text-[10px] leading-4 font-semibold text-coral-ink tabular"
      data-testid="chat-unread"
    >
      {chatUnread > 99 ? '99+' : chatUnread}
    </span>
  {/if}
{/snippet}

{#snippet versionsIcon()}
  <History size={16} aria-hidden="true" />
{/snippet}

{#snippet aiIcon()}
  <span class="text-xs font-semibold">{m.editor_ai_label()}</span>
{/snippet}

{#snippet tools()}
  {@render iconButton(
    chatOpen ? m.editor_chat_hide() : m.editor_chat_show(),
    chatUnread ? m.editor_chat_toggle_unread({ count: chatUnread }) : m.editor_chat_toggle(),
    chatOpen,
    onchat,
    'chat-toggle',
    chatIcon,
  )}
  {@render iconButton(versionsOpen ? m.editor_versions_hide() : m.editor_versions_show(), m.editor_versions_toggle(), versionsOpen, onversions, 'versions-toggle', versionsIcon)}
  {#if aiAvailable}
    {@render iconButton(aiOpen ? m.editor_ai_hide() : m.editor_ai_show(), m.editor_ai_toggle(), aiOpen, onai, 'ai-toggle', aiIcon)}
  {/if}
{/snippet}

{#snippet toggle()}
  <Tooltip text={compact ? m.editor_panel_expand_right() : m.editor_panel_collapse_right()} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-label={compact ? m.editor_panel_expand_right() : m.editor_panel_collapse_right()}
        aria-expanded={!compact}
        onclick={ontoggle}
        class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink"
        data-testid="right-panel-toggle"
      >
        {#if compact}<PanelRightOpen size={16} aria-hidden="true" />{:else}<PanelRightClose size={16} aria-hidden="true" />{/if}
      </button>
    {/snippet}
  </Tooltip>
{/snippet}

{#snippet present()}
  <Tooltip text={m.editor_present_hint()} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-label={compact ? m.editor_present() : undefined}
        onclick={onpresent}
        class={[
          'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-control bg-surface-2 text-xs font-semibold text-ink transition-colors duration-(--dur-fast) hover:bg-petrol',
          compact ? 'w-8' : 'px-2.5',
        ]}
        data-testid="present"
      >
        <Play size={14} aria-hidden="true" />
        {#if !compact}{m.editor_present()}{/if}
      </button>
    {/snippet}
  </Tooltip>
{/snippet}

{#snippet share()}
  <Tooltip text={canShare ? m.editor_share_hint() : m.editor_share_admin_only()} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-haspopup={canShare ? 'dialog' : undefined}
        aria-disabled={canShare ? undefined : 'true'}
        aria-describedby={canShare ? undefined : 'share-admin-only'}
        onclick={() => {
          if (canShare) onshare();
        }}
        class={[
          'inline-flex h-8 shrink-0 items-center rounded-control bg-coral px-3 text-xs font-semibold text-coral-ink transition-colors duration-(--dur-fast)',
          canShare ? 'cursor-pointer hover:bg-coral-hover' : 'cursor-not-allowed opacity-60',
        ]}
        data-testid="share"
      >
        {m.editor_share()}
      </button>
    {/snippet}
  </Tooltip>
  {#if !canShare}
    <span id="share-admin-only" class="sr-only">{m.editor_share_admin_only()}</span>
  {/if}
{/snippet}

{#if compact}
  <div class="flex h-10 items-center gap-0.5 px-1">
    {@render tools()}
    {@render present()}
    {@render share()}
    {@render toggle()}
  </div>
{:else}
  <!-- A 248 px no caben en una fila los avatares, las tres vistas, Presentar y Compartir: van en dos. -->
  <div class="flex h-12 shrink-0 items-center gap-1.5 px-2">
    <div class="flex min-w-0 flex-1 items-center">
      {#if people.length}
        <ul aria-label={m.editor_presence_label()} class="flex items-center -space-x-1.5">
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
                    class={['block cursor-pointer rounded-full ring-2', active ? '' : 'ring-surface-1']}
                  >
                    <Avatar name={person.name} color={person.color} src={person.avatarAssetId ? (avatars[person.avatarAssetId] ?? null) : null} size="sm" />
                  </button>
                {/snippet}
              </Tooltip>
            </li>
          {/each}
          {#if people.length > MAX_AVATARS}
            <li class="pl-2.5 text-2xs text-ink-muted tabular">
              <span aria-hidden="true">+{people.length - MAX_AVATARS}</span>
              <span class="sr-only">{m.editor_presence_more({ count: people.length - MAX_AVATARS })}</span>
            </li>
          {/if}
        </ul>
      {/if}
    </div>
    {@render present()}
    {@render share()}
  </div>
  <div class="flex h-9 shrink-0 items-center gap-0.5 border-t border-edge/25 px-2">
    {@render tools()}
    <span class="flex-1"></span>
    {@render toggle()}
  </div>
{/if}
