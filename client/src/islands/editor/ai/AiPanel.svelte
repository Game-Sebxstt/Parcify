<script lang="ts">
  import { untrack } from 'svelte';
  import type { Engine } from '../../../engine/index.ts';
  import type { AiFeatures } from '../../../lib/ai.ts';
  import { m } from '../../../paraglide/messages.js';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import AiAssistant from './AiAssistant.svelte';
  import type AiChat from './AiChat.svelte';

  type Props = {
    engine: Engine;
    projectId: string;
    features: AiFeatures;
    readOnly: boolean;
    // Imagen de la galería para el chat («Enviar al chat de IA»).
    attachment: { assetId: string; name: string; n: number } | null;
  };

  let { engine, projectId, features, readOnly, attachment }: Props = $props();

  type Tab = 'assistant' | 'chat';
  const uid = $props.id();
  let tab = $state<Tab>(untrack(() => features.assistant) ? 'assistant' : 'chat');
  let request = $state.raw<{ prompt: string; n: number } | null>(null);
  // El chat (con su Markdown y la clase Chat) se descarga la primera vez que se abre.
  let Chat = $state.raw<typeof AiChat | null>(null);
  let chatLoading = $state(false);

  const tabs = $derived(
    [
      features.assistant ? { value: 'assistant' as const, label: m.editor_ai_tab_assistant() } : null,
      features.chat ? { value: 'chat' as const, label: m.editor_ai_tab_chat() } : null,
    ].filter((item) => item !== null),
  );

  $effect(() => {
    if (tab === 'chat' && !Chat && !chatLoading) void loadChat();
  });

  $effect(() => {
    if (attachment && features.chat) untrack(() => (tab = 'chat'));
  });

  async function loadChat() {
    chatLoading = true;
    try {
      Chat = (await import('./AiChat.svelte')).default;
    } catch {
      showToast({ message: m.editor_load_error(), tone: 'error' });
    } finally {
      chatLoading = false;
    }
  }

  function convert(prompt: string) {
    if (!prompt.trim()) return;
    tab = 'assistant';
    request = { prompt, n: (request?.n ?? 0) + 1 };
  }

  function onTabKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = tabs.findIndex((item) => item.value === tab);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    event.preventDefault();
    tab = next.value;
    document.getElementById(`${uid}-tab-${next.value}`)?.focus();
  }

</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-3 text-sm" data-testid="ai-panel">
  {#if tabs.length > 1}
    <div role="tablist" aria-label={m.editor_ai_tabs()} tabindex="-1" onkeydown={onTabKey} class="mx-3 mb-3 inline-flex gap-1 self-start rounded-full bg-surface-2 p-1">
      {#each tabs as item (item.value)}
        <button
          id="{uid}-tab-{item.value}"
          type="button"
          role="tab"
          aria-selected={tab === item.value}
          aria-controls="{uid}-panel"
          tabindex={tab === item.value ? 0 : -1}
          onclick={() => (tab = item.value)}
          class={[
            'h-7 cursor-pointer rounded-full px-3 text-xs font-medium',
            tab === item.value ? 'bg-petrol text-ink' : 'text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          {item.label}
        </button>
      {/each}
    </div>
  {/if}

  <div id="{uid}-panel" role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `${uid}-tab-${tab}` : undefined} class="flex min-h-0 flex-1 flex-col">
    {#if features.assistant}
      <div class={['min-h-0 flex-1 flex-col', tab === 'assistant' ? 'flex' : 'hidden'].join(' ')}>
        <AiAssistant {engine} {projectId} {readOnly} {request} />
      </div>
    {/if}
    <!-- Una vez cargado, el chat sigue montado al cambiar de pestaña: no corta una respuesta en curso. -->
    {#if Chat}
      <div class={['min-h-0 flex-1 flex-col', tab === 'chat' ? 'flex' : 'hidden'].join(' ')}>
        <Chat {engine} {projectId} canConvert={features.assistant && !readOnly} onconvert={convert} {attachment} />
      </div>
    {:else if tab === 'chat'}
      <p class="px-3 py-4 text-ink-muted" role="status">{m.editor_ai_chat_loading()}</p>
    {/if}
  </div>
</div>
