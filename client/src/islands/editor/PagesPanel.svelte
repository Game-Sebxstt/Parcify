<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Plus from '@lucide/svelte/icons/plus';
  import { untrack } from 'svelte';
  import type { Engine, PageRecord } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
  import Menu from '../../ui/Menu.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import ConfirmDialog from '../dashboard/ConfirmDialog.svelte';

  type Props = { engine: Engine; readOnly: boolean };

  let { engine, readOnly }: Props = $props();

  const uid = $props.id();
  let pages = $state.raw<readonly PageRecord[]>([]);
  let active = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let doomed = $state<PageRecord | null>(null);
  let confirmOpen = $state(false);
  let expanded = $state(true);

  $effect(() => {
    const source = engine;
    return untrack(() => {
      const unsubscribe = [source.state.pages.subscribe((value) => (pages = value)), source.state.pageId.subscribe((value) => (active = value))];
      return () => unsubscribe.forEach((run) => run());
    });
  });

  const full = $derived(pages.length >= DOCUMENT_LIMITS.maxPages);

  function add() {
    if (full) return;
    engine.commands.createPage(m.editor_page_default({ n: pages.length + 1 }));
  }

  function finishRename(id: string, value: string | null) {
    renaming = null;
    if (value !== null) engine.commands.renamePage(id, value);
    document.getElementById(`${uid}-${id}`)?.focus();
  }

  function askDelete(page: PageRecord) {
    doomed = page;
    confirmOpen = true;
  }

  function confirmDelete() {
    if (doomed) engine.commands.deletePage(doomed.id);
    doomed = null;
    confirmOpen = false;
  }

  const focusInput = (node: HTMLInputElement) => {
    node.focus();
    node.select();
  };
</script>

<section aria-labelledby="{uid}-title" class="flex shrink-0 flex-col border-b border-edge/25 pb-1">
  <div class="flex h-8 items-center gap-1 pr-2 pl-1">
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls="{uid}-list"
      onclick={() => (expanded = !expanded)}
      class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <ChevronRight size={14} aria-hidden="true" class={['transition-transform duration-(--dur-fast)', expanded ? 'rotate-90' : '']} />
      <span class="sr-only">{expanded ? m.editor_pages_collapse() : m.editor_pages_expand()}</span>
    </button>
    <h2 id="{uid}-title" class="min-w-0 flex-1 truncate text-2xs font-semibold text-ink-muted">{m.editor_pages_label()}</h2>
    {#if !readOnly}
      <Tooltip text={m.editor_page_add()} side="bottom">
        {#snippet children(props)}
          <button
            {...props}
            type="button"
            aria-label={m.editor_page_add()}
            disabled={full}
            onclick={add}
            class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
    {/if}
  </div>
  {#if full && !readOnly}
    <p class="px-3 pb-1 text-2xs text-ink-muted">{m.editor_page_limit()}</p>
  {/if}
  <ul id="{uid}-list" hidden={!expanded} aria-labelledby="{uid}-title" class="scroll-thin flex max-h-40 min-h-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-1.5">
    {#each pages as page, i (page.id)}
      <li class="group flex min-w-0 items-center gap-0.5">
        {#if renaming === page.id}
          <input
            {@attach focusInput}
            aria-label={m.editor_page_name()}
            value={page.name}
            maxlength="80"
            onkeydown={(event) => {
              if (event.key === 'Enter') finishRename(page.id, event.currentTarget.value);
              else if (event.key === 'Escape') finishRename(page.id, null);
            }}
            onblur={(event) => {
              if (renaming === page.id) finishRename(page.id, event.currentTarget.value);
            }}
            class="h-7 min-w-0 flex-1 rounded-control bg-surface-2 px-2 text-ui"
          />
        {:else}
          <button
            id="{uid}-{page.id}"
            type="button"
            aria-current={page.id === active ? 'page' : undefined}
            onclick={() => engine.commands.setPage(page.id)}
            ondblclick={() => {
              if (!readOnly) renaming = page.id;
            }}
            class={[
              'h-7 min-w-0 flex-1 cursor-pointer truncate rounded-control px-2 text-left text-ui',
              page.id === active ? 'bg-petrol font-semibold text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
            ]}
          >
            {page.name}
          </button>
        {/if}
        {#if !readOnly}
          <Menu
            items={[
              { label: m.editor_page_rename(), onSelect: () => (renaming = page.id) },
              { label: m.editor_page_up(), disabled: i === 0, onSelect: () => engine.commands.movePage(page.id, -1) },
              { label: m.editor_page_down(), disabled: i === pages.length - 1, onSelect: () => engine.commands.movePage(page.id, 1) },
              { label: m.editor_page_delete(), danger: true, disabled: pages.length <= 1, onSelect: () => askDelete(page) },
            ]}
          >
            {#snippet trigger(props)}
              <button
                {...props}
                type="button"
                aria-label={m.editor_page_actions({ name: page.name })}
                class={[
                  'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink',
                  'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 touch:opacity-100',
                ]}
              >
                <Ellipsis size={16} aria-hidden="true" />
              </button>
            {/snippet}
          </Menu>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.editor_page_delete_title({ name: doomed?.name ?? '' })}
  description={m.editor_page_delete_body()}
  confirmLabel={m.editor_page_delete()}
  danger
  onconfirm={confirmDelete}
/>
