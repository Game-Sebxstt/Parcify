<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Plus from '@lucide/svelte/icons/plus';
  import { untrack } from 'svelte';
  import type { Engine, PageRecord } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
  import Menu from '../../ui/Menu.svelte';
  import ConfirmDialog from '../dashboard/ConfirmDialog.svelte';
  import ToolButton from './ToolButton.svelte';

  type Props = { engine: Engine; readOnly: boolean };

  let { engine, readOnly }: Props = $props();

  const uid = $props.id();
  let pages = $state.raw<readonly PageRecord[]>([]);
  let active = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let doomed = $state<PageRecord | null>(null);
  let confirmOpen = $state(false);

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

<section aria-labelledby="{uid}-title" class="flex max-h-[40%] shrink-0 flex-col gap-2">
  <div class="flex items-center justify-between gap-2 px-1">
    <h2 id="{uid}-title" class="font-semibold">{m.editor_pages_label()}</h2>
    {#if !readOnly}
      <ToolButton side="bottom" label={m.editor_page_add()} disabled={full} onclick={add}><Plus size={16} aria-hidden="true" /></ToolButton>
    {/if}
  </div>
  {#if full && !readOnly}
    <p class="px-1 text-xs text-ink-muted">{m.editor_page_limit()}</p>
  {/if}
  <ul aria-labelledby="{uid}-title" class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
    {#each pages as page, i (page.id)}
      <li class="flex items-center gap-1">
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
            class="h-8 min-w-0 flex-1 rounded-panel bg-surface-2 px-2"
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
              'h-8 min-w-0 flex-1 cursor-pointer truncate rounded-panel px-2 text-left',
              page.id === active ? 'bg-petrol font-semibold text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
            ].join(' ')}
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
                class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
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
