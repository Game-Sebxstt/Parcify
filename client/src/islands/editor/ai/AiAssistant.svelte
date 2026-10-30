<script lang="ts">
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import X from '@lucide/svelte/icons/x';
  import { onMount, untrack } from 'svelte';
  import type { Engine } from '../../../engine/index.ts';
  import { ApiError } from '../../../lib/api.ts';
  import { requestAssistant } from '../../../lib/ai.ts';
  import { m } from '../../../paraglide/messages.js';
  import { ASSISTANT_LIMITS, type AssistantOp, type AssistantResponse } from '../../../shared/ai/assistant.js';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import Button from '../../../ui/Button.svelte';
  import { kindLabel } from '../kinds.ts';

  type Props = {
    engine: Engine;
    projectId: string;
    readOnly: boolean;
    // Prompt que llega desde el chat («Convertir en cambios del lienzo»); `n` cambia en cada envío.
    request: { prompt: string; n: number } | null;
  };

  let { engine, projectId, readOnly, request }: Props = $props();

  const uid = $props.id();
  let prompt = $state('');
  // Petición anterior que «Pedir otro cambio» reutiliza como contexto.
  let previous = $state<string | null>(null);
  let phase = $state<'idle' | 'working' | 'preview'>('idle');
  let result = $state.raw<AssistantResponse | null>(null);
  let lastPrompt = '';
  let abort: AbortController | null = null;
  let field = $state<HTMLTextAreaElement | null>(null);

  type Recognition = {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    start(): void;
    stop(): void;
    onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
  };
  type RecognitionCtor = new () => Recognition;

  // Dictado con la Web Speech API del navegador; sin ella, no hay botón. El audio no pasa por nuestro servidor.
  let Speech = $state.raw<RecognitionCtor | null>(null);
  let recognition: Recognition | null = null;
  let listening = $state(false);

  onMount(() => {
    const scope = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    Speech = scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
    return () => {
      recognition?.stop();
      abort?.abort();
      engine.core.presence.update({ aiBusy: false });
      engine.core.setAiPreview(null);
    };
  });

  $effect(() => {
    const incoming = request;
    if (!incoming) return;
    untrack(() => {
      previous = null;
      prompt = incoming.prompt.slice(0, ASSISTANT_LIMITS.promptMax);
      void submit();
    });
  });

  const fullPrompt = $derived(
    previous ? `${previous}\n\n${m.editor_ai_followup_join()} ${prompt.trim()}`.slice(0, ASSISTANT_LIMITS.promptMax) : prompt.trim(),
  );
  const canSubmit = $derived(!readOnly && phase !== 'working' && prompt.trim().length > 0);

  function toggleMic() {
    if (!Speech) return;
    if (listening) {
      recognition?.stop();
      return;
    }
    const instance = new Speech();
    instance.lang = document.documentElement.lang || 'es';
    instance.interimResults = false;
    instance.continuous = false;
    const start = prompt;
    instance.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) text += event.results[i]![0]!.transcript;
      prompt = `${start}${start && !start.endsWith(' ') ? ' ' : ''}${text}`.slice(0, ASSISTANT_LIMITS.promptMax);
    };
    instance.onend = () => {
      listening = false;
      recognition = null;
    };
    instance.onerror = () => {
      listening = false;
    };
    recognition = instance;
    listening = true;
    instance.start();
  }

  // Las imágenes seleccionadas viajan como contexto (por assetId: el servidor lee sus bytes).
  function selectedImages(): string[] {
    const ids = engine.state.selectionRecords.get().flatMap((record) => (record.type === 'image' ? [record.assetId] : []));
    return ids.filter((id, index) => ids.indexOf(id) === index).slice(0, ASSISTANT_LIMITS.imagesMax);
  }

  async function submit() {
    if (readOnly || phase === 'working') return;
    const text = fullPrompt;
    if (!text) return;
    const context = engine.core.aiContext();
    if (!context) return;
    engine.core.setAiPreview(null);
    result = null;
    phase = 'working';
    lastPrompt = text;
    abort = new AbortController();
    const images = selectedImages();
    engine.core.presence.update({ aiBusy: true });
    try {
      const response = await requestAssistant(projectId, { prompt: text, ...context, ...(images.length ? { imageAssetIds: images } : {}) }, abort.signal);
      if (!response.plan.ops.length) {
        showToast({ message: response.plan.summary || m.editor_ai_nothing() });
        phase = 'idle';
        return;
      }
      result = response;
      engine.core.setAiPreview(response.plan);
      phase = 'preview';
    } catch (error) {
      phase = 'idle';
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Un 429 ya muestra su propio aviso.
      if (!(error instanceof ApiError && error.status === 429)) {
        showToast({ message: error instanceof ApiError ? error.message : m.editor_ai_error(), tone: 'error' });
      }
    } finally {
      abort = null;
      engine.core.presence.update({ aiBusy: false });
    }
  }

  function cancel() {
    abort?.abort();
  }

  function applyPlan() {
    if (!result) return;
    const { applied, skipped } = engine.commands.applyAiPlan(result.plan);
    engine.core.setAiPreview(null);
    result = null;
    previous = null;
    prompt = '';
    phase = 'idle';
    if (applied) showToast({ message: m.editor_ai_applied() });
    if (skipped) showToast({ message: m.editor_ai_skipped({ count: skipped }), tone: 'error' });
  }

  function discard() {
    engine.core.setAiPreview(null);
    result = null;
    phase = 'idle';
  }

  function followUp() {
    discard();
    previous = lastPrompt;
    prompt = '';
    field?.focus();
  }

  function nameOf(id: string): string {
    const record = engine.core.store.get(id);
    if (!record) return id;
    return record.name || kindLabel(record.type);
  }

  function describe(op: AssistantOp): string {
    if (op.op === 'create') return m.editor_ai_op_create({ kind: kindLabel(op.node.type) });
    if (op.op === 'update') return m.editor_ai_op_update({ name: nameOf(op.id) });
    return m.editor_ai_op_delete({ name: nameOf(op.id) });
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3" data-testid="ai-assistant">
  {#if readOnly}
    <p class="text-ink-muted">{m.editor_ai_readonly()}</p>
  {:else if phase === 'preview' && result}
    <section aria-labelledby="{uid}-preview" class="flex flex-col gap-3" data-testid="ai-preview">
      <h3 id="{uid}-preview" class="font-semibold">{m.editor_ai_preview_title()}</h3>
      <p>{result.plan.summary}</p>
      <p class="text-xs text-ink-muted">{m.editor_ai_changes({ count: result.plan.ops.length })}</p>
      <ul class="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-panel bg-surface-2 p-2 text-xs">
        {#each result.plan.ops as op, index (index)}
          <li class={['truncate', op.op === 'delete' ? 'text-danger line-through' : ''].join(' ')}>{describe(op)}</li>
        {/each}
      </ul>
      {#if result.dropped}
        <p class="text-xs text-ink-muted">{m.editor_ai_dropped({ count: result.dropped })}</p>
      {/if}
      <div class="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onclick={applyPlan} data-testid="ai-apply">{m.editor_ai_apply()}</Button>
        <Button variant="secondary" size="sm" onclick={discard} data-testid="ai-discard">{m.editor_ai_discard()}</Button>
        <Button variant="ghost" size="sm" onclick={followUp}>{m.editor_ai_followup()}</Button>
      </div>
    </section>
  {:else}
    <form
      class="flex flex-col gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label for="{uid}-prompt" class="font-medium">{m.editor_ai_prompt_label()}</label>
      {#if previous}
        <div class="flex items-start gap-2 rounded-panel bg-surface-2 py-1.5 pr-1 pl-3 text-xs text-ink-muted">
          <p class="line-clamp-2 flex-1">{m.editor_ai_followup_on({ prompt: previous })}</p>
          <button
            type="button"
            aria-label={m.editor_ai_followup_clear()}
            onclick={() => (previous = null)}
            class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-petrol hover:text-ink"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      {/if}
      <div class="relative">
        <textarea
          bind:this={field}
          id="{uid}-prompt"
          bind:value={prompt}
          onkeydown={onKey}
          maxlength={ASSISTANT_LIMITS.promptMax}
          rows="4"
          disabled={phase === 'working'}
          placeholder={m.editor_ai_prompt_placeholder()}
          aria-describedby="{uid}-hint"
          class="w-full resize-none rounded-panel bg-surface-2 px-3 py-2 pr-10 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-60"
          data-autofocus
          data-testid="ai-prompt"
        ></textarea>
        {#if Speech}
          <button
            type="button"
            aria-label={listening ? m.editor_ai_mic_stop() : m.editor_ai_mic_start()}
            aria-pressed={listening}
            disabled={phase === 'working'}
            onclick={toggleMic}
            class={[
              'absolute top-1.5 right-1.5 inline-flex size-8 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed',
              listening ? 'bg-coral text-coral-ink' : 'text-ink-muted hover:bg-petrol hover:text-ink',
            ].join(' ')}
          >
            {#if listening}<MicOff size={16} aria-hidden="true" />{:else}<Mic size={16} aria-hidden="true" />{/if}
          </button>
        {/if}
      </div>
      <p id="{uid}-hint" class="text-xs text-ink-muted">{m.editor_ai_context_hint()}</p>
      <div class="flex items-center gap-2">
        {#if phase === 'working'}
          <p role="status" class="flex-1 text-ink-muted">{m.editor_ai_working()}</p>
          <Button variant="secondary" size="sm" onclick={cancel}>{m.editor_ai_cancel()}</Button>
        {:else}
          <Button type="submit" variant="primary" size="sm" disabled={!canSubmit} data-testid="ai-submit">{m.editor_ai_submit()}</Button>
        {/if}
      </div>
    </form>
  {/if}
</div>
