<script lang="ts" module>
  export type ComposerMember = { userId: string; name: string };
  export type ComposerSend = { body: string; mentions: string[]; attachments: AssetDto[] };
</script>

<script lang="ts">
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Send from '@lucide/svelte/icons/send-horizontal';
  import X from '@lucide/svelte/icons/x';
  import { tick } from 'svelte';
  import { ApiError } from '../../../lib/api.ts';
  import { assetUrl } from '../../../lib/assets.ts';
  import { CANVAS_IMAGE_ACCEPT } from '../../../lib/canvas-images.ts';
  import { filterMembers, mentionQuery, mentionsInBody, uploadChatImage, type ChatEntry } from '../../../lib/chat.ts';
  import { m } from '../../../paraglide/messages.js';
  import type { AssetDto } from '../../../shared/api/assets.js';
  import { CHAT_LIMITS } from '../../../shared/api/chat.js';
  import { showToast } from '../../../ui/toast.svelte.ts';

  type Props = {
    projectId: string;
    members: ComposerMember[];
    replyTo: ChatEntry | null;
    oncancelreply: () => void;
    onsend: (input: ComposerSend) => void;
    ontyping: () => void;
    onstoptyping: () => void;
  };

  let { projectId, members, replyTo, oncancelreply, onsend, ontyping, onstoptyping }: Props = $props();

  const uid = $props.id();

  let text = $state('');
  let input = $state<HTMLTextAreaElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let attachments = $state.raw<AssetDto[]>([]);
  let thumbs = $state<Record<string, string | null>>({});
  let uploading = $state(0);
  let query = $state<{ start: number; query: string } | null>(null);
  let active = $state(0);
  // Personas elegidas en el autocompletado: id → nombre.
  let picked: Record<string, string> = {};

  const suggestions = $derived(query ? filterMembers(members, query.query) : []);
  const listOpen = $derived(suggestions.length > 0);
  const canSend = $derived(text.trim().length > 0 && uploading === 0);

  export function focus() {
    input?.focus();
  }

  $effect(() => {
    for (const asset of attachments) {
      if (asset.id in thumbs) continue;
      thumbs[asset.id] = null;
      void assetUrl(asset.id, 'thumb').then((url) => (thumbs[asset.id] = url));
    }
  });

  function refreshQuery() {
    const next = input ? mentionQuery(text, input.selectionStart ?? text.length) : null;
    if (next?.query !== query?.query || next?.start !== query?.start) active = 0;
    query = next;
  }

  function onInput() {
    refreshQuery();
    if (text.trim()) ontyping();
    else onstoptyping();
  }

  async function choose(member: ComposerMember) {
    if (!query || !input) return;
    const before = text.slice(0, query.start);
    const after = text.slice(query.start + 1 + query.query.length);
    const insert = `@${member.name} `;
    text = `${before}${insert}${after.replace(/^ /, '')}`;
    picked[member.userId] = member.name;
    query = null;
    await tick();
    const caret = before.length + insert.length;
    input.setSelectionRange(caret, caret);
    input.focus();
  }

  function submit() {
    if (!canSend) return;
    const body = text.trim();
    onsend({ body, mentions: mentionsInBody(body, picked), attachments });
    text = '';
    attachments = [];
    picked = {};
    query = null;
    onstoptyping();
  }

  function onKeydown(event: KeyboardEvent) {
    if (listOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        active = (active + step + suggestions.length) % suggestions.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        void choose(suggestions[active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        query = null;
        return;
      }
    }
    if (event.key === 'Escape' && replyTo) {
      event.preventDefault();
      event.stopPropagation();
      oncancelreply();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  async function onFiles(event: Event & { currentTarget: HTMLInputElement }) {
    const room = CHAT_LIMITS.attachmentsMax - attachments.length - uploading;
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (files.length > room) showToast({ message: m.editor_chat_attachments_max({ max: CHAT_LIMITS.attachmentsMax }), tone: 'error' });
    for (const file of files.slice(0, Math.max(0, room))) {
      uploading++;
      try {
        const asset = await uploadChatImage(file, projectId);
        if (!attachments.some((item) => item.id === asset.id)) attachments = [...attachments, asset];
      } catch (error) {
        showToast({ message: error instanceof ApiError ? error.message : m.editor_image_upload_error(), tone: 'error' });
      } finally {
        uploading--;
      }
    }
  }
</script>

<div class="flex flex-col gap-2 border-t border-edge px-3 pt-2 pb-3">
  {#if replyTo}
    <div class="flex items-center gap-2 rounded-[6px] bg-surface-2 py-1 pr-1 pl-2 text-xs" data-testid="chat-replying">
      <p class="min-w-0 flex-1 truncate text-ink-muted">
        {m.editor_chat_replying_to({ name: replyTo.author.name ?? m.editor_chat_deleted_account() })}
        <span class="text-ink">{replyTo.body}</span>
      </p>
      <button
        type="button"
        aria-label={m.editor_chat_reply_cancel()}
        onclick={oncancelreply}
        class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-1 hover:text-ink"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  {/if}

  {#if attachments.length || uploading}
    <ul class="flex gap-1.5" aria-label={m.editor_chat_attachments()}>
      {#each attachments as asset (asset.id)}
        <li class="relative size-12 overflow-hidden rounded-[6px] bg-surface-2">
          {#if thumbs[asset.id]}<img src={thumbs[asset.id]} alt="" class="size-full object-cover" />{/if}
          <button
            type="button"
            aria-label={m.editor_chat_attachment_remove({ name: asset.name ?? m.editor_gallery_untitled() })}
            onclick={() => (attachments = attachments.filter((item) => item.id !== asset.id))}
            class="absolute top-0 right-0 inline-flex size-6 cursor-pointer items-center justify-center rounded-full bg-surface-1 text-ink-muted hover:text-ink"
          >
            <X size={10} aria-hidden="true" />
          </button>
        </li>
      {/each}
      {#each { length: uploading } as _, index (index)}
        <li class="size-12 rounded-[6px] bg-surface-2" aria-label={m.editor_chat_uploading()}></li>
      {/each}
    </ul>
  {/if}

  <div class="relative">
    {#if listOpen}
      <ul
        id="{uid}-mentions"
        role="listbox"
        aria-label={m.editor_chat_mention_list()}
        class="absolute right-0 bottom-full left-0 mb-1 max-h-48 overflow-y-auto rounded-panel bg-surface-2 p-1 shadow-float"
      >
        {#each suggestions as member, index (member.userId)}
          <li
            id="{uid}-mention-{index}"
            role="option"
            aria-selected={index === active}
            class={['cursor-pointer truncate rounded-[6px] px-2 py-1.5', index === active ? 'bg-petrol text-ink' : 'text-ink-muted'].join(' ')}
            onmousedown={(event) => {
              event.preventDefault();
              void choose(member);
            }}
          >
            {member.name}
          </li>
        {/each}
      </ul>
    {/if}

    <label for="{uid}-input" class="sr-only">{m.editor_chat_input_label()}</label>
    <div class="flex items-end gap-1 rounded-panel bg-surface-2 p-1 focus-within:ring-2 focus-within:ring-edge">
      <input bind:this={fileInput} type="file" accept={CANVAS_IMAGE_ACCEPT} multiple class="hidden" tabindex="-1" aria-hidden="true" onchange={onFiles} data-testid="chat-file-input" />
      <button
        type="button"
        aria-label={m.editor_chat_attach()}
        title={m.editor_chat_attach()}
        disabled={attachments.length + uploading >= CHAT_LIMITS.attachmentsMax}
        onclick={() => fileInput?.click()}
        class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-1 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Paperclip size={16} aria-hidden="true" />
      </button>
      <textarea
        id="{uid}-input"
        bind:this={input}
        bind:value={text}
        rows={1}
        maxlength={CHAT_LIMITS.bodyMax}
        placeholder={m.editor_chat_placeholder()}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? `${uid}-mentions` : undefined}
        aria-activedescendant={listOpen ? `${uid}-mention-${active}` : undefined}
        oninput={onInput}
        onclick={refreshQuery}
        onkeydown={onKeydown}
        onblur={() => (query = null)}
        class="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm text-ink [field-sizing:content] placeholder:text-ink-muted focus:outline-none"
        data-testid="chat-input"
      ></textarea>
      <button
        type="button"
        aria-label={m.editor_chat_send()}
        title={m.editor_chat_send()}
        disabled={!canSend}
        onclick={submit}
        class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-coral text-coral-ink hover:bg-coral-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send size={16} aria-hidden="true" />
      </button>
    </div>
  </div>
</div>
