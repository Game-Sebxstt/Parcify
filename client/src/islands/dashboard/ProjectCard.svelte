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
    // Nombre del espacio en la segunda línea (el inicio mezcla espacios); null si no se muestra.
    workspaceName?: string | null;
    // Sin onselect la tarjeta no se puede seleccionar.
    onselect?: ((range: boolean) => void) | undefined;
    selected?: boolean;
    selecting?: boolean;
    onfavorite: () => void;
    oncontext?: ((point: MenuPoint) => void) | undefined;
  };

  let { project, meId, menu, workspaceName = null, onselect, selected = false, selecting = false, onfavorite, oncontext }: Props = $props();

  const href = $derived(project.deletedAt ? undefined : `/p/${project.id}`);
  const edited = $derived(editedLabel(project, meId));
  const detail = $derived(workspaceName ? `${edited} · ${workspaceName}` : edited);
  const choosing = $derived(Boolean(onselect) && selecting);

  let nameCut = $state(false);
  let detailCut = $state(false);
  // bits-ui atiende la barra espaciadora sin emitir click: Mayús se guarda aquí para seleccionar un tramo.
  let spaceWithShift = false;

  function open(event: MouseEvent) {
    if (!onselect || !selectsInsteadOfOpening(event, selecting)) return;
    event.preventDefault();
    onselect(event.shiftKey);
  }

  const REVEAL = 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 touch:opacity-100';
  const CORNER =
    'absolute top-1.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-control bg-surface-2/90 transition-opacity duration-(--dur-fast)';
</script>

<li
  data-project-card={project.id}
  class="group/card relative flex min-w-0 flex-col select-none [-webkit-touch-callout:none]"
  {@attach oncontext ? projectContextMenu(oncontext) : undefined}
>
  <div class="relative">
    <svelte:element
      this={href ? 'a' : 'div'}
      {href}
      tabindex={href ? -1 : undefined}
      aria-hidden="true"
      draggable="false"
      onclick={open}
      class={['block aspect-[16/10] overflow-hidden rounded-card bg-surface-2', choosing || !href ? 'cursor-default' : ''].join(' ')}
    >
      <ProjectThumb assetId={project.previewAssetId} />
    </svelte:element>
    <span
      aria-hidden="true"
      class={[
        'pointer-events-none absolute inset-0 rounded-card transition-colors duration-(--dur-fast)',
        selected
          ? 'border-2 border-coral'
          : 'border border-edge/25 group-hover/card:border-coral/60 group-has-[:focus-visible]/card:border-coral',
      ].join(' ')}
    ></span>

    {#if choosing && onselect}
      <span
        class={[CORNER, 'left-1.5 cursor-default']}
        onkeydowncapture={(event) => {
          if (event.key === ' ') spaceWithShift = event.shiftKey;
        }}
      >
        <!-- La selección la lleva el padre: el clic no cambia la casilla por su cuenta y Mayús selecciona un tramo. -->
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
    {:else if !project.deletedAt}
      <button
        type="button"
        aria-pressed={project.favorite}
        aria-label={project.favorite ? m.dashboard_unfavorite({ name: project.name }) : m.dashboard_favorite({ name: project.name })}
        onclick={onfavorite}
        class={[CORNER, 'left-1.5', project.favorite ? 'text-coral' : ['text-ink-muted hover:text-ink', REVEAL].join(' ')].join(' ')}
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
            class={[CORNER, 'right-1.5 text-ink-muted hover:text-ink data-[state=open]:opacity-100', REVEAL].join(' ')}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </button>
        {/snippet}
      </Menu>
    {/if}
  </div>

  <div class="mt-2 min-w-0 px-0.5">
    <Tooltip text={project.name} disabled={!nameCut}>
      {#snippet children(tip)}
        {#if href}
          <a
            {...textTooltipProps(tip)}
            {href}
            draggable="false"
            onclick={open}
            class="block truncate rounded-xs text-ui font-semibold text-ink"
            {@attach watchTruncation(project.name, (cut) => (nameCut = cut))}
          >
            {project.name}
          </a>
        {:else}
          <p {...textTooltipProps(tip)} class="truncate text-ui font-semibold text-ink" {@attach watchTruncation(project.name, (cut) => (nameCut = cut))}>
            {project.name}
          </p>
        {/if}
      {/snippet}
    </Tooltip>
    <Tooltip text={detail} disabled={!detailCut}>
      {#snippet children(tip)}
        <p {...textTooltipProps(tip)} class="truncate text-xs text-ink-muted" {@attach watchTruncation(detail, (cut) => (detailCut = cut))}>
          {edited}{#if workspaceName}<span class="sr-only">, </span><span aria-hidden="true">&nbsp;·&nbsp;</span>{workspaceName}{/if}
        </p>
      {/snippet}
    </Tooltip>
  </div>
</li>
