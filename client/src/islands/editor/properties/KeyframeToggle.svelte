<script lang="ts">
  import { keyframeKeyAt, type KeyRef, type NodeRecord } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import type { AnimProp } from '../../../shared/document/schema.js';
  import Tooltip from '../../../ui/Tooltip.svelte';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import { formatTime } from '../timeline/model.ts';
  import { animatable, type KeyframeContext } from './panel.ts';

  type Props = {
    context: KeyframeContext;
    records: readonly NodeRecord[];
    prop: AnimProp;
    // Nombre del campo al que acompaña («X», «Opacidad»).
    label: string;
    testid?: string;
    // Tabindex itinerante de la rejilla de la línea de tiempo.
    tabindex?: number | undefined;
  };

  let { context, records, prop, label, testid, tabindex }: Props = $props();

  const ids = $derived(records.filter((record) => animatable(record, prop)).map((record) => record.id));

  // Gris sin pista, contorno coral con pista y relleno coral con un keyframe en el cabezal en todos los nodos.
  const marks = $derived.by(() => {
    void context.version;
    const keys: KeyRef[] = [];
    let tracked = false;
    for (const id of ids) {
      const animation = context.engine.core.store.animation(id);
      if (Object.keys(animation?.tracks[prop] ?? {}).length) tracked = true;
      const key = keyframeKeyAt(animation, prop, context.at);
      if (key) keys.push({ nodeId: id, prop, key });
    }
    const all = ids.length > 0 && keys.length === ids.length;
    return { keys, tracked, all };
  });

  const time = $derived(formatTime(context.at));
  const tip = $derived(marks.all ? m.editor_keyframe_remove({ prop: label, time }) : m.editor_keyframe_add({ prop: label, time }));

  function toggle() {
    const keyframes = context.engine.anim.keyframes;
    if (marks.all) {
      keyframes.deleteKeyframes(marks.keys);
      return;
    }
    const missing = ids.filter((id) => !marks.keys.some((ref) => ref.nodeId === id));
    if (!keyframes.keyframesAtTime(missing.map((nodeId) => ({ nodeId, prop })), context.at).length) {
      showToast({ message: m.timeline_add_error(), tone: 'error' });
    }
  }
</script>

{#if ids.length}
  <Tooltip text={tip} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-label={m.editor_keyframe_toggle({ prop: label, time })}
        aria-pressed={marks.all}
        data-testid={testid}
        data-key={marks.all ? 'key' : marks.tracked ? 'track' : 'none'}
        {tabindex}
        onclick={toggle}
        class={[
          'group/key inline-flex size-6 shrink-0 cursor-pointer items-center justify-start rounded-xs pl-1',
          'sheet:size-11 sheet:justify-center sheet:pl-0',
          'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral',
        ]}
      >
        <span
          aria-hidden="true"
          class={[
            'block size-2 rotate-45 rounded-[1px] border transition-colors duration-(--dur-fast)',
            marks.all ? 'border-coral bg-coral' : marks.tracked ? 'border-coral bg-surface-1' : 'border-ink-muted bg-surface-1 group-hover/key:border-ink',
          ]}
        ></span>
      </button>
    {/snippet}
  </Tooltip>
{/if}
