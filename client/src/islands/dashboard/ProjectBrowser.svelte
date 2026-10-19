<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api.ts';
  import {
    batchProjects,
    duplicateProject,
    listWorkspaceProjects,
    renameProject,
    restoreProject,
    setFavorite,
    sortDirection,
    trashProject,
  } from '../../lib/projects.ts';
  import { m } from '../../paraglide/messages.js';
  import type { ProjectSummary } from '../../shared/api/projects.js';
  import { roleAtLeast } from '../../shared/permissions.js';
  import Button from '../../ui/Button.svelte';
  import type { MenuItem } from '../../ui/Menu.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import NameDialog from './NameDialog.svelte';
  import ProjectCard from './ProjectCard.svelte';
  import ProjectFilters, { type ProjectQuery } from './ProjectFilters.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import { Selection } from './selection.svelte.ts';

  type Props = { slug: string; meId: string };
  let { slug, meId }: Props = $props();

  let query = $state<ProjectQuery>({ q: '', filter: 'all', sort: 'edited' });
  let items = $state<ProjectSummary[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingMore = $state(false);
  let busy = $state(false);
  let controller: AbortController | null = null;

  const selection = new Selection();
  const order = $derived(items.map((item) => item.id));
  const trash = $derived(query.filter === 'trash');

  let renaming = $state<ProjectSummary | null>(null);
  let renameOpen = $state(false);
  let confirmOpen = $state(false);
  let pendingDelete = $state<string[]>([]);

  // La búsqueda, el filtro y el orden viven en la URL (?q=, ?filtro=, ?orden=) para poder enlazarlos.
  const FILTERS = ['all', 'mine', 'shared', 'favorites', 'trash'] as const;
  const SORTS = ['edited', 'name', 'created'] as const;

  function readUrl(): ProjectQuery {
    const params = new URL(window.location.href).searchParams;
    const filter = params.get('filtro');
    const sort = params.get('orden');
    return {
      q: (params.get('q') ?? '').trim().slice(0, 80),
      filter: (FILTERS as readonly string[]).includes(filter ?? '') ? (filter as ProjectQuery['filter']) : 'all',
      sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as ProjectQuery['sort']) : 'edited',
    };
  }

  function writeUrl(next: ProjectQuery) {
    const url = new URL(window.location.href);
    const set = (key: string, value: string, fallback: string) =>
      value && value !== fallback ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    set('q', next.q, '');
    set('filtro', next.filter, 'all');
    set('orden', next.sort, 'edited');
    history.replaceState(history.state, '', `${url.pathname}${url.search}`);
  }

  onMount(() => {
    query = readUrl();
    void load();
    return () => controller?.abort();
  });

  async function load(more = false) {
    controller?.abort();
    const current = (controller = new AbortController());
    if (more) loadingMore = true;
    else status = 'loading';
    try {
      const page = await listWorkspaceProjects(
        slug,
        { ...query, dir: sortDirection(query.sort), cursor: more ? nextCursor : null },
        current.signal,
      );
      items = more ? [...items, ...page.items.filter((item) => !order.includes(item.id))] : page.items;
      nextCursor = page.nextCursor;
      status = 'ready';
      selection.retain(items.map((item) => item.id));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!more) status = 'error';
      else showToast({ message: messageOf(error), tone: 'error' });
    } finally {
      if (controller === current) loadingMore = false;
    }
  }

  function messageOf(error: unknown) {
    return error instanceof ApiError ? error.message : m.error_internal();
  }

  function update(next: ProjectQuery) {
    if (next.filter !== query.filter) selection.clear();
    query = next;
    writeUrl(next);
    void load();
  }

  function replace(project: ProjectSummary) {
    items = items.map((item) => (item.id === project.id ? project : item));
  }

  function remove(ids: string[]) {
    items = items.filter((item) => !ids.includes(item.id));
    selection.retain(items.map((item) => item.id));
  }

  async function toggleFavorite(project: ProjectSummary) {
    const favorite = !project.favorite;
    replace({ ...project, favorite });
    try {
      await setFavorite(project.id, favorite);
      if (!favorite && query.filter === 'favorites') remove([project.id]);
    } catch (error) {
      replace(project);
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  async function duplicateOne(project: ProjectSummary) {
    try {
      const copy = await duplicateProject(project.id);
      if (copy.workspaceSlug === slug && query.filter !== 'trash') items = [copy, ...items];
      showToast({ message: m.dashboard_duplicated({ count: 1 }), tone: 'success' });
    } catch (error) {
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  async function restoreOne(project: ProjectSummary) {
    try {
      await restoreProject(project.id);
      if (query.filter === 'trash') remove([project.id]);
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
      await load();
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
      await load();
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

  function menuFor(project: ProjectSummary): MenuItem[] {
    if (project.deletedAt) return [{ label: m.dashboard_restore(), onSelect: () => void restoreOne(project) }];
    const items: MenuItem[] = [];
    if (roleAtLeast(project.role, 'editor')) {
      items.push({
        label: m.dashboard_rename(),
        onSelect: () => {
          renaming = project;
          renameOpen = true;
        },
      });
    }
    items.push({ label: m.dashboard_duplicate(), onSelect: () => void duplicateOne(project) });
    if (project.role === 'admin') {
      items.push({ label: m.dashboard_move_to_trash(), danger: true, onSelect: () => askDelete([project.id]) });
    }
    return items;
  }

  const filtered = $derived(query.q !== '' || query.filter !== 'all');
  const deleteCount = $derived(pendingDelete.length);
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && selection.size > 0 && !confirmOpen && !renameOpen) selection.clear();
  }}
/>

<section aria-labelledby="projects-heading" class="flex flex-col gap-5">
  <h2 id="projects-heading" class="sr-only">{m.dashboard_projects()}</h2>
  <ProjectFilters value={query} onchange={update} />

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.dashboard_loading_projects()}</p>
    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {#each [0, 1, 2, 3] as index (index)}
        <li class="rounded-panel bg-surface-1 p-2">
          <Skeleton class="aspect-[16/10] w-full" />
          <Skeleton class="mt-3 h-4 w-2/3" />
          <Skeleton class="mt-2 h-3 w-1/2" />
        </li>
      {/each}
    </ul>
  {:else if status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      <p class="text-sm">{m.dashboard_projects_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else if items.length === 0}
    <div class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      {#if query.q}
        <p class="text-sm">{m.dashboard_empty_search({ q: query.q })}</p>
        <Button size="sm" onclick={() => update({ ...query, q: '', filter: 'all' })}>{m.dashboard_clear_filters()}</Button>
      {:else if query.filter === 'trash'}
        <p class="text-sm">{m.dashboard_empty_trash()}</p>
      {:else if query.filter === 'favorites'}
        <p class="text-sm">{m.dashboard_empty_favorites()}</p>
      {:else if filtered}
        <p class="text-sm">{m.dashboard_empty_filter()}</p>
        <Button size="sm" onclick={() => update({ ...query, filter: 'all' })}>{m.dashboard_clear_filters()}</Button>
      {:else}
        <p class="text-sm">{m.dashboard_empty_workspace()}</p>
      {/if}
    </div>
  {:else}
    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={m.dashboard_projects()}>
      {#each items as project (project.id)}
        <ProjectCard
          {project}
          {meId}
          menu={menuFor(project)}
          selected={selection.has(project.id)}
          selecting={selection.size > 0}
          onselect={(range) => selection.toggle(project.id, order, { range })}
          onfavorite={() => void toggleFavorite(project)}
        />
      {/each}
    </ul>
    {#if nextCursor}
      <div>
        <Button size="sm" loading={loadingMore} onclick={() => void load(true)}>{m.dashboard_load_more()}</Button>
      </div>
    {/if}
  {/if}
</section>

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
