<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import { onMount, tick, untrack } from 'svelte';
  import { ApiError, apiFetch } from '../../../lib/api.ts';
  import { assetUrl } from '../../../lib/assets.ts';
  import {
    deleteChat,
    editChat,
    lastRead,
    listChat,
    markRead,
    mergeMessages,
    parseChatEvent,
    sendChat,
    typingSignal,
    unreadCount,
    type ChatEntry,
  } from '../../../lib/chat.ts';
  import type { CollabSession, ConnectionStatus } from '../../../lib/collab.ts';
  import { m } from '../../../paraglide/messages.js';
  import { ProjectMembersResponseSchema } from '../../../shared/api/projects.js';
  import type { ProjectRole } from '../../../shared/permissions.js';
  import Skeleton from '../../../ui/Skeleton.svelte';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import ConfirmDialog from '../../dashboard/ConfirmDialog.svelte';
  import ChatComposer, { type ComposerMember, type ComposerSend } from './ChatComposer.svelte';
  import ChatMessage from './ChatMessage.svelte';

  type Props = {
    projectId: string;
    session: CollabSession;
    me: { id: string; name: string; avatarAssetId: string | null };
    role: ProjectRole;
    open: boolean;
    status: ConnectionStatus;
    typingNames: string[];
    ontyping: (typing: boolean) => void;
    onunread: (count: number) => void;
  };

  // `open`: la conversación se ve (ventana abierta, sin minimizar y en la pestaña Equipo). Solo así se marca como leída.
  let { projectId, session, me, role, open, status, typingNames, ontyping, onunread }: Props = $props();

  // Margen para considerar que se está al final de la conversación.
  const BOTTOM_SLACK = 48;
  const TOP_SLACK = 64;
  // Mensajes seguidos de la misma persona en menos de esto se agrupan bajo una cabecera.
  const GROUP_MS = 5 * 60_000;

  let messages = $state.raw<ChatEntry[]>([]);
  let cursor = $state<string | null>(null);
  let phase = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingOlder = $state(false);
  let members = $state.raw<ComposerMember[]>([]);
  let avatars = $state<Record<string, string | null>>({});
  let readId = $state<string | null>(null);
  let atBottom = $state(true);
  let newBelow = $state(false);
  let replyTo = $state<ChatEntry | null>(null);
  let removing = $state<ChatEntry | null>(null);
  let confirmOpen = $state(false);
  let deleting = $state(false);
  let announcement = $state('');
  let scroller = $state<HTMLDivElement | null>(null);
  let composer = $state<ReturnType<typeof ChatComposer> | null>(null);
  let seq = 0;
  // Lo que se reenvía al reintentar un mensaje pendiente, por id temporal.
  let payloads: Record<string, { body: string; replyToId?: string; attachments?: string[]; mentions?: string[] }> = {};
  const typing = typingSignal((value) => ontyping(value));

  const canModerate = $derived(role === 'admin');
  const memberNames = $derived(new Map(members.map((member) => [member.userId, member.name])));
  const others = $derived(members.filter((member) => member.userId !== me.id));
  const unread = $derived(unreadCount(messages, me.id, readId));

  const typingText = $derived.by(() => {
    if (typingNames.length === 0) return '';
    if (typingNames.length === 1) return m.editor_chat_typing_one({ name: typingNames[0]! });
    if (typingNames.length === 2) return m.editor_chat_typing_two({ a: typingNames[0]!, b: typingNames[1]! });
    return m.editor_chat_typing_many();
  });

  onMount(() => {
    readId = lastRead(me.id, projectId);
    void load();
    void loadMembers();
    const off = session.on('stateless', (message) => {
      const incoming = parseChatEvent(message, projectId);
      if (incoming) void receive(incoming);
    });
    return () => {
      off();
      typing.stop();
    };
  });

  $effect(() => onunread(unread));

  // Al abrir el panel se baja al final; estando abierto y al final, todo queda leído.
  $effect(() => {
    if (!open) return;
    untrack(() => void scrollToBottom());
  });

  $effect(() => {
    if (!open || !atBottom || phase !== 'ready') return;
    const latest = messages.findLast((entry) => !entry.pending);
    if (!latest) return;
    untrack(() => {
      markRead(me.id, projectId, latest.id);
      if (!readId || readId < latest.id) readId = latest.id;
      newBelow = false;
    });
  });

  // Al recuperar la conexión se traen los mensajes que pudieron perderse.
  let previousStatus: ConnectionStatus | null = null;
  $effect(() => {
    const current = status;
    untrack(() => {
      if (previousStatus && previousStatus !== 'connected' && current === 'connected' && phase === 'ready') void refreshLatest();
      previousStatus = current;
    });
  });

  $effect(() => {
    for (const entry of messages) {
      const id = entry.author.avatarAssetId;
      if (!id || id in untrack(() => avatars)) continue;
      avatars[id] = null;
      void assetUrl(id).then((url) => (avatars[id] = url));
    }
  });

  function nearBottom(): boolean {
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_SLACK;
  }

  async function scrollToBottom() {
    await tick();
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    atBottom = true;
    newBelow = false;
  }

  function onScroll() {
    atBottom = nearBottom();
    if (atBottom) newBelow = false;
    if (scroller && scroller.scrollTop < TOP_SLACK && cursor && !loadingOlder) void loadOlder();
  }

  async function load() {
    phase = 'loading';
    try {
      const page = await listChat(projectId);
      messages = mergeMessages(messages.filter((entry) => entry.pending), page.items);
      cursor = page.nextCursor;
      phase = 'ready';
      if (open) void scrollToBottom();
    } catch {
      phase = 'error';
    }
  }

  async function refreshLatest() {
    try {
      const stick = nearBottom();
      const page = await listChat(projectId);
      messages = mergeMessages(messages, page.items);
      if (stick && open) void scrollToBottom();
    } catch {
      // Se reintenta con la siguiente reconexión.
    }
  }

  async function loadMembers() {
    try {
      const { items } = await apiFetch(`/v1/projects/${projectId}/members`, { schema: ProjectMembersResponseSchema });
      members = items.map((item) => ({ userId: item.userId, name: item.name }));
    } catch {
      members = [];
    }
  }

  // Conserva la posición: lo que se añade arriba no mueve lo que se está leyendo.
  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    loadingOlder = true;
    try {
      const page = await listChat(projectId, cursor);
      const height = scroller?.scrollHeight ?? 0;
      const top = scroller?.scrollTop ?? 0;
      messages = mergeMessages(messages, page.items);
      cursor = page.nextCursor;
      await tick();
      if (scroller) scroller.scrollTop = top + (scroller.scrollHeight - height);
    } catch {
      showToast({ message: m.editor_chat_load_error(), tone: 'error' });
    } finally {
      loadingOlder = false;
    }
  }

  async function receive(incoming: ChatEntry) {
    const known = messages.some((entry) => entry.id === incoming.id);
    // El propio mensaje llega por aquí antes que la respuesta del POST: lo sustituye esa respuesta.
    if (!known && incoming.author.id === me.id && messages.some((entry) => entry.pending === 'sending' && entry.body === incoming.body)) return;
    const stick = open && nearBottom();
    messages = mergeMessages(messages, [incoming]);
    if (known || incoming.author.id === me.id) return;
    announcement = m.editor_chat_announce({ name: incoming.author.name ?? m.editor_chat_deleted_account(), body: incoming.body });
    if (stick) void scrollToBottom();
    else if (open) newBelow = true;
  }

  function onSend(input: ComposerSend) {
    const tempId = `tmp-${++seq}`;
    const payload = {
      body: input.body,
      ...(replyTo ? { replyToId: replyTo.id } : {}),
      ...(input.attachments.length ? { attachments: input.attachments.map((asset) => asset.id) } : {}),
      ...(input.mentions.length ? { mentions: input.mentions } : {}),
    };
    payloads[tempId] = payload;
    const entry: ChatEntry = {
      id: tempId,
      tempId,
      projectId,
      author: { id: me.id, name: me.name, avatarAssetId: me.avatarAssetId },
      body: input.body,
      replyTo: replyTo
        ? { id: replyTo.id, authorName: replyTo.author.name, excerpt: replyTo.body, deleted: replyTo.deletedAt !== null }
        : null,
      attachments: payload.attachments ?? [],
      mentions: payload.mentions ?? [],
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      pending: 'sending',
    };
    replyTo = null;
    messages = mergeMessages(messages, [entry]);
    void scrollToBottom();
    void deliver(tempId);
  }

  async function deliver(tempId: string) {
    const payload = payloads[tempId];
    if (!payload) return;
    messages = messages.map((entry) => (entry.id === tempId ? { ...entry, pending: 'sending' } : entry));
    try {
      const saved = await sendChat(projectId, payload);
      payloads = Object.fromEntries(Object.entries(payloads).filter(([id]) => id !== tempId));
      messages = mergeMessages(
        messages.filter((entry) => entry.id !== tempId),
        [saved],
      );
      void scrollToBottom();
    } catch {
      messages = messages.map((entry) => (entry.id === tempId ? { ...entry, pending: 'failed' } : entry));
    }
  }

  async function edit(entry: ChatEntry, body: string): Promise<boolean> {
    try {
      const saved = await editChat(projectId, entry.id, { body });
      messages = mergeMessages(messages, [saved]);
      return true;
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.editor_chat_edit_error(), tone: 'error' });
      return false;
    }
  }

  function askDelete(entry: ChatEntry) {
    removing = entry;
    confirmOpen = true;
  }

  async function remove() {
    const entry = removing;
    if (!entry) return;
    deleting = true;
    try {
      await deleteChat(projectId, entry.id);
      messages = messages.map((item) =>
        item.id === entry.id ? { ...item, body: '', attachments: [], mentions: [], deletedAt: new Date().toISOString() } : item,
      );
      confirmOpen = false;
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.editor_chat_delete_error(), tone: 'error' });
    } finally {
      deleting = false;
    }
  }

  function startReply(entry: ChatEntry) {
    replyTo = entry;
    composer?.focus();
  }

  function jumpTo(messageId: string) {
    const target = scroller?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function compactAt(index: number): boolean {
    const entry = messages[index]!;
    const previous = messages[index - 1];
    if (!previous || previous.author.id !== entry.author.id || previous.deletedAt || entry.replyTo) return false;
    return Date.parse(entry.createdAt) - Date.parse(previous.createdAt) < GROUP_MS;
  }

  function mentionNamesOf(entry: ChatEntry): string[] {
    return entry.mentions.flatMap((id) => {
      const name = id === me.id ? me.name : memberNames.get(id);
      return name ? [name] : [];
    });
  }

  export function focus() {
    composer?.focus();
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-sm" data-testid="chat-panel">
  <div class="relative min-h-0 flex-1">
    <div bind:this={scroller} onscroll={onScroll} class="scroll-thin h-full overflow-x-hidden overflow-y-auto p-3" data-testid="chat-scroller">
      {#if phase === 'loading'}
        <div role="status" class="flex flex-col gap-3">
          <span class="sr-only">{m.editor_chat_loading()}</span>
          {#each [0.8, 0.55, 0.7] as width, index (index)}
            <div class="flex items-start gap-2" aria-hidden="true">
              <Skeleton rounded="full" class="size-6 shrink-0" />
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton class="h-2.5 w-20" />
                <div style:width="{width * 100}%"><Skeleton class="h-9 w-full" /></div>
              </div>
            </div>
          {/each}
        </div>
      {:else if phase === 'error'}
        <div class="flex flex-col items-start gap-2 py-1" role="alert">
          <p class="text-ink-muted">{m.editor_chat_load_error()}</p>
          <button type="button" class="cursor-pointer font-semibold text-coral hover:underline" onclick={() => void load()}>
            {m.common_retry()}
          </button>
        </div>
      {:else}
        {#if cursor}
          <div class="flex justify-center py-2">
            <button
              type="button"
              disabled={loadingOlder}
              onclick={() => void loadOlder()}
              class="h-7 cursor-pointer rounded-full px-3 text-xs font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink disabled:cursor-wait"
            >
              {loadingOlder ? m.editor_chat_loading() : m.editor_chat_older()}
            </button>
          </div>
        {/if}
        {#if messages.length === 0}
          <p class="py-1 text-ink-muted">{m.editor_chat_empty()}</p>
        {:else}
          <ol aria-label={m.editor_chat_title()} class="flex min-w-0 flex-col gap-2">
            {#each messages as entry, index (entry.id)}
              <ChatMessage
                {entry}
                meId={me.id}
                compact={compactAt(index)}
                {canModerate}
                mentionNames={mentionNamesOf(entry)}
                avatar={entry.author.avatarAssetId ? (avatars[entry.author.avatarAssetId] ?? null) : null}
                onreply={startReply}
                onedit={edit}
                ondelete={askDelete}
                onretry={(item) => void deliver(item.id)}
                onquote={jumpTo}
              />
            {/each}
          </ol>
        {/if}
      {/if}
    </div>

    {#if newBelow}
      <button
        type="button"
        onclick={() => void scrollToBottom()}
        class="absolute bottom-2 left-1/2 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-coral px-3 text-xs font-semibold text-coral-ink shadow-float hover:bg-coral-hover"
      >
        <ArrowDown size={14} aria-hidden="true" />
        {m.editor_chat_new_messages()}
      </button>
    {/if}
  </div>

  <p class="h-5 shrink-0 truncate px-3 text-xs text-ink-muted" aria-live="polite" data-testid="chat-typing">{typingText}</p>

  <ChatComposer
    bind:this={composer}
    {projectId}
    members={others}
    {replyTo}
    oncancelreply={() => (replyTo = null)}
    onsend={onSend}
    ontyping={() => typing.input()}
    onstoptyping={() => typing.stop()}
  />

  <div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.editor_chat_delete_title()}
  description={m.editor_chat_delete_body()}
  confirmLabel={m.editor_chat_delete()}
  danger
  busy={deleting}
  onconfirm={() => void remove()}
/>
