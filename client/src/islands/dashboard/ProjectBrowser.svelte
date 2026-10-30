<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api.ts';
  import { replaceAppUrl } from '../../lib/app-location.svelte.ts';
  import { listWorkspaceProjects, sortDirection } from '../../lib/projects.ts';
  import { m } from '../../paraglide/messages.js';
  import type { ProjectSummary } from '../../shared/api/projects.js';
  import Button from '../../ui/Button.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import ProjectCollection from './ProjectCollection.svelte';
  import ProjectFilters, { type ProjectQuery } from './ProjectFilters.svelte';
  import ProjectSkeletons from './ProjectSkeletons.svelte';
  import { readView, type ProjectView } from './view.ts';

  type Props = { slug: string; meId: string };
  let { slug, meId }: Props = $props();

  let query = $state<ProjectQuery>({ q: '', filter: 'all', sort: 'edited' });
  let view = $state<ProjectView>('grid');
  let items = $state<ProjectSummary[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingMore = $state(false);
  let controller: AbortController | null = null;
  let collection = $state<ReturnType<typeof ProjectCollection> | null>(null);

  const order = $derived(items.map((item) => item.id));

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
    replaceAppUrl(url);
  }

  onMount(() => {
    query = readUrl();
    view = readView();
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
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!more) status = 'error';
      else showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    } finally {
      if (controller === current) loadingMore = false;
    }
  }

  function update(next: ProjectQuery) {
    if (next.filter !== query.filter) collection?.clearSelection();
    query = next;
    writeUrl(next);
    void load();
  }

  const filtered = $derived(query.q !== '' || query.filter !== 'all');
</script>

<section aria-labelledby="projects-heading" class="flex flex-col gap-5">
  <h2 id="projects-heading" class="sr-only">{m.dashboard_projects()}</h2>
  <ProjectFilters value={query} onchange={update} {view} onview={(next) => (view = next)} />

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.dashboard_loading_projects()}</p>
    <ProjectSkeletons {view} />
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
    <ProjectCollection
      bind:this={collection}
      bind:items
      {view}
      label={m.dashboard_projects()}
      {meId}
      trash={query.filter === 'trash'}
      removeOnUnfavorite={query.filter === 'favorites'}
      acceptsCopy={(copy) => copy.workspaceSlug === slug && query.filter !== 'trash'}
      onreload={() => load()}
    />
    {#if nextCursor}
      <div>
        <Button size="sm" loading={loadingMore} onclick={() => void load(true)}>{m.dashboard_load_more()}</Button>
      </div>
    {/if}
  {/if}
</section>
