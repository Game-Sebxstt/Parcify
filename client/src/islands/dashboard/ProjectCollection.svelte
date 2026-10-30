<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api.ts';
  import { batchProjects, duplicateProject, renameProject, restoreProject, setFavorite, trashProject } from '../../lib/projects.ts';
  import { m } from '../../paraglide/messages.js';
  import type { ProjectSummary } from '../../shared/api/projects.js';
  import { roleAtLeast } from '../../shared/permissions.js';
  import type { MenuEntry } from '../../ui/DropdownMenu.svelte';
  import type { MenuItem } from '../../ui/Menu.svelte';
  import PointMenu from '../../ui/PointMenu.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import type { MenuPoint } from './item.ts';
  import NameDialog from './NameDialog.svelte';
  import ProjectCard from './ProjectCard.svelte';
  import ProjectRow from './ProjectRow.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import { Selection } from './selection.svelte.ts';
  import type { ProjectView } from './view.ts';

  type Props = {
    items: ProjectSummary[];
    view: ProjectView;
    // Nombre accesible de la lista.
    label: string;
    meId: string;
    // Con nombres, cada tarjeta dice en qué espacio está (el inicio mezcla espacios).
    workspaceNames?: Map<string, string> | null;
    trash?: boolean;
    // En una lista de favoritos, quitar la estrella saca el proyecto de la lista.
    removeOnUnfavorite?: boolean;
    // Si la copia de un proyecto duplicado entra en esta lista.
    acceptsCopy?: (copy: ProjectSummary) => boolean;
    // Tras una acción en lote o deshacer un borrado, la lista se vuelve a pedir.
    onreload: () => void | Promise<void>;
  };

  let {
    items = $bindable(),
    view,
    label,
    meId,
    workspaceNames = null,
    trash = false,
    removeOnUnfavorite = false,
    acceptsCopy = () => true,
    onreload,
  }: Props = $props();

  const selection = new Selection();
  const order = $derived(items.map((item) => item.id));
  let busy = $state(false);

  let renaming = $state<ProjectSummary | null>(null);
  let renameOpen = $state(false);
  let confirmOpen = $state(false);
  let pendingDelete = $state<string[]>([]);

  // Menú en el punto (clic derecho o pulsación larga): uno para toda la lista.
  let pointMenu = $state<{ id: string; at: MenuPoint } | null>(null);
  const pointProject = $derived(pointMenu ? items.find((item) => item.id === pointMenu?.id) : undefined);

  // Al recargar o filtrar, la selección olvida los proyectos que ya no están.
  $effect.pre(() => {
    selection.retain(order);
  });

  export function clearSelection() {
    selection.clear();
  }

  function messageOf(error: unknown) {
    return error instanceof ApiError ? error.message : m.error_internal();
  }

  function replace(project: ProjectSummary) {
    items = items.map((item) => (item.id === project.id ? project : item));
  }

  function remove(ids: string[]) {
    items = items.filter((item) => !ids.includes(item.id));
  }

  async function toggleFavorite(project: ProjectSummary) {
    const favorite = !project.favorite;
    replace({ ...project, favorite });
    try {
      await setFavorite(project.id, favorite);
      if (!favorite && removeOnUnfavorite) remove([project.id]);
    } catch (error) {
      replace(project);
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  async function duplicateOne(project: ProjectSummary) {
    try {
      const copy = await duplicateProject(project.id);
      if (acceptsCopy(copy)) items = [copy, ...items];
      showToast({ message: m.dashboard_duplicated({ count: 1 }), tone: 'success' });
    } catch (error) {
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  async function restoreOne(project: ProjectSummary) {
    try {
      await restoreProject(project.id);
      if (trash) remove([project.id]);
      showToast({ message: m.dashboard_restored({ count: 1 }), tone: 'success' });
    } catch (error) {
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  function askDelete(ids: string[]) {
    pendingDelete = ids;
    confirmOpen = true;
  }

  async function confirmDelete() {
    const ids = pendingDelete;
    busy = true;
    try {
      if (ids.length === 1) {
        await trashProject(ids[0]!);
        remove(ids);
        showToast({
          message: m.dashboard_trashed({ count: 1 }),
          tone: 'success',
          action: { label: m.dashboard_undo(), run: () => void undoDelete(ids) },
        });
      } else {
        const result = await batchProjects('delete', ids);
        remove(result.ok);
        reportBatch(result.ok.length, result.failed, m.dashboard_trashed);
      }
      confirmOpen = false;
    } catch (error) {
      showToast({ message: messageOf(error), tone: 'error' });
    } finally {
      busy = false;
    }
  }

  async function undoDelete(ids: string[]) {
    try {
      await batchProjects('restore', ids);
      await onreload();
    } catch (error) {
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  function reportBatch(ok: number, failed: number, done: (input: { count: number }) => string) {
    if (ok > 0) showToast({ message: done({ count: ok }), tone: 'success' });
    if (failed > 0) showToast({ message: m.dashboard_batch_failed({ count: failed }), tone: 'error' });
  }

  async function batch(action: 'duplicate' | 'restore') {
    const ids = [...selection.ids];
    busy = true;
    try {
      const result = await batchProjects(action, ids);
      selection.clear();
      reportBatch(result.ok.length, result.failed, action === 'duplicate' ? m.dashboard_duplicated : m.dashboard_restored);
      await onreload();
    } catch (error) {
      showToast({ message: messageOf(error), tone: 'error' });
    } finally {
      busy = false;
    }
  }

  async function rename(name: string): Promise<string | null> {
    const project = renaming;
    if (!project) return null;
    try {
      const updated = await renameProject(project.id, name);
      replace({ ...project, name: updated.name });
      return null;
    } catch (error) {
      return messageOf(error);
    }
  }

  function toggleSelected(project: ProjectSummary, range = false) {
    selection.toggle(project.id, order, { range });
  }

  // Las mismas entradas en el menú ⋯ y en el menú en el punto.
  function menuFor(project: ProjectSummary): MenuItem[] {
    const select: MenuItem = {
      label: selection.has(project.id) ? m.dashboard_deselect() : m.dashboard_select(),
      onSelect: () => toggleSelected(project),
    };
    if (project.deletedAt) return [{ label: m.dashboard_restore(), onSelect: () => void restoreOne(project) }, select];
    const entries: MenuItem[] = [
      {
        label: project.favorite ? m.dashboard_menu_unfavorite() : m.dashboard_menu_favorite(),
        onSelect: () => void toggleFavorite(project),
      },
    ];
    if (roleAtLeast(project.role, 'editor')) {
      entries.push({
        label: m.dashboard_rename(),
        onSelect: () => {
          renaming = project;
          renameOpen = true;
        },
      });
    }
    entries.push({ label: m.dashboard_duplicate(), onSelect: () => void duplicateOne(project) }, select);
    if (project.role === 'admin') {
      entries.push({ label: m.dashboard_move_to_trash(), danger: true, onSelect: () => askDelete([project.id]) });
    }
    return entries;
  }

  const pointEntries = $derived<MenuEntry[]>(
    pointProject
      ? menuFor(pointProject).map((item, index) => ({
          kind: 'item',
          id: `${index}-${item.label}`,
          label: item.label,
          danger: item.danger,
          disabled: item.disabled,
          onSelect: item.onSelect,
        }))
      : [],
  );

  async function closePointMenu(returnFocus: boolean) {
    const id = pointMenu?.id;
    pointMenu = null;
    if (!returnFocus || !id) return;
    await tick();
    document.querySelector<HTMLElement>(`[data-project-card="${CSS.escape(id)}"] [data-card-menu]`)?.focus();
  }

  const deleteCount = $derived(pendingDelete.length);
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && selection.size > 0 && !confirmOpen && !renameOpen && !pointMenu) selection.clear();
  }}
/>

<ul
  aria-label={label}
  class={view === 'grid'
    ? 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(208px,1fr))] sm:gap-4'
    : 'flex flex-col'}
>
  {#if view === 'list'}
    <li aria-hidden="true" class="hidden h-8 grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-edge/25 px-2 text-2xs text-ink-muted sm:grid">
      <span class="w-10"></span>
      <span>{m.dashboard_column_name()}</span>
      <span>{workspaceNames ? m.dashboard_column_space() : ''}</span>
      <span>{m.dashboard_column_edited()}</span>
      <span class="w-14.5"></span>
    </li>
  {/if}
  {#each items as project (project.id)}
    {@const Item = view === 'grid' ? ProjectCard : ProjectRow}
    <Item
      {project}
      {meId}
      menu={menuFor(project)}
      workspaceName={workspaceNames?.get(project.workspaceSlug) ?? null}
      selected={selection.has(project.id)}
      selecting={selection.size > 0}
      onselect={(range) => toggleSelected(project, range)}
      onfavorite={() => void toggleFavorite(project)}
      oncontext={(at) => (pointMenu = { id: project.id, at })}
    />
  {/each}
</ul>

<PointMenu
  items={pointEntries}
  at={pointMenu && pointProject ? pointMenu.at : null}
  label={pointProject ? m.dashboard_project_actions({ name: pointProject.name }) : ''}
  testid="project-point-menu"
  onclose={(returnFocus) => void closePointMenu(returnFocus)}
/>

{#if selection.size > 0}
  <SelectionBar
    count={selection.size}
    total={items.length}
    {trash}
    {busy}
    onselectall={() => selection.selectAll(order)}
    onclear={() => selection.clear()}
    onduplicate={() => void batch('duplicate')}
    ondelete={() => askDelete([...selection.ids])}
    onrestore={() => void batch('restore')}
  />
{/if}

<NameDialog
  bind:open={renameOpen}
  title={m.dashboard_rename_title()}
  label={m.dashboard_project_name()}
  submitLabel={m.dashboard_rename_submit()}
  initial={renaming?.name ?? ''}
  onsubmit={rename}
/>

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.dashboard_trash_confirm_title({ count: deleteCount })}
  description={m.dashboard_trash_confirm_body()}
  confirmLabel={m.dashboard_move_to_trash()}
  danger
  {busy}
  onconfirm={() => void confirmDelete()}
/>
