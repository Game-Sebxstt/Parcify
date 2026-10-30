<script lang="ts">
  import Pencil from '@lucide/svelte/icons/pencil';
  import Reply from '@lucide/svelte/icons/reply';
  import Trash from '@lucide/svelte/icons/trash';
  import { tick, type Component } from 'svelte';
  import { assetUrl } from '../../../lib/assets.ts';
  import { chatBody, type ChatEntry } from '../../../lib/chat.ts';
  import { formatDate } from '../../../lib/format.ts';
  import { m } from '../../../paraglide/messages.js';
  import Avatar from '../../../ui/Avatar.svelte';
  import Tooltip from '../../../ui/Tooltip.svelte';

  type Props = {
    entry: ChatEntry;
    meId: string;
    // Sin cabecera: sigue a otro mensaje de la misma persona.
    compact: boolean;
    canModerate: boolean;
    mentionNames: string[];
    avatar: string | null;
    onreply: (entry: ChatEntry) => void;
    onedit: (entry: ChatEntry, body: string) => Promise<boolean>;
    ondelete: (entry: ChatEntry) => void;
    onretry: (entry: ChatEntry) => void;
    onquote: (messageId: string) => void;
  };

  let { entry, meId, compact, canModerate, mentionNames, avatar, onreply, onedit, ondelete, onretry, onquote }: Props = $props();

  const own = $derived(entry.author.id === meId);
  const deleted = $derived(entry.deletedAt !== null);
  const mentionsMe = $derived(!own && entry.mentions.includes(meId));
  const authorName = $derived(entry.author.name ?? m.editor_chat_deleted_account());
  const time = $derived(formatDate(entry.createdAt, { timeStyle: 'short' }));
  const fullTime = $derived(formatDate(entry.createdAt, { dateStyle: 'long', timeStyle: 'short' }));

  let editing = $state(false);
  let draft = $state('');
  let saving = $state(false);
  let editor = $state<HTMLTextAreaElement | null>(null);
  let images = $state<Record<string, { thumb: string | null; full: string | null }>>({});

  $effect(() => {
    for (const id of entry.attachments) {
      if (id in images) continue;
      images[id] = { thumb: null, full: null };
      void assetUrl(id, 'thumb').then((url) => (images[id]!.thumb = url));
      void assetUrl(id, 'full').then((url) => (images[id]!.full = url));
    }
  });

  async function startEdit() {
    draft = entry.body;
    editing = true;
    await tick();
    editor?.focus();
  }

  async function save() {
    const next = draft.trim();
    if (!next || next === entry.body) {
      editing = false;
      return;
    }
    saving = true;
    const ok = await onedit(entry, next);
    saving = false;
    if (ok) editing = false;
  }

  function onEditKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      editing = false;
    }
  }

  // Con ratón, los botones aparecen con hover o foco; con el dedo se ven siempre, en una fila bajo la burbuja.
  const ACTION =
    'inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink touch:size-8 touch:bg-surface-2';
</script>

{#snippet action(label: string, tip: string, onclick: () => void, Icon: Component<{ size?: number; 'aria-hidden'?: 'true' }>, danger = false)}
  <Tooltip text={tip} side="top">
    {#snippet children(props)}
      <button {...props} type="button" aria-label={label} {onclick} class={[ACTION, danger && 'hover:text-danger']}>
        <Icon size={14} aria-hidden="true" />
      </button>
    {/snippet}
  </Tooltip>
{/snippet}

<li class={['group relative min-w-0', compact ? '' : 'pt-1']} data-testid="chat-message" data-message-id={entry.id}>
  {#if !compact}
    <div class="mb-1 flex min-w-0 items-center gap-2">
      <Avatar name={authorName} src={avatar} size="sm" />
      <span class="min-w-0 truncate text-2xs font-semibold text-ink-muted">{authorName}</span>
      <time datetime={entry.createdAt} title={fullTime} class="shrink-0 text-2xs text-ink-muted tabular">{time}</time>
    </div>
  {/if}

  <div class="flex min-w-0 flex-col items-start pl-8">
    {#if mentionsMe}<span class="sr-only">{m.editor_chat_mentions_you()}</span>{/if}
    <div
      class={[
        'min-w-0 max-w-full rounded-card px-2.5 py-2 text-sm',
        editing ? 'w-full' : 'w-fit',
        own ? 'bg-petrol' : 'bg-surface-2',
        mentionsMe && 'outline-1 -outline-offset-1 outline-coral/60',
      ]}
      data-testid="chat-bubble"
    >
      {#if entry.replyTo}
        <!-- La cita va en una sola línea, recortada, con el filete de la izquierda. -->
        <button
          type="button"
          onclick={() => onquote(entry.replyTo!.id)}
          class="mb-1.5 block w-full min-w-0 cursor-pointer truncate border-l-2 border-edge pl-2 text-left text-xs text-ink-muted transition-colors duration-(--dur-fast) hover:text-ink"
          data-testid="chat-quote"
        >
          {#if entry.replyTo.deleted}
            <span class="italic">{m.editor_chat_deleted()}</span>
          {:else}
            <span class="font-semibold text-ink">{entry.replyTo.authorName ?? m.editor_chat_deleted_account()}</span>
            {entry.replyTo.excerpt}
          {/if}
        </button>
      {/if}

      {#if deleted}
        <p class="text-ink-muted italic">{m.editor_chat_deleted()}</p>
      {:else if editing}
        <label class="sr-only" for="edit-{entry.id}">{m.editor_chat_edit_label()}</label>
        <textarea
          id="edit-{entry.id}"
          bind:this={editor}
          bind:value={draft}
          maxlength={4000}
          rows={2}
          disabled={saving}
          onkeydown={onEditKey}
          class="block w-full resize-none rounded-control bg-surface-1 px-2 py-1.5 text-sm text-ink"
        ></textarea>
        <p class="mt-1 flex gap-3 text-xs">
          <button type="button" class="cursor-pointer font-semibold text-coral hover:underline" disabled={saving} onclick={() => void save()}>
            {m.common_save()}
          </button>
          <button type="button" class="cursor-pointer text-ink-muted hover:text-ink" onclick={() => (editing = false)}>{m.common_cancel()}</button>
        </p>
      {:else}
        <p class="break-words whitespace-pre-wrap" use:chatBody={{ body: entry.body, mentionNames }} data-testid="chat-body"></p>
        {#if entry.editedAt}<span class="text-2xs text-ink-muted">{m.editor_chat_edited()}</span>{/if}
      {/if}

      {#if !deleted && entry.attachments.length}
        <ul class="mt-1.5 grid grid-cols-2 gap-1.5">
          {#each entry.attachments as id (id)}
            <li>
              <a
                href={images[id]?.full ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={m.editor_chat_attachment_open()}
                class="block aspect-square overflow-hidden rounded-control bg-surface-1"
              >
                {#if images[id]?.thumb}
                  <img src={images[id].thumb} alt="" class="size-full object-cover" loading="lazy" decoding="async" />
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if entry.pending === 'sending'}
      <p class="mt-0.5 text-2xs text-ink-muted">{m.editor_chat_sending()}</p>
    {:else if entry.pending === 'failed'}
      <p class="mt-0.5 text-xs text-danger" role="alert">
        {m.editor_chat_not_sent()} ·
        <button type="button" class="cursor-pointer font-semibold underline" onclick={() => onretry(entry)}>{m.common_retry()}</button>
      </p>
    {/if}

    {#if !deleted && !entry.pending && !editing}
      <div
        class={[
          'absolute -top-3 right-0 z-10 flex gap-0.5 rounded-control border border-edge/40 bg-surface-1 p-0.5 opacity-0 shadow-float transition-opacity duration-(--dur-fast)',
          'group-focus-within:opacity-100 group-hover:opacity-100',
          'touch:static touch:mt-1 touch:gap-1 touch:border-0 touch:bg-transparent touch:p-0 touch:opacity-100 touch:shadow-none',
        ]}
        data-testid="chat-actions"
      >
        {@render action(m.editor_chat_reply_to({ name: authorName }), m.editor_chat_reply(), () => onreply(entry), Reply)}
        {#if own}
          {@render action(m.editor_chat_edit(), m.editor_chat_edit(), () => void startEdit(), Pencil)}
        {/if}
        {#if own || canModerate}
          {@render action(m.editor_chat_delete(), m.editor_chat_delete(), () => ondelete(entry), Trash, true)}
        {/if}
      </div>
    {/if}
  </div>
</li>
