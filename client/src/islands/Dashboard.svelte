<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Upload from '@lucide/svelte/icons/upload';
  import { onMount } from 'svelte';
  import { ApiError, browser } from '../lib/api.ts';
  import {
    byLastEdited,
    duplicateProject,
    importProjectArchive,
    listSharedProjects,
    listWorkspaceProjects,
    setFavorite,
  } from '../lib/projects.ts';
  import { loadSession, session } from '../lib/session.svelte.ts';
  import { activeWorkspaces, loadWorkspaces, workspaces, type Workspace } from '../lib/workspaces.svelte.ts';
  import { m } from '../paraglide/messages.js';
  import type { ProjectSummary } from '../shared/api/projects.js';
  import Button from '../ui/Button.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import Field from '../ui/Field.svelte';
  import type { MenuItem } from '../ui/Menu.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import { showToast } from '../ui/toast.svelte.ts';
  import ProjectCard from './dashboard/ProjectCard.svelte';
  import NewProjectDialog from './templates/NewProjectDialog.svelte';

  const RECENT = 8;
  const PER_WORKSPACE = 8;
  // En el inicio se consultan como mucho estos espacios; el resto se abre desde la barra lateral.
  const MAX_WORKSPACES = 12;

  let welcome = $state(false);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let recent = $state<ProjectSummary[]>([]);
  let favorites = $state<ProjectSummary[]>([]);
  let shared = $state<ProjectSummary[]>([]);

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

  onMount(() => {
    const url = new URL(window.location.href);
    welcome = url.searchParams.has('bienvenida');
    if (welcome) {
      url.searchParams.delete('bienvenida');
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    void loadSession();
    void load();
  });

  async function load() {
    status = 'loading';
    try {
      const list = (await loadWorkspaces()).filter((workspace) => workspace.deletedAt === null).slice(0, MAX_WORKSPACES);
      if (workspaces.status === 'error') throw workspaces.error;
      const [recentPages, favoritePages, sharedPage] = await Promise.all([
        Promise.all(list.map((workspace) => listWorkspaceProjects(workspace.slug, { sort: 'edited', dir: 'desc', limit: PER_WORKSPACE }))),
        Promise.all(list.map((workspace) => listWorkspaceProjects(workspace.slug, { filter: 'favorites', sort: 'edited', dir: 'desc', limit: PER_WORKSPACE }))),
        listSharedProjects(),
      ]);
      recent = recentPages.flatMap((page) => page.items).sort(byLastEdited).slice(0, RECENT);
      favorites = [...favoritePages.flatMap((page) => page.items), ...sharedPage.items.filter((item) => item.favorite)].sort(byLastEdited);
      shared = sharedPage.items;
      status = 'ready';
    } catch {
      status = 'error';
    }
  }

  function replaceEverywhere(project: ProjectSummary) {
    const swap = (list: ProjectSummary[]) => list.map((item) => (item.id === project.id ? project : item));
    recent = swap(recent);
    shared = swap(shared);
    favorites = project.favorite
      ? favorites.some((item) => item.id === project.id)
        ? swap(favorites)
        : [project, ...favorites].sort(byLastEdited)
      : favorites.filter((item) => item.id !== project.id);
  }

  async function toggleFavorite(project: ProjectSummary) {
    const next = { ...project, favorite: !project.favorite };
    replaceEverywhere(next);
    try {
      await setFavorite(project.id, next.favorite);
    } catch (error) {
      replaceEverywhere(project);
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    }
  }

  function menuFor(project: ProjectSummary): MenuItem[] {
    return [
      {
        label: m.dashboard_duplicate(),
        onSelect: async () => {
          try {
            const copy = await duplicateProject(project.id);
            recent = [copy, ...recent].slice(0, RECENT);
            showToast({ message: m.dashboard_duplicated({ count: 1 }), tone: 'success' });
          } catch (error) {
            showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
          }
        },
      },
    ];
  }

  function openCreate() {
    newWorkspace = (spaces.find((workspace) => workspace.personal) ?? spaces[0])?.slug ?? '';
    createOpen = true;
  }

  function openImport() {
    importWorkspace = (spaces.find((workspace) => workspace.personal) ?? spaces[0])?.slug ?? '';
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

  function roleOf(workspace: Workspace) {
    return { owner: m.role_owner, admin: m.role_admin, member: m.role_member }[workspace.role]();
  }
</script>

{#snippet grid(list: ProjectSummary[], label: string)}
  <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={label}>
    {#each list as project (project.id)}
      <ProjectCard
        {project}
        {meId}
        menu={menuFor(project)}
        showWorkspace={names.get(project.workspaceSlug) ?? null}
        onfavorite={() => void toggleFavorite(project)}
      />
    {/each}
  </ul>
{/snippet}

<div class="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-8">
  {#if welcome}
    <p role="status" class="rounded-panel bg-petrol px-4 py-3 text-sm">{m.app_welcome()}</p>
  {/if}

  <header class="flex flex-wrap items-center gap-4">
    {#if session.me}
      <h1 class="min-w-0 flex-1 truncate text-xl font-bold">{m.app_greeting({ name: session.me.user.name })}</h1>
    {:else}
      <div class="flex-1"><Skeleton class="h-8 w-56" /></div>
    {/if}
    <Button disabled={spaces.length === 0} onclick={openImport}>
      <Upload size={16} aria-hidden="true" />
      {m.dashboard_import()}
    </Button>
    <Button variant="primary" disabled={spaces.length === 0} onclick={openCreate}>
      <Plus size={16} aria-hidden="true" />
      {m.dashboard_new_project()}
    </Button>
  </header>

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.dashboard_loading_home()}</p>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
      {#each [0, 1, 2, 3] as index (index)}
        <Skeleton class="aspect-[16/12] w-full" />
      {/each}
    </div>
  {:else if status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      <p class="text-sm">{m.dashboard_home_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else}
    <section aria-labelledby="recent-heading" class="flex flex-col gap-3">
      <h2 id="recent-heading" class="text-lg font-semibold">{m.dashboard_recent()}</h2>
      {#if recent.length}
        {@render grid(recent, m.dashboard_recent())}
      {:else}
        <p class="rounded-panel bg-surface-1 p-6 text-sm">{m.dashboard_empty_recent()}</p>
      {/if}
    </section>

    <section aria-labelledby="favorites-heading" class="flex flex-col gap-3">
      <h2 id="favorites-heading" class="text-lg font-semibold">{m.dashboard_favorites()}</h2>
      {#if favorites.length}
        {@render grid(favorites, m.dashboard_favorites())}
      {:else}
        <p class="rounded-panel bg-surface-1 p-6 text-sm text-ink-muted">{m.dashboard_empty_home_favorites()}</p>
      {/if}
    </section>

    <section aria-labelledby="shared-heading" class="flex flex-col gap-3">
      <h2 id="shared-heading" class="text-lg font-semibold">{m.dashboard_shared()}</h2>
      {#if shared.length}
        {@render grid(shared, m.dashboard_shared())}
      {:else}
        <p class="rounded-panel bg-surface-1 p-6 text-sm text-ink-muted">{m.dashboard_empty_shared()}</p>
      {/if}
    </section>

    <section aria-labelledby="spaces-heading" class="flex flex-col gap-3">
      <h2 id="spaces-heading" class="text-lg font-semibold">{m.dashboard_spaces()}</h2>
      <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each spaces as workspace (workspace.id)}
          <li>
            <a
              href="/app/e/{workspace.slug}"
              class="flex flex-col rounded-panel bg-surface-1 px-4 py-3 hover:bg-surface-2"
            >
              <span class="truncate text-sm font-semibold">{workspace.name}</span>
              <span class="text-xs text-ink-muted">{workspace.personal ? m.dashboard_personal_space() : roleOf(workspace)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
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
        <select
          id="import-project-space"
          bind:value={importWorkspace}
          class="h-11 cursor-pointer rounded-panel border border-edge bg-surface-2 px-3 text-base text-ink hover:border-ink-muted focus-visible:border-coral"
        >
          {#each spaces as workspace (workspace.id)}
            <option value={workspace.slug}>{workspace.name}</option>
          {/each}
        </select>
      </div>
    {/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={() => (importOpen = false)}>{m.common_cancel()}</Button>
      <Button type="submit" variant="primary" loading={importing}>{m.dashboard_import_submit()}</Button>
    </div>
  </form>
</Dialog>
