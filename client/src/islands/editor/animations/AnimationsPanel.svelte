<script lang="ts">
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import { fromStore } from 'svelte/store';
  import { displayName, kindOf } from '../../../engine/a11y/describe.ts';
  import type { Engine, NodeRecord } from '../../../engine/index.ts';
  import { formatNumber } from '../../../lib/format.ts';
  import { m } from '../../../paraglide/messages.js';
  import type { Animation } from '../../../shared/document/schema.js';
  import Tooltip from '../../../ui/Tooltip.svelte';
  import { kindIcon } from '../kind-icons.ts';
  import { kindLabel } from '../kinds.ts';

  type Props = { engine: Engine };

  let { engine }: Props = $props();

  type Row = { id: string; record: NodeRecord; animation: Animation; name: string };

  const uid = $props.id();
  const version = $derived(fromStore(engine.anim.version));
  const layers = $derived(fromStore(engine.state.layersVersion));
  const page = $derived(fromStore(engine.state.pageId));
  const selection = $derived(fromStore(engine.state.selection));
  const playerState = $derived(fromStore(engine.anim.state));

  // Nodos animados de la página activa, de arriba abajo como en el panel de capas.
  const rows = $derived.by((): Row[] => {
    void version.current;
    void layers.current;
    const pageId = page.current;
    if (!pageId) return [];
    const animations = new Map(engine.core.store.animations());
    const out: Row[] = [];
    for (const id of [...engine.core.tree.paintOrder(pageId)].reverse()) {
      const animation = animations.get(id);
      const record = animation ? engine.core.store.get(id) : undefined;
      if (!animation || !record || record.type === 'connector') continue;
      const text = record.type === 'text' ? engine.core.store.text(id) : '';
      out.push({ id, record, animation, name: displayName(record, kindLabel(kindOf(record)), text) });
    }
    return out;
  });
  const selected = $derived(new Set(selection.current));
  // Lo que se está reproduciendo en vista previa (null si no hay ninguna).
  const previewing = $derived.by(() => {
    const player = playerState.current;
    return player.preview && player.status === 'playing' ? new Set(player.previewIds ?? []) : null;
  });

  const seconds = (ms: number) => `${formatNumber(ms / 1000, { maximumFractionDigits: 2 })} s`;

  function summary(animation: Animation): string {
    const time = seconds(animation.duration);
    if (animation.loop === 0) return `${time} · ${m.editor_anim_repeat_forever()}`;
    if (animation.loop > 1) return `${time} · ${m.editor_anim_repeat({ count: animation.loop })}`;
    return time;
  }

  function play(ids: readonly string[]) {
    engine.anim.preview(ids);
  }

  function stop() {
    engine.anim.preview(null);
  }

  // Un clic en la fila selecciona el nodo y solo mueve la vista si queda fuera.
  function select(id: string) {
    engine.commands.select([id]);
    engine.core.revealSelection();
  }

  const PLAY_BUTTON = [
    'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast)',
    'hover:bg-surface-2 hover:text-ink focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral',
  ];
</script>

<section aria-labelledby="{uid}-title" class="flex min-h-0 flex-1 flex-col" data-testid="animations-panel">
  <div class="flex h-8 shrink-0 items-center gap-1 pr-2 pl-3">
    <h2 id="{uid}-title" class="min-w-0 flex-1 truncate text-2xs font-semibold text-ink-muted">{m.editor_anim_library_title()}</h2>
    {#if previewing}
      <Tooltip text={m.editor_anim_stop()} side="bottom">
        {#snippet children(props)}
          <button {...props} type="button" aria-label={m.editor_anim_stop()} class={PLAY_BUTTON} data-testid="animations-stop" onclick={stop}>
            <Square size={10} fill="currentColor" aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
    {/if}
    {#if rows.length}
      <Tooltip text={m.editor_anim_play_all()} side="bottom">
        {#snippet children(props)}
          <button
            {...props}
            type="button"
            aria-label={m.editor_anim_play_all()}
            class={PLAY_BUTTON}
            data-testid="animations-play-all"
            onclick={() => play(rows.map((row) => row.id))}
          >
            <Play size={14} aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
    {/if}
  </div>
  {#if rows.length === 0}
    <p class="px-3 text-xs text-ink-muted" data-testid="animations-empty">{m.editor_anim_empty()}</p>
  {:else}
    <p id="{uid}-hint" class="sr-only">{m.editor_anim_library_hint()}</p>
    <ul aria-labelledby="{uid}-title" aria-describedby="{uid}-hint" class="scroll-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-1.5">
      {#each rows as row (row.id)}
        {@const Icon = kindIcon(kindOf(row.record))}
        {@const playing = previewing?.has(row.id) ?? false}
        <li
          class={[
            'flex h-9 min-w-0 items-center gap-1 rounded-control pr-1 transition-colors duration-(--dur-fast)',
            playing ? 'bg-petrol text-ink' : selected.has(row.id) ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
          ]}
          data-testid="animation-row"
          data-node-id={row.id}
          data-playing={playing}
        >
          <button
            type="button"
            aria-current={selected.has(row.id) ? 'true' : undefined}
            class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-inset"
            onclick={() => select(row.id)}
          >
            <Icon size={16} class="shrink-0 text-ink-muted" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-ui text-ink">{row.name}</span>
              <span class="truncate text-2xs text-ink-muted tabular">{summary(row.animation)}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label={playing ? m.editor_anim_stop_node({ name: row.name }) : m.editor_anim_play_node({ name: row.name })}
            class={[PLAY_BUTTON, playing ? 'text-ink hover:bg-surface-1' : '']}
            data-testid="animation-play"
            onclick={() => (playing ? stop() : play([row.id]))}
          >
            {#if playing}<Square size={10} fill="currentColor" aria-hidden="true" />{:else}<Play size={14} aria-hidden="true" />{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
