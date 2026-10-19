<script lang="ts">
  import Pencil from '@lucide/svelte/icons/pencil';
  import Reply from '@lucide/svelte/icons/reply';
  import Trash from '@lucide/svelte/icons/trash';
  import { tick } from 'svelte';
  import { assetUrl } from '../../../lib/assets.ts';
  import { chatBody, type ChatEntry } from '../../../lib/chat.ts';
  import { formatDate } from '../../../lib/format.ts';
  import { m } from '../../../paraglide/messages.js';
  import Avatar from '../../../ui/Avatar.svelte';

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
</script>

<li
  class={['group relative rounded-[6px] px-2', compact ? 'pt-0.5' : 'pt-2', mentionsMe ? 'bg-petrol/40' : ''].join(' ')}
  data-testid="chat-message"
  data-message-id={entry.id}
>
  {#if !compact}
    <div class="flex items-baseline gap-2">
      <span class="self-center"><Avatar name={authorName} src={avatar} size="sm" /></span>
      <span class="truncate font-semibold">{authorName}</span>
      <time datetime={entry.createdAt} title={fullTime} class="shrink-0 text-xs text-ink-muted tabular">{time}</time>
    </div>
  {/if}

  <div class="pb-1 pl-8">
    {#if mentionsMe}<span class="sr-only">{m.editor_chat_mentions_you()}</span>{/if}
    {#if entry.replyTo}
      <button
        type="button"
        onclick={() => onquote(entry.replyTo!.id)}
        class="mb-1 block w-full cursor-pointer truncate rounded-[6px] bg-surface-2 px-2 py-1 text-left text-xs text-ink-muted hover:text-ink"
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
        class="block w-full resize-none rounded-[6px] bg-surface-2 px-2 py-1.5 text-sm text-ink"
      ></textarea>
      <p class="mt-1 flex gap-3 text-xs">
        <button type="button" class="cursor-pointer font-semibold text-coral hover:underline" disabled={saving} onclick={() => void save()}>
          {m.common_save()}
        </button>
        <button type="button" class="cursor-pointer text-ink-muted hover:text-ink" onclick={() => (editing = false)}>{m.common_cancel()}</button>
      </p>
    {:else}
      <p class="break-words whitespace-pre-wrap" use:chatBody={{ body: entry.body, mentionNames }} data-testid="chat-body"></p>
      {#if entry.editedAt}<span class="text-xs text-ink-muted">{m.editor_chat_edited()}</span>{/if}
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
              class="block aspect-square overflow-hidden rounded-[6px] bg-surface-2"
            >
              {#if images[id]?.thumb}
                <img src={images[id].thumb} alt="" class="size-full object-cover" loading="lazy" decoding="async" />
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    {#if entry.pending === 'sending'}
      <p class="text-xs text-ink-muted">{m.editor_chat_sending()}</p>
    {:else if entry.pending === 'failed'}
      <p class="text-xs text-danger" role="alert">
        {m.editor_chat_not_sent()} ·
        <button type="button" class="cursor-pointer font-semibold underline" onclick={() => onretry(entry)}>{m.common_retry()}</button>
      </p>
    {/if}
  </div>

  {#if !deleted && !entry.pending && !editing}
    <div
      class="absolute top-1 right-1 flex gap-0.5 rounded-full bg-surface-1 p-0.5 opacity-0 shadow-float transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <button
        type="button"
        aria-label={m.editor_chat_reply_to({ name: authorName })}
        title={m.editor_chat_reply()}
        onclick={() => onreply(entry)}
        class="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <Reply size={14} aria-hidden="true" />
      </button>
      {#if own}
        <button
          type="button"
          aria-label={m.editor_chat_edit()}
          title={m.editor_chat_edit()}
          onclick={() => void startEdit()}
          class="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      {/if}
      {#if own || canModerate}
        <button
          type="button"
          aria-label={m.editor_chat_delete()}
          title={m.editor_chat_delete()}
          onclick={() => ondelete(entry)}
          class="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-danger"
        >
          <Trash size={14} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/if}
</li>
