<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Send from '@lucide/svelte/icons/send';
  import Square from '@lucide/svelte/icons/square';
  import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
  import X from '@lucide/svelte/icons/x';
  import { onMount, tick, untrack } from 'svelte';
  import type { Engine } from '../../../engine/index.ts';
  import { chatTransport, conversationOf, listConversations, loadConversation, type AiChatMessage } from '../../../lib/ai-chat.ts';
  import { renderMarkdown } from '../../../lib/markdown.ts';
  import { m } from '../../../paraglide/messages.js';
  import { ASSISTANT_LIMITS } from '../../../shared/ai/assistant.js';
  import { AI_CHAT_LIMITS } from '../../../shared/api/ai.js';
  import Button from '../../../ui/Button.svelte';
  import Select from '../../../ui/Select.svelte';

  type Props = {
    engine: Engine;
    projectId: string;
    // El usuario puede usar el asistente: habilita «Convertir en cambios del lienzo».
    canConvert: boolean;
    onconvert: (prompt: string) => void;
    // Imagen de la galería que llega con «Enviar al chat de IA»; `n` cambia en cada envío.
    attachment: { assetId: string; name: string; n: number } | null;
  };

  let { engine, projectId, canConvert, onconvert, attachment }: Props = $props();

  // Imágenes que acompañarán al próximo mensaje; `sending` es lo que viaja en la petición en curso.
  let attached = $state.raw<Array<{ assetId: string; name: string }>>([]);
  let sending: string[] = [];

  $effect(() => {
    const incoming = attachment;
    if (!incoming) return;
    untrack(() => {
      if (attached.some((item) => item.assetId === incoming.assetId)) return;
      attached = [...attached, { assetId: incoming.assetId, name: incoming.name }].slice(-ASSISTANT_LIMITS.imagesMax);
      field?.focus();
    });
  });

  const uid = $props.id();
  let conversationId = $state<string | null>(null);
  let conversations = $state.raw<Array<{ id: string; title: string | null }>>([]);
  let phase = $state<'loading' | 'ready' | 'error'>('loading');
  let input = $state('');
  let scroller = $state<HTMLDivElement | null>(null);
  let field = $state<HTMLTextAreaElement | null>(null);

  const chat: Chat<AiChatMessage> = new Chat<AiChatMessage>({
      transport: chatTransport(() => ({
        projectId,
        // Una conversación nueva se conoce por los metadatos de la primera respuesta, aunque no terminara.
        conversationId: conversationId ?? conversationOf(chat.messages.findLast((message: AiChatMessage) => message.role === 'assistant')),
        canvas: engine.core.aiContext(ASSISTANT_LIMITS.chatCanvasMax)?.canvas ?? [],
        imageAssetIds: sending,
      })),
      onFinish: ({ message }) => {
        conversationId ??= conversationOf(message);
        void refreshList();
      },
    });

  const busy = $derived(chat.status === 'submitted' || chat.status === 'streaming');
  // Valor de la opción «Nueva conversación»: la lista no admite una opción con valor vacío.
  const NEW = 'new';
  const history = $derived([
    { value: NEW, label: m.editor_ai_chat_new() },
    ...conversations.map((item) => ({ value: item.id, label: item.title ?? m.editor_ai_chat_untitled() })),
  ]);
  const lastAssistant = $derived(chat.messages.findLast((message) => message.role === 'assistant'));

  onMount(() => {
    void start();
    return () => void chat.stop();
  });

  async function refreshList() {
    try {
      const list = await listConversations(projectId);
      conversations = list.items.map((item) => ({ id: item.id, title: item.title }));
    } catch {
      // La lista es secundaria: si falla, se queda la anterior.
    }
  }

  // Abre la conversación más reciente, si la hay.
  async function start() {
    phase = 'loading';
    try {
      const list = await listConversations(projectId);
      conversations = list.items.map((item) => ({ id: item.id, title: item.title }));
      const latest = list.items[0];
      if (latest) await open(latest.id);
      phase = 'ready';
    } catch {
      phase = 'error';
    }
  }

  async function open(id: string) {
    await chat.stop();
    chat.messages = await loadConversation(projectId, id);
    conversationId = id;
    chat.clearError();
    void scrollToBottom();
  }

  async function startNew() {
    await chat.stop();
    chat.messages = [];
    conversationId = null;
    chat.clearError();
  }

  async function onPick(id: string) {
    if (id === NEW) await startNew();
    else {
      try {
        await open(id);
      } catch {
        phase = 'error';
      }
    }
  }

  async function scrollToBottom() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    input = '';
    sending = attached.map((item) => item.assetId);
    attached = [];
    void chat.sendMessage({ text });
    void scrollToBottom();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function textOf(message: AiChatMessage): string {
    return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
  }

  $effect(() => {
    // Baja con cada trozo que llega.
    void chat.messages.at(-1)?.parts.length;
    void scrollToBottom();
  });
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="ai-chat">
  <div class="flex items-center gap-2 px-3 pb-2">
    <Select
      items={history}
      bind:value={() => conversationId ?? NEW, (next) => void onPick(next)}
      label={m.editor_ai_chat_history()}
      disabled={busy}
      class="min-w-0 flex-1 text-xs"
    />
    <Button variant="ghost" size="sm" iconOnly label={m.editor_ai_chat_new()} disabled={busy} onclick={() => void startNew()}>
      <Plus size={16} aria-hidden="true" />
    </Button>
  </div>

  <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto px-3" aria-live="polite" aria-busy={busy}>
    {#if phase === 'loading'}
      <p class="py-4 text-ink-muted" role="status">{m.editor_ai_chat_loading()}</p>
    {:else if phase === 'error'}
      <div class="flex flex-col items-start gap-2 py-4" role="alert">
        <p class="text-ink-muted">{m.editor_ai_chat_load_error()}</p>
        <button type="button" class="cursor-pointer font-semibold text-coral hover:underline" onclick={() => void start()}>{m.common_retry()}</button>
      </div>
    {:else if chat.messages.length === 0}
      <p class="py-4 text-ink-muted">{m.editor_ai_chat_empty()}</p>
    {:else}
      <ol class="flex flex-col gap-3 pb-3">
        {#each chat.messages as message (message.id)}
          <li class={message.role === 'user' ? 'self-end' : 'self-start'}>
            <p class="mb-0.5 text-xs text-ink-muted">{message.role === 'user' ? m.editor_ai_chat_you() : m.editor_ai_chat_ai()}</p>
            {#if message.role === 'user'}
              <p class="rounded-panel bg-petrol px-3 py-2 whitespace-pre-wrap">{textOf(message)}</p>
            {:else}
              <!-- Markdown saneado con lista blanca (sin img, sin on*, enlaces solo https): único {@html} permitido. -->
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <div class="ai-markdown rounded-panel bg-surface-2 px-3 py-2">{@html renderMarkdown(textOf(message))}</div>
            {/if}
          </li>
        {/each}
      </ol>
      {#if chat.status === 'submitted'}
        <p class="pb-3 text-ink-muted" role="status">{m.editor_ai_chat_thinking()}</p>
      {/if}
    {/if}
    {#if chat.error}
      <div class="flex flex-col items-start gap-1 pb-3" role="alert">
        <p class="text-danger">{chat.error.message}</p>
        <button type="button" class="cursor-pointer text-xs font-semibold text-coral hover:underline" onclick={() => void chat.regenerate()}>
          {m.common_retry()}
        </button>
      </div>
    {/if}
  </div>

  {#if canConvert && lastAssistant && !busy}
    <div class="px-3 pb-2">
      <Button variant="secondary" size="sm" class="w-full" onclick={() => onconvert(textOf(lastAssistant).slice(0, ASSISTANT_LIMITS.promptMax))} data-testid="ai-chat-convert">
        <WandSparkles size={14} aria-hidden="true" />
        {m.editor_ai_chat_convert()}
      </Button>
    </div>
  {/if}

  {#if attached.length}
    <ul class="flex flex-wrap gap-1 px-3 pb-2">
      {#each attached as item (item.assetId)}
        <li class="flex max-w-full items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-0.5 pl-3 text-xs text-ink-muted" data-testid="ai-chat-attachment">
          <span class="truncate">{m.editor_ai_chat_attachment({ name: item.name })}</span>
          <button
            type="button"
            aria-label={m.editor_ai_chat_attachment_remove({ name: item.name })}
            onclick={() => (attached = attached.filter((other) => other.assetId !== item.assetId))}
            class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-petrol hover:text-ink"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <form
    class="flex items-end gap-2 px-3 pb-3"
    onsubmit={(event) => {
      event.preventDefault();
      send();
    }}
  >
    <label for="{uid}-input" class="sr-only">{m.editor_ai_chat_label()}</label>
    <textarea
      bind:this={field}
      id="{uid}-input"
      bind:value={input}
      onkeydown={onKey}
      rows="2"
      maxlength={AI_CHAT_LIMITS.messageMax}
      placeholder={m.editor_ai_chat_placeholder()}
      class="min-w-0 flex-1 resize-none rounded-panel bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-coral"
      data-testid="ai-chat-input"
    ></textarea>
    {#if busy}
      <Button variant="secondary" iconOnly label={m.editor_ai_chat_stop()} onclick={() => void chat.stop()}>
        <Square size={16} aria-hidden="true" />
      </Button>
    {:else}
      <Button type="submit" variant="primary" iconOnly label={m.editor_ai_chat_send()} disabled={!input.trim()}>
        <Send size={16} aria-hidden="true" />
      </Button>
    {/if}
  </form>
</div>

<style>
  .ai-markdown :global(p + p),
  .ai-markdown :global(ul),
  .ai-markdown :global(ol),
  .ai-markdown :global(pre),
  .ai-markdown :global(blockquote) {
    margin-top: 0.5rem;
  }
  .ai-markdown :global(ul) {
    list-style: disc;
    padding-left: 1.25rem;
  }
  .ai-markdown :global(ol) {
    list-style: decimal;
    padding-left: 1.25rem;
  }
  .ai-markdown :global(a) {
    color: var(--color-coral);
    text-decoration: underline;
  }
  .ai-markdown :global(code) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.85em;
  }
  .ai-markdown :global(pre) {
    overflow-x: auto;
  }
  .ai-markdown :global(h1),
  .ai-markdown :global(h2),
  .ai-markdown :global(h3),
  .ai-markdown :global(h4) {
    font-weight: 600;
    margin-top: 0.5rem;
  }
</style>
