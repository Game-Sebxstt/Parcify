<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Upload from '@lucide/svelte/icons/upload';
  import { onMount } from 'svelte';
  import { ApiError, browser } from '../lib/api.ts';
  import { replaceAppUrl } from '../lib/app-location.svelte.ts';
  import { importProjectArchive, listSharedProjects, listWorkspaceProjects, sortDirection } from '../lib/projects.ts';
  import { loadSession, session } from '../lib/session.svelte.ts';
  import { activeWorkspaces, loadWorkspaces, workspaces } from '../lib/workspaces.svelte.ts';
  import { m } from '../paraglide/messages.js';
  import type { ProjectSummary } from '../shared/api/projects.js';
  import Button from '../ui/Button.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import Field from '../ui/Field.svelte';
  import Select from '../ui/Select.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import Tabs, { type TabItem } from '../ui/Tabs.svelte';
  import { showToast } from '../ui/toast.svelte.ts';
  import ProjectCollection from './dashboard/ProjectCollection.svelte';
  import ProjectSkeletons from './dashboard/ProjectSkeletons.svelte';
  import ViewToggle from './dashboard/ViewToggle.svelte';
  import { mergeProjects, readView, recentProjects, type ProjectSort, type ProjectView } from './dashboard/view.ts';
  import NewProjectDialog from './templates/NewProjectDialog.svelte';

  type Tab = 'recientes' | 'compartidos' | 'favoritos';
  const TABS: Tab[] = ['recientes', 'compartidos', 'favoritos'];

  // En el inicio se consultan como mucho estos espacios; el resto se abre desde la barra lateral.
  const MAX_WORKSPACES = 12;
  // Vistos recientemente: los últimos de cada espacio y los compartidos, mezclados. Cuatro filas de cinco a 1440 px.
  const RECENT = 20;
  // Compartidos y favoritos: el máximo que da la API por petición.
  const PAGE = 50;
  const ALL = '*';

  let welcome = $state(false);
  let tab = $state<Tab>('recientes');
  let space = $state(ALL);
  let sort = $state<ProjectSort>('edited');
  let view = $state<ProjectView>('grid');
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let items = $state<ProjectSummary[]>([]);
  let controller: AbortController | null = null;

  let createOpen = $state(false);
  let newWorkspace = $state('');

  let importOpen = $state(false);
  let importWorkspace = $state('');
  let importFile = $state.raw<File | null>(null);
  let importError = $state<string | null>(null);
  let importing = $state(false);

  const meId = $derived(session.me?.user.id ?? '');
  const spaces = $derived(activeWorkspaces());
  const names = $derived(new Map(workspaces.items.map((workspace) => [workspace.slug, workspace.name])));
  const home = $derived(spaces.find((workspace) => workspace.personal) ?? spaces[0]);

  onMount(() => {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get('pestana');
    if (requested && (TABS as string[]).includes(requested)) tab = requested as Tab;
    view = readView();
    welcome = url.searchParams.has('bienvenida');
    if (welcome) {
      url.searchParams.delete('bienvenida');
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    void loadSession();
    void load();
    return () => controller?.abort();
  });

  async function load() {
    controller?.abort();
    const current = (controller = new AbortController());
    const { signal } = current;
    status = 'loading';
    try {
      const all = (await loadWorkspaces()).filter((workspace) => workspace.deletedAt === null).slice(0, MAX_WORKSPACES);
      if (workspaces.status === 'error') throw workspaces.error;
      const chosen = space === ALL ? all : all.filter((workspace) => workspace.slug === space);
      const inSpace = (list: ProjectSummary[]) => (space === ALL ? list : list.filter((item) => item.workspaceSlug === space));
      const perSpace = (filter: 'all' | 'favorites', limit: number, by: ProjectSort = sort) =>
        Promise.all(chosen.map((workspace) => listWorkspaceProjects(workspace.slug, { filter, sort: by, dir: sortDirection(by), limit }, signal)));

      let lists: ProjectSummary[][];
      if (tab === 'compartidos') {
        lists = [inSpace((await listSharedProjects(PAGE, signal)).items)];
      } else if (tab === 'favoritos') {
        const [pages, shared] = await Promise.all([perSpace('favorites', PAGE), listSharedProjects(PAGE, signal)]);
        lists = [...pages.map((page) => page.items), inSpace(shared.items.filter((item) => item.favorite))];
      } else {
        const [pages, shared] = await Promise.all([perSpace('all', RECENT, 'edited'), listSharedProjects(RECENT, signal)]);
        lists = [...pages.map((page) => page.items), inSpace(shared.items)];
      }
      if (controller !== current) return;
      items = tab === 'recientes' ? recentProjects(lists, sort, RECENT) : mergeProjects(lists, sort, PAGE * (chosen.length + 1));
      status = 'ready';
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      status = 'error';
    }
  }

  function selectTab(next: string) {
    tab = next as Tab;
    const url = new URL(window.location.href);
    if (tab === 'recientes') url.searchParams.delete('pestana');
    else url.searchParams.set('pestana', tab);
    replaceAppUrl(url);
    void load();
  }

  function openCreate() {
    newWorkspace = home?.slug ?? '';
    createOpen = true;
  }

  function openImport() {
    importWorkspace = home?.slug ?? '';
    importFile = null;
    importError = null;
    importOpen = true;
  }

  // Un .parcify exportado o una copia local: el servidor crea un proyecto nuevo y dice qué descartó.
  async function importArchive(event: SubmitEvent) {
    event.preventDefault();
    if (!importFile) {
      importError = m.dashboard_import_required();
      return;
    }
    importing = true;
    try {
      const result = await importProjectArchive(importWorkspace, importFile);
      if (result.droppedNodes === 0 && result.droppedAssets === 0) {
        browser.assign(`/p/${result.projectId}`);
        return;
      }
      importOpen = false;
      importing = false;
      showToast({
        message: m.dashboard_import_partial(),
        action: { label: m.dashboard_import_open(), run: () => browser.assign(`/p/${result.projectId}`) },
      });
      void load();
    } catch (error) {
      importError = error instanceof ApiError ? error.message : m.error_internal();
      importing = false;
    }
  }

  const TAB_LABEL: Record<Tab, () => string> = {
    recientes: m.dashboard_tab_recent,
    compartidos: m.dashboard_shared,
    favoritos: m.dashboard_favorites,
  };

  const tabs = $derived<TabItem[]>(TABS.map((value) => ({ value, label: TAB_LABEL[value](), content: body })));

  const spaceItems = $derived([
    { value: ALL, label: m.dashboard_space_all() },
    ...spaces.slice(0, MAX_WORKSPACES).map((workspace) => ({ value: workspace.slug, label: workspace.name })),
  ]);

  const sortItems = [
    { value: 'edited', label: m.dashboard_sort_edited() },
    { value: 'name', label: m.dashboard_sort_name() },
    { value: 'created', label: m.dashboard_sort_created() },
  ];
</script>

{#snippet filters()}
  {#if spaces.length > 1}
    <Select
      items={spaceItems}
      bind:value={
        () => space,
        (next) => {
          space = next;
          void load();
        }
      }
      label={m.dashboard_space_filter()}
      testid="dashboard-space"
      class="max-w-48"
    />
  {/if}
  <Select
    items={sortItems}
    bind:value={
      () => sort,
      (next) => {
        sort = next as ProjectSort;
        void load();
      }
    }
    label={m.dashboard_sort_label()}
    testid="dashboard-sort"
  />
  <ViewToggle {view} onchange={(next) => (view = next)} />
{/snippet}

{#snippet body()}
  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.dashboard_loading_home()}</p>
    <ProjectSkeletons {view} />
  {:else if status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      <p class="text-sm">{m.dashboard_home_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else if items.length === 0}
    <div class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      {#if space !== ALL}
        <p class="text-sm">{m.dashboard_empty_in_space({ name: names.get(space) ?? '' })}</p>
        <Button
          size="sm"
          onclick={() => {
            space = ALL;
            void load();
          }}
        >
          {m.dashboard_show_all_spaces()}
        </Button>
      {:else if tab === 'compartidos'}
        <p class="text-sm text-ink-muted">{m.dashboard_empty_shared()}</p>
      {:else if tab === 'favoritos'}
        <p class="text-sm text-ink-muted">{m.dashboard_empty_home_favorites()}</p>
      {:else}
        <p class="text-sm">{m.dashboard_empty_recent()}</p>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" disabled={spaces.length === 0} onclick={openCreate}>
            <Plus size={16} aria-hidden="true" />
            {m.dashboard_new_project()}
          </Button>
          {#if home}
            <Button size="sm" variant="ghost" href="/app/e/{home.slug}?vista=plantillas">{m.dashboard_browse_templates()}</Button>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <ProjectCollection
      bind:items
      {view}
      label={TAB_LABEL[tab]()}
      {meId}
      workspaceNames={names}
      removeOnUnfavorite={tab === 'favoritos'}
      acceptsCopy={(copy) => tab === 'recientes' && (space === ALL || copy.workspaceSlug === space)}
      onreload={() => load()}
    />
  {/if}
{/snippet}

<div class="mx-auto flex w-full max-w-7xl flex-col px-4 pb-10 sm:px-6">
  {#if welcome}
    <p role="status" class="mt-4 rounded-panel bg-petrol px-4 py-3 text-sm">{m.app_welcome()}</p>
  {/if}

  <header class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-3">
    {#if session.me}
      <h1 class="min-w-0 flex-1 truncate text-lg font-semibold">{m.app_greeting({ name: session.me.user.name })}</h1>
    {:else}
      <div class="flex-1"><Skeleton class="h-6 w-48" /></div>
    {/if}
    <Button size="sm" disabled={spaces.length === 0} onclick={openImport}>
      <Upload size={16} aria-hidden="true" />
      {m.dashboard_import()}
    </Button>
    <!-- En móvil la acción principal es el «+» de la cabecera de la app: un solo coral por pantalla. -->
    <Button size="sm" variant="primary" disabled={spaces.length === 0} onclick={openCreate} class="max-sm:hidden">
      <Plus size={16} aria-hidden="true" />
      {m.dashboard_new_project()}
    </Button>
  </header>

  <Tabs items={tabs} bind:value={tab} label={m.dashboard_tabs_label()} onValueChange={selectTab} lazy contentTabindex={-1} trailing={filters} />
</div>

<NewProjectDialog bind:open={createOpen} spaces={spaces} initialSlug={newWorkspace} />

<Dialog bind:open={importOpen} title={m.dashboard_import_title()}>
  <form onsubmit={importArchive} class="flex flex-col gap-5" novalidate>
    <Field label={m.dashboard_import_file()} hint={m.dashboard_import_hint()} error={importError}>
      {#snippet children(control)}
        <input
          id={control.id}
          type="file"
          accept=".parcify,application/zip"
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid}
          onchange={(event) => {
            importFile = event.currentTarget.files?.[0] ?? null;
            importError = null;
          }}
          class="cursor-pointer rounded-panel border border-edge bg-surface-2 p-2 text-sm text-ink file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-petrol file:px-3 file:py-1.5 file:font-semibold file:text-ink hover:border-ink-muted focus-visible:border-coral"
          data-testid="import-file"
        />
      {/snippet}
    </Field>
    {#if spaces.length > 1}
      <div class="flex flex-col gap-1.5">
        <label for="import-project-space" class="text-sm font-medium">{m.dashboard_project_space()}</label>
        <Select
          id="import-project-space"
          items={spaces.map((workspace) => ({ value: workspace.slug, label: workspace.name }))}
          bind:value={importWorkspace}
          label={m.dashboard_project_space()}
          size="lg"
        />
      </div>
    {/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={() => (importOpen = false)}>{m.common_cancel()}</Button>
      <Button type="submit" variant="primary" loading={importing}>{m.dashboard_import_submit()}</Button>
    </div>
  </form>
</Dialog>
