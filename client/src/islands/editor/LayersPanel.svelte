<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Lock from '@lucide/svelte/icons/lock';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import { tick, untrack } from 'svelte';
  import { displayName, kindOf } from '../../engine/a11y/describe.ts';
  import { ancestorsOf, LAYER_ROW_HEIGHT, layerRows, rowWindow, type LayerRow } from '../../engine/a11y/layers.ts';
  import type { Engine } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import Tooltip from '../../ui/Tooltip.svelte';
  import { kindLabel } from './kinds.ts';

  // titled: false cuando una pestaña «Capas» ya lo nombra; el título queda solo para los lectores de pantalla.
  type Props = { engine: Engine; readOnly: boolean; titled?: boolean };

  let { engine, readOnly, titled = true }: Props = $props();

  const uid = $props.id();
  let version = $state(0);
  let pageId = $state<string | null>(null);
  let selection = $state.raw<readonly string[]>([]);
  let expanded = $state.raw<ReadonlySet<string>>(new Set());
  let scrollTop = $state(0);
  let height = $state(320);
  let focused = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let tree = $state<HTMLElement | null>(null);

  $effect(() => {
    const source = engine;
    return untrack(() => {
      const unsubscribe = [
        source.state.layersVersion.subscribe((value) => (version = value)),
        source.state.pageId.subscribe((value) => (pageId = value)),
        source.state.selection.subscribe(onSelection),
      ];
      return () => unsubscribe.forEach((run) => run());
    });
  });

  // Solo se recorre lo desplegado; se rehace cuando cambia algo que muestra el árbol.
  const rows = $derived.by(() => {
    void version;
    return pageId ? layerRows(engine.core.tree, (id) => engine.core.store.get(id), pageId, expanded) : [];
  });
  const selected = $derived(new Set(selection));
  const range = $derived(rowWindow(rows.length, scrollTop, height));
  const shown = $derived(rows.slice(range.start, range.end));
  const current = $derived(focused && rows.some((row) => row.id === focused) ? focused : (rows[0]?.id ?? null));
  // Una sola fila entra en el orden de tabulación; si la activa no está pintada, la primera del tramo.
  const tabStop = $derived(shown.some((row) => row.id === current) ? current : (shown[0]?.id ?? null));

  const rowId = (id: string) => `${uid}-${id}`;

  const ROW_ACTION = 'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-surface-2';
  // Ojo y candado aparecen con el puntero encima o con la fila enfocada; una capa oculta o bloqueada los enseña siempre,
  // y sin hover (táctil) también se ven siempre.
  const HOVER_ONLY = 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 touch:opacity-100';

  function nameOf(row: LayerRow): string {
    const text = row.record.type === 'text' ? engine.core.store.text(row.id) : '';
    return displayName(row.record, kindLabel(kindOf(row.record)), text);
  }

  function labelOf(row: LayerRow): string {
    const parts = [nameOf(row)];
    if (!row.record.visible) parts.push(m.editor_layer_hidden());
    if (row.record.locked) parts.push(m.editor_layer_locked());
    return parts.join(', ');
  }

  // Lo que se selecciona en el lienzo se despliega y, si el foco no está en el árbol, pasa a ser la fila activa.
  function onSelection(ids: readonly string[]) {
    selection = ids;
    if (!ids.length) return;
    const missing = ids.flatMap((id) => ancestorsOf(engine.core.tree, id)).filter((id) => !expanded.has(id));
    if (missing.length) expanded = new Set([...expanded, ...missing]);
    if (!tree?.contains(document.activeElement)) {
      focused = ids[0]!;
      void reveal(ids[0]!, false);
    }
  }

  async function reveal(id: string, focus: boolean) {
    await tick();
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1 || !tree) return;
    const top = index * LAYER_ROW_HEIGHT;
    if (top < tree.scrollTop) tree.scrollTop = top;
    else if (top + LAYER_ROW_HEIGHT > tree.scrollTop + tree.clientHeight) tree.scrollTop = top + LAYER_ROW_HEIGHT - tree.clientHeight;
    scrollTop = tree.scrollTop;
    if (!focus) return;
    await tick();
    document.getElementById(rowId(id))?.focus({ preventScroll: true });
  }

  function toggle(id: string, open: boolean) {
    expanded = open ? new Set([...expanded, id]) : new Set([...expanded].filter((other) => other !== id));
  }

  function select(id: string, extend: boolean) {
    focused = id;
    if (extend) engine.commands.select(selected.has(id) ? selection.filter((other) => other !== id) : [...selection, id]);
    else engine.commands.select([id]);
  }

  function startRename(id: string) {
    if (readOnly) return;
    renaming = id;
  }

  // «Renombrar» desde el lienzo: la fila puede estar plegada o fuera de la parte pintada de la lista.
  export async function rename(id: string) {
    if (readOnly || !engine.core.store.get(id)) return;
    const missing = ancestorsOf(engine.core.tree, id).filter((other) => !expanded.has(other));
    if (missing.length) expanded = new Set([...expanded, ...missing]);
    focused = id;
    await reveal(id, false);
    startRename(id);
  }

  async function finishRename(id: string, value: string | null) {
    renaming = null;
    if (value !== null) engine.commands.renameNode(id, value);
    focused = id;
    await reveal(id, true);
  }

  function onKey(event: KeyboardEvent, row: LayerRow) {
    if (renaming) return;
    const index = rows.findIndex((item) => item.id === row.id);
    const move = (to: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!next) return;
      focused = next.id;
      void reveal(next.id, true);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row.container && !row.expanded) toggle(row.id, true);
        else if (row.expanded) move(index + 1);
        break;
      case 'ArrowLeft':
        if (row.expanded) toggle(row.id, false);
        else if (row.parentId) move(rows.findIndex((item) => item.id === row.parentId));
        break;
      case 'Enter':
      case ' ':
        select(row.id, event.shiftKey || event.ctrlKey || event.metaKey);
        break;
      case 'F2':
        startRename(row.id);
        break;
      case 'h':
      case 'H':
        if (!readOnly) engine.commands.setFlagFor([row.id], 'visible', !row.record.visible);
        break;
      case 'l':
      case 'L':
        if (!readOnly) engine.commands.setFlagFor([row.id], 'locked', !row.record.locked);
        break;
      case 'Delete':
      case 'Backspace':
        if (!readOnly && selected.has(row.id)) engine.commands.deleteNodes();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const focusInput = (node: HTMLInputElement) => {
    node.focus();
    node.select();
  };
</script>

<section aria-labelledby="{uid}-title" class={['flex min-h-0 flex-1 flex-col', titled ? '' : 'pt-1.5']}>
  <h2 id="{uid}-title" class={titled ? 'flex h-8 shrink-0 items-center px-3 text-2xs font-semibold text-ink-muted' : 'sr-only'}>{m.editor_layers_label()}</h2>
  <p id="{uid}-hint" class="sr-only">{m.editor_layers_hint()}</p>
  {#if rows.length === 0}
    <p class="px-3 text-xs text-ink-muted">{m.editor_layers_empty()}</p>
  {:else}
    <div
      bind:this={tree}
      bind:clientHeight={height}
      role="tree"
      aria-labelledby="{uid}-title"
      aria-describedby="{uid}-hint"
      aria-multiselectable="true"
      data-own-keys
      onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
      class="scroll-thin relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-1.5"
    >
      <div class="relative" style:height="{rows.length * LAYER_ROW_HEIGHT}px">
        {#each shown as row, i (row.id)}
          {@const isSelected = selected.has(row.id)}
          <div
            id={rowId(row.id)}
            role="treeitem"
            aria-label={labelOf(row)}
            aria-level={row.depth}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            aria-selected={isSelected}
            aria-expanded={row.container ? row.expanded : undefined}
            tabindex={row.id === tabStop ? 0 : -1}
            onclick={(event) => select(row.id, event.shiftKey || event.ctrlKey || event.metaKey)}
            ondblclick={() => startRename(row.id)}
            onkeydown={(event) => onKey(event, row)}
            onfocus={() => (focused = row.id)}
            style:top="{(range.start + i) * LAYER_ROW_HEIGHT}px"
            style:height="{LAYER_ROW_HEIGHT}px"
            style:padding-left="{(row.depth - 1) * 14 + 4}px"
            class={[
              'group absolute inset-x-0 flex cursor-pointer items-center gap-1 rounded-control pr-1 text-ui outline-none select-none',
              'focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-inset',
              isSelected ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
              row.record.visible ? '' : 'italic',
            ].join(' ')}
          >
            {#if row.container}
              <button
                type="button"
                tabindex="-1"
                aria-hidden="true"
                aria-label={labelOf(row)}
                onclick={(event) => {
                  event.stopPropagation();
                  toggle(row.id, !row.expanded);
                }}
                class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-surface-2"
              >
                <ChevronRight size={14} class={row.expanded ? 'rotate-90' : ''} />
              </button>
            {:else}
              <span class="size-6 shrink-0"></span>
            {/if}
            {#if renaming === row.id}
              <input
                {@attach focusInput}
                aria-label={m.editor_layer_name()}
                value={row.record.name ?? nameOf(row)}
                maxlength="80"
                onclick={(event) => event.stopPropagation()}
                onkeydown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') void finishRename(row.id, event.currentTarget.value);
                  else if (event.key === 'Escape') void finishRename(row.id, null);
                }}
                onblur={(event) => {
                  if (renaming === row.id) void finishRename(row.id, event.currentTarget.value);
                }}
                class="h-6 min-w-0 flex-1 rounded-[4px] bg-surface-2 px-1.5 text-ink"
              />
            {:else}
              <span class="min-w-0 flex-1 truncate">{nameOf(row)}</span>
            {/if}
            {#if !readOnly}
              <Tooltip text={row.record.visible ? m.editor_layer_hide() : m.editor_layer_show()} kbd="H">
                {#snippet children(props)}
                  <button
                    {...props}
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    aria-label={row.record.visible ? m.editor_layer_hide() : m.editor_layer_show()}
                    onclick={(event) => {
                      event.stopPropagation();
                      engine.commands.setFlagFor([row.id], 'visible', !row.record.visible);
                    }}
                    class={[ROW_ACTION, row.record.visible ? HOVER_ONLY : '']}
                  >
                    {#if row.record.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
                  </button>
                {/snippet}
              </Tooltip>
              <Tooltip text={row.record.locked ? m.editor_layer_unlock() : m.editor_layer_lock()} kbd="L">
                {#snippet children(props)}
                  <button
                    {...props}
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    aria-label={row.record.locked ? m.editor_layer_unlock() : m.editor_layer_lock()}
                    onclick={(event) => {
                      event.stopPropagation();
                      engine.commands.setFlagFor([row.id], 'locked', !row.record.locked);
                    }}
                    class={[ROW_ACTION, row.record.locked ? '' : HOVER_ONLY]}
                  >
                    {#if row.record.locked}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
                  </button>
                {/snippet}
              </Tooltip>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>
