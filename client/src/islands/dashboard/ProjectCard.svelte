<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Star from '@lucide/svelte/icons/star';
  import { assetUrl } from '../../lib/assets.ts';
  import { formatRelative } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import type { ProjectSummary } from '../../shared/api/projects.js';
  import Menu, { type MenuItem } from '../../ui/Menu.svelte';

  type Props = {
    project: ProjectSummary;
    meId: string;
    menu: MenuItem[];
    // Sin onselect la tarjeta no se puede seleccionar (inicio).
    onselect?: (range: boolean) => void;
    selected?: boolean;
    selecting?: boolean;
    onfavorite: () => void;
    showWorkspace?: string | null;
  };

  let { project, meId, menu, onselect, selected = false, selecting = false, onfavorite, showWorkspace = null }: Props = $props();

  let preview = $state<string | null>(null);

  $effect(() => {
    const id = project.previewAssetId;
    preview = null;
    if (!id) return;
    let alive = true;
    void assetUrl(id, 'thumb').then((url) => {
      if (alive) preview = url;
    });
    return () => {
      alive = false;
    };
  });

  const edited = $derived.by(() => {
    if (project.deletedAt) return m.dashboard_card_trashed({ when: formatRelative(project.deletedAt) });
    const when = formatRelative(project.lastEditedAt);
    if (!project.lastEditedBy) return m.dashboard_card_edited({ when });
    if (project.lastEditedBy.id === meId) return m.dashboard_card_edited_by_you({ when });
    return m.dashboard_card_edited_by({ when, name: project.lastEditedBy.name });
  });

  const href = $derived(project.deletedAt ? undefined : `/p/${project.id}`);
</script>

<li
  class={[
    'group relative flex flex-col rounded-panel p-2 transition-colors duration-150',
    selected ? 'bg-petrol' : 'bg-surface-1 hover:bg-surface-2',
  ].join(' ')}
>
  <svelte:element
    this={href ? 'a' : 'div'}
    {href}
    tabindex={href ? -1 : undefined}
    aria-hidden="true"
    class="block aspect-[16/10] overflow-hidden rounded-[6px] bg-ground"
  >
    {#if preview}
      <img src={preview} alt="" loading="lazy" decoding="async" class="size-full object-cover" />
    {:else}
      <span class="flex size-full items-center justify-center text-xs text-ink-muted">{m.dashboard_card_no_preview()}</span>
    {/if}
  </svelte:element>

  {#if onselect}
    <label
      class={[
        'absolute top-3.5 left-3.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-surface-1',
        selecting || selected ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={selected}
        aria-label={m.dashboard_select_project({ name: project.name })}
        onclick={(event) => {
          event.preventDefault();
          onselect(event.shiftKey);
        }}
        class="size-4 cursor-pointer accent-coral"
      />
    </label>
  {/if}

  <div class="mt-2 flex items-start gap-1 pl-1">
    <div class="min-w-0 flex-1 py-0.5">
      {#if href}
        <a {href} class="block truncate rounded-[4px] text-sm font-semibold text-ink hover:underline">{project.name}</a>
      {:else}
        <p class="truncate text-sm font-semibold text-ink">{project.name}</p>
      {/if}
      <p class="truncate text-xs text-ink-muted">
        {edited}{#if showWorkspace}<span class="sr-only">, </span><span aria-hidden="true"> · </span>{showWorkspace}{/if}
      </p>
    </div>
    {#if !project.deletedAt}
      <button
        type="button"
        aria-pressed={project.favorite}
        aria-label={project.favorite ? m.dashboard_unfavorite({ name: project.name }) : m.dashboard_favorite({ name: project.name })}
        onclick={onfavorite}
        class={[
          'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-surface-2',
          project.favorite ? 'text-ink' : 'text-ink-muted hover:text-ink',
        ].join(' ')}
      >
        <Star size={16} aria-hidden="true" fill={project.favorite ? 'currentColor' : 'none'} />
      </button>
    {/if}
    {#if menu.length}
      <Menu items={menu}>
        {#snippet trigger(props)}
          <button
            {...props}
            type="button"
            aria-label={m.dashboard_project_actions({ name: project.name })}
            class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <Ellipsis size={16} aria-hidden="true" />
          </button>
        {/snippet}
      </Menu>
    {/if}
  </div>
</li>
