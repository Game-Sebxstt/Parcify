<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Plus from '@lucide/svelte/icons/plus';
  import { untrack } from 'svelte';
  import type { Engine, PageRecord } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
  import type { MenuEntry } from '../../ui/DropdownMenu.svelte';
  import { longPress } from '../../ui/longpress.ts';
  import Menu, { type MenuItem } from '../../ui/Menu.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import ConfirmDialog from '../dashboard/ConfirmDialog.svelte';
  import ActionSheet from './mobile/ActionSheet.svelte';

  // touch: el último puntero en el editor fue un dedo; filas de 36 px y ⋯ con 32 px de zona de toque.
  // density 'touch': hoja del móvil, con filas y botones de 44 px; ⋯ y la pulsación larga abren la hoja de acciones.
  type Props = { engine: Engine; readOnly: boolean; touch?: boolean; density?: 'default' | 'touch' };

  let { engine, readOnly, touch = false, density = 'default' }: Props = $props();

  const sheet = $derived(density === 'touch');
  // Página cuyas acciones se ven en la hoja de acciones (móvil).
  let acting = $state.raw<PageRecord | null>(null);

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

  // Las mismas acciones en el ⋯ del escritorio y en la hoja de acciones del móvil.
  function pageItems(page: PageRecord): MenuItem[] {
    const index = pages.findIndex((item) => item.id === page.id);
    return [
      { label: m.editor_page_rename(), onSelect: () => (renaming = page.id) },
      { label: m.editor_page_up(), disabled: index <= 0, onSelect: () => engine.commands.movePage(page.id, -1) },
      { label: m.editor_page_down(), disabled: index === pages.length - 1, onSelect: () => engine.commands.movePage(page.id, 1) },
      { label: m.editor_page_delete(), danger: true, disabled: pages.length <= 1, onSelect: () => askDelete(page) },
    ];
  }

  const actingItems = $derived(
    acting
      ? pageItems(acting).map(
          (item, index): MenuEntry => ({ kind: 'item', id: `page-${index}`, label: item.label, danger: item.danger, disabled: item.disabled, onSelect: item.onSelect }),
        )
      : [],
  );

  function closeActions(returnFocus: boolean) {
    const page = acting;
    acting = null;
    if (returnFocus && page && renaming !== page.id) document.getElementById(`${uid}-${page.id}`)?.focus({ preventScroll: true });
  }

  const ICON_BUTTON = $derived([
    'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink',
    sheet ? 'size-11' : 'size-6',
  ]);
</script>

<section aria-labelledby="{uid}-title" class="flex shrink-0 flex-col border-b border-edge/25 pb-1">
  <div class={['flex items-center gap-1 pr-2 pl-1', sheet ? 'h-11' : 'h-8']}>
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls="{uid}-list"
      onclick={() => (expanded = !expanded)}
      class={ICON_BUTTON}
    >
      <ChevronRight size={sheet ? 18 : 14} aria-hidden="true" class={['transition-transform duration-(--dur-fast)', expanded ? 'rotate-90' : '']} />
      <span class="sr-only">{expanded ? m.editor_pages_collapse() : m.editor_pages_expand()}</span>
    </button>
    <h2 id="{uid}-title" class={['min-w-0 flex-1 truncate font-semibold text-ink-muted', sheet ? 'text-xs' : 'text-2xs']}>{m.editor_pages_label()}</h2>
    {#if !readOnly}
      <Tooltip text={m.editor_page_add()} side="bottom">
        {#snippet children(props)}
          <button
            {...props}
            type="button"
            aria-label={m.editor_page_add()}
            disabled={full}
            onclick={add}
            class={[ICON_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-40']}
          >
            <Plus size={sheet ? 20 : 14} aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
    {/if}
  </div>
  {#if full && !readOnly}
    <p class="px-3 pb-1 text-2xs text-ink-muted">{m.editor_page_limit()}</p>
  {/if}
  <ul
    id="{uid}-list"
    hidden={!expanded}
    aria-labelledby="{uid}-title"
    class={['scroll-thin flex min-h-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-1.5', sheet ? 'max-h-36' : 'max-h-40']}
  >
    {#each pages as page (page.id)}
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
            class={['min-w-0 flex-1 rounded-control bg-surface-2 px-2', sheet ? 'h-9 text-sm' : touch ? 'h-9 text-ui' : 'h-7 text-ui']}
          />
        {:else}
          <!-- En la hoja del móvil, una pulsación larga en la fila abre sus acciones. -->
          <button
            id="{uid}-{page.id}"
            type="button"
            aria-current={page.id === active ? 'page' : undefined}
            onclick={() => engine.commands.setPage(page.id)}
            ondblclick={() => {
              if (!readOnly) renaming = page.id;
            }}
            {@attach longPress(() => {
              if (sheet && !readOnly) acting = page;
            })}
            class={[
              'min-w-0 flex-1 cursor-pointer truncate rounded-control px-2 text-left select-none [-webkit-touch-callout:none]',
              sheet ? 'h-11 text-sm' : touch ? 'h-9 text-ui' : 'h-7 text-ui',
              page.id === active ? 'bg-petrol font-semibold text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
            ]}
          >
            {page.name}
          </button>
        {/if}
        {#if !readOnly && sheet}
          <button
            type="button"
            aria-label={m.editor_page_actions({ name: page.name })}
            aria-haspopup="dialog"
            onclick={() => (acting = page)}
            class={ICON_BUTTON}
          >
            <Ellipsis size={20} aria-hidden="true" />
          </button>
        {:else if !readOnly}
          <Menu items={pageItems(page)}>
            {#snippet trigger(props)}
              <button
                {...props}
                type="button"
                aria-label={m.editor_page_actions({ name: page.name })}
                class={[
                  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink',
                  'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 touch:opacity-100',
                  touch ? 'size-8' : 'size-6',
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

{#if acting}
  <ActionSheet items={actingItems} title={acting.name} onclose={closeActions} testid="page-actions" />
{/if}

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.editor_page_delete_title({ name: doomed?.name ?? '' })}
  description={m.editor_page_delete_body()}
  confirmLabel={m.editor_page_delete()}
  danger
  onconfirm={confirmDelete}
/>
