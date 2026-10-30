<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Star from '@lucide/svelte/icons/star';
  import { m } from '../../paraglide/messages.js';
  import type { ProjectSummary } from '../../shared/api/projects.js';
  import Checkbox from '../../ui/Checkbox.svelte';
  import Menu, { type MenuItem } from '../../ui/Menu.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import { watchTruncation } from '../../ui/truncation.ts';
  import { editedLabel, projectContextMenu, selectsInsteadOfOpening, textTooltipProps, type MenuPoint } from './item.ts';
  import ProjectThumb from './ProjectThumb.svelte';

  type Props = {
    project: ProjectSummary;
    meId: string;
    menu: MenuItem[];
    workspaceName?: string | null;
    onselect?: ((range: boolean) => void) | undefined;
    selected?: boolean;
    selecting?: boolean;
    onfavorite: () => void;
    oncontext?: ((point: MenuPoint) => void) | undefined;
  };

  let { project, meId, menu, workspaceName = null, onselect, selected = false, selecting = false, onfavorite, oncontext }: Props = $props();

  const href = $derived(project.deletedAt ? undefined : `/p/${project.id}`);
  const edited = $derived(editedLabel(project, meId));
  const choosing = $derived(Boolean(onselect) && selecting);

  let nameCut = $state(false);
  let spaceWithShift = false;

  function open(event: MouseEvent) {
    if (!onselect || !selectsInsteadOfOpening(event, selecting)) return;
    event.preventDefault();
    onselect(event.shiftKey);
  }

  const REVEAL = 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 touch:opacity-100';
  const ICON =
    'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control transition-opacity duration-(--dur-fast) hover:bg-petrol';
</script>

<li
  data-project-card={project.id}
  class={[
    'group/row grid h-11 items-center gap-3 rounded-control px-2 select-none [-webkit-touch-callout:none]',
    'grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]',
    'transition-colors duration-(--dur-fast)',
    selected ? 'bg-petrol' : 'hover:bg-surface-2 has-[:focus-visible]:bg-surface-2',
  ].join(' ')}
  {@attach oncontext ? projectContextMenu(oncontext) : undefined}
>
  <span class="flex items-center gap-2">
    {#if choosing && onselect}
      <span
        class="inline-flex size-7 items-center justify-center"
        onkeydowncapture={(event) => {
          if (event.key === ' ') spaceWithShift = event.shiftKey;
        }}
      >
        <Checkbox
          checked={selected}
          ariaLabel={m.dashboard_select_project({ name: project.name })}
          class="size-4.5!"
          onclick={(event) => {
            event.preventDefault();
            onselect(event.shiftKey);
          }}
          onCheckedChange={() => {
            onselect(spaceWithShift);
            spaceWithShift = false;
          }}
        />
      </span>
    {/if}
    <svelte:element
      this={href ? 'a' : 'div'}
      {href}
      tabindex={href ? -1 : undefined}
      aria-hidden="true"
      draggable="false"
      onclick={open}
      class="relative block h-[25px] w-10 shrink-0 overflow-hidden rounded-xs bg-surface-2"
    >
      <ProjectThumb assetId={project.previewAssetId} small />
      <span class="pointer-events-none absolute inset-0 rounded-xs border border-edge/25"></span>
    </svelte:element>
  </span>

  <span class="flex min-w-0 flex-col">
    <Tooltip text={project.name} disabled={!nameCut}>
      {#snippet children(tip)}
        {#if href}
          <a
            {...textTooltipProps(tip)}
            {href}
            draggable="false"
            onclick={open}
            class="truncate rounded-xs text-ui font-medium text-ink"
            {@attach watchTruncation(project.name, (cut) => (nameCut = cut))}
          >
            {project.name}
          </a>
        {:else}
          <span {...textTooltipProps(tip)} class="truncate text-ui font-medium text-ink" {@attach watchTruncation(project.name, (cut) => (nameCut = cut))}>
            {project.name}
          </span>
        {/if}
      {/snippet}
    </Tooltip>
    <!-- En móvil no hay columnas: la fecha va debajo del nombre. -->
    <span class="truncate text-xs text-ink-muted sm:hidden">{edited}</span>
  </span>

  <span class="hidden truncate text-xs text-ink-muted sm:block">
    {#if workspaceName}<span class="sr-only">{m.dashboard_column_space()}: </span>{workspaceName}{/if}
  </span>
  <span class="hidden truncate text-xs text-ink-muted sm:block">{edited}</span>

  <span class="flex items-center gap-0.5">
    {#if !project.deletedAt && !choosing}
      <button
        type="button"
        aria-pressed={project.favorite}
        aria-label={project.favorite ? m.dashboard_unfavorite({ name: project.name }) : m.dashboard_favorite({ name: project.name })}
        onclick={onfavorite}
        class={[ICON, project.favorite ? 'text-coral' : ['text-ink-muted hover:text-ink', REVEAL].join(' ')].join(' ')}
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
            data-card-menu=""
            aria-label={m.dashboard_project_actions({ name: project.name })}
            class={[ICON, 'text-ink-muted hover:text-ink data-[state=open]:opacity-100', REVEAL].join(' ')}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </button>
        {/snippet}
      </Menu>
    {/if}
  </span>
</li>
