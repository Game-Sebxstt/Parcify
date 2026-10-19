<script lang="ts">
  import Play from '@lucide/svelte/icons/play';
  import X from '@lucide/svelte/icons/x';
  import { onMount } from 'svelte';
  import type { Engine } from '../../../engine/index.ts';
  import { requestAnimation } from '../../../lib/ai.ts';
  import { ApiError } from '../../../lib/api.ts';
  import { m } from '../../../paraglide/messages.js';
  import { AI_ANIMATION_LIMITS, type AnimationResponse } from '../../../shared/ai/animation.js';
  import Button from '../../../ui/Button.svelte';
  import { showToast } from '../../../ui/toast.svelte.ts';

  type Props = {
    engine: Engine;
    projectId: string;
    selection: readonly string[];
    onclose: () => void;
  };

  let { engine, projectId, selection, onclose }: Props = $props();

  const uid = $props.id();
  let prompt = $state('');
  let phase = $state<'idle' | 'working' | 'preview'>('idle');
  let result = $state.raw<AnimationResponse | null>(null);
  let abort: AbortController | null = null;
  let field = $state<HTMLTextAreaElement | null>(null);

  // Los conectores no se animan.
  const targets = $derived(
    selection.filter((id) => {
      const record = engine.core.store.get(id);
      return !!record && record.type !== 'connector';
    }),
  );
  const canSubmit = $derived(phase !== 'working' && prompt.trim().length > 0 && targets.length > 0);

  onMount(() => {
    field?.focus();
    return () => {
      abort?.abort();
      engine.core.presence.update({ aiBusy: false });
      engine.core.setAiAnimationPreview(null);
    };
  });

  async function submit() {
    if (!canSubmit) return;
    const context = engine.core.aiContext();
    if (!context) return;
    const nodeIds = targets.slice(0, AI_ANIMATION_LIMITS.nodeIdsMax);
    discard();
    phase = 'working';
    abort = new AbortController();
    engine.core.presence.update({ aiBusy: true });
    try {
      const response = await requestAnimation(projectId, { prompt: prompt.trim(), nodeIds, canvas: context.canvas }, abort.signal);
      if (!response.plan.animations.length) {
        showToast({ message: response.plan.summary || m.timeline_ai_nothing() });
        phase = 'idle';
        return;
      }
      result = response;
      engine.core.setAiAnimationPreview(response.plan);
      phase = 'preview';
    } catch (error) {
      phase = 'idle';
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!(error instanceof ApiError && error.status === 429)) {
        showToast({ message: error instanceof ApiError ? error.message : m.timeline_ai_error(), tone: 'error' });
      }
    } finally {
      abort = null;
      engine.core.presence.update({ aiBusy: false });
    }
  }

  // Las pistas propuestas se reproducen en las vistas; el documento no cambia.
  function playPreview() {
    engine.anim.seek(0);
    engine.anim.play();
  }

  function apply() {
    if (!result) return;
    engine.anim.stop();
    const { applied, skipped } = engine.anim.keyframes.applyAiAnimations(result.plan);
    engine.core.setAiAnimationPreview(null);
    result = null;
    prompt = '';
    phase = 'idle';
    if (applied) showToast({ message: m.timeline_ai_applied() });
    if (skipped) showToast({ message: m.timeline_ai_skipped({ count: skipped }), tone: 'error' });
  }

  function discard() {
    engine.core.setAiAnimationPreview(null);
    result = null;
    phase = 'idle';
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  aria-labelledby="{uid}-title"
  onkeydown={onKey}
  class="flex flex-col gap-2 rounded-panel bg-surface-2 p-3 text-sm shadow-float"
  data-testid="ai-animate"
>
  <div class="flex items-center justify-between gap-2">
    <h3 id="{uid}-title" class="font-semibold">{phase === 'preview' ? m.timeline_ai_preview_title() : m.timeline_ai_title()}</h3>
    <button
      type="button"
      aria-label={m.timeline_ai_close()}
      onclick={onclose}
      class="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-petrol hover:text-ink"
    >
      <X size={14} aria-hidden="true" />
    </button>
  </div>

  {#if phase === 'preview' && result}
    <p>{result.plan.summary}</p>
    <p class="text-xs text-ink-muted">{m.timeline_ai_preview_count({ count: result.plan.animations.length })}</p>
    {#if result.dropped}
      <p class="text-xs text-ink-muted">{m.timeline_ai_dropped({ count: result.dropped })}</p>
    {/if}
    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onclick={playPreview} data-testid="ai-animate-play">
        <Play size={14} aria-hidden="true" />
        {m.timeline_ai_play()}
      </Button>
      <Button variant="primary" size="sm" onclick={apply} data-testid="ai-animate-apply">{m.timeline_ai_apply()}</Button>
      <Button variant="ghost" size="sm" onclick={discard} data-testid="ai-animate-discard">{m.timeline_ai_discard()}</Button>
    </div>
  {:else}
    <form
      class="flex flex-col gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label for="{uid}-prompt" class="text-xs font-medium">{m.timeline_ai_prompt()}</label>
      <textarea
        bind:this={field}
        id="{uid}-prompt"
        bind:value={prompt}
        rows="3"
        maxlength={AI_ANIMATION_LIMITS.promptMax}
        disabled={phase === 'working'}
        placeholder={m.timeline_ai_placeholder()}
        aria-describedby="{uid}-hint"
        class="w-full resize-none rounded-[6px] bg-surface-1 px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-60"
        data-testid="ai-animate-prompt"
      ></textarea>
      <p id="{uid}-hint" class="text-xs text-ink-muted">{targets.length ? m.timeline_ai_hint() : m.timeline_ai_no_selection()}</p>
      <div class="flex items-center gap-2">
        {#if phase === 'working'}
          <p role="status" class="flex-1 text-ink-muted">{m.timeline_ai_working()}</p>
          <Button variant="secondary" size="sm" onclick={() => abort?.abort()}>{m.timeline_ai_cancel()}</Button>
        {:else}
          <Button type="submit" variant="primary" size="sm" disabled={!canSubmit} data-testid="ai-animate-submit">{m.timeline_ai_submit()}</Button>
        {/if}
      </div>
    </form>
  {/if}
</section>
