<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import { onMount } from 'svelte';
  import type { z } from 'zod';
  import { ApiError, apiFetch } from '../lib/api.ts';
  import { replaceAppUrl } from '../lib/app-location.svelte.ts';
  import { formatDate } from '../lib/format.ts';
  import { loadSession, session } from '../lib/session.svelte.ts';
  import { loadWorkspaces } from '../lib/workspaces.svelte.ts';
  import { m } from '../paraglide/messages.js';
  import { WorkspaceDetailSchema } from '../shared/api/workspaces.js';
  import Button from '../ui/Button.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import Tabs, { type TabItem } from '../ui/Tabs.svelte';
  import { showToast } from '../ui/toast.svelte.ts';
  import ProjectBrowser from './dashboard/ProjectBrowser.svelte';
  import NewProjectDialog from './templates/NewProjectDialog.svelte';

  type Detail = z.infer<typeof WorkspaceDetailSchema>;
  type View = 'proyectos' | 'plantillas' | 'miembros' | 'actividad' | 'ajustes';

  const WORKSPACE_PATH = /^\/app\/e\/([a-z0-9-]{1,48})\/?$/;
  const VIEWS: View[] = ['proyectos', 'plantillas', 'miembros', 'actividad', 'ajustes'];

  let slug = $state('');
  let workspace = $state<Detail | null>(null);
  let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');
  let view = $state<View>('proyectos');
  let createOpen = $state(false);
  let restoring = $state(false);

  const isAdmin = $derived(workspace?.role === 'owner' || workspace?.role === 'admin');
  const meId = $derived(session.me?.user.id ?? '');

  onMount(() => {
    slug = WORKSPACE_PATH.exec(window.location.pathname)?.[1] ?? '';
    const requested = new URL(window.location.href).searchParams.get('vista');
    if (requested && (VIEWS as string[]).includes(requested)) view = requested as View;
    void loadSession();
    void load();
  });

  async function load() {
    if (!slug) {
      status = 'missing';
      return;
    }
    status = 'loading';
    try {
      workspace = await apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}`, { schema: WorkspaceDetailSchema });
      if (view === 'ajustes' && !isAdmin) view = 'proyectos';
      status = 'ready';
      document.title = m.workspace_meta_title({ name: workspace.name });
    } catch (error) {
      status = error instanceof ApiError && (error.status === 404 || error.status === 403) ? 'missing' : 'error';
    }
  }

  function selectView(next: string) {
    view = next as View;
    const url = new URL(window.location.href);
    if (view === 'proyectos') url.searchParams.delete('vista');
    else url.searchParams.set('vista', view);
    if (view !== 'actividad') url.searchParams.delete('proyecto');
    replaceAppUrl(url);
  }

  async function restore() {
    restoring = true;
    try {
      workspace = await apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/restore`, {
        method: 'POST',
        schema: WorkspaceDetailSchema,
      });
      await loadWorkspaces({ force: true });
      showToast({ message: m.workspace_restored({ name: workspace.name }), tone: 'success' });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    } finally {
      restoring = false;
    }
  }

  const ROLE_LABEL = { owner: m.role_owner, admin: m.role_admin, member: m.role_member } as const;

  const tabs = $derived<TabItem[]>([
    { value: 'proyectos', label: m.workspace_tab_projects(), content: projectsTab },
    { value: 'plantillas', label: m.workspace_tab_templates(), content: templatesTab },
    { value: 'miembros', label: m.workspace_tab_members(), content: membersTab },
    { value: 'actividad', label: m.workspace_tab_activity(), content: activityTab },
    ...(isAdmin ? [{ value: 'ajustes', label: m.workspace_tab_settings(), content: settingsTab }] : []),
  ]);
</script>

{#snippet projectsTab()}
  {#if workspace}<ProjectBrowser slug={workspace.slug} {meId} />{/if}
{/snippet}

<!-- Plantillas, miembros, actividad y ajustes se descargan al abrir su pestaña. -->
{#snippet templatesTab()}
  {#if workspace}
    {#await import('./templates/TemplateGallery.svelte') then { default: TemplateGallery }}
      <TemplateGallery slug={workspace.slug} {meId} onshowprojects={() => selectView('proyectos')} />
    {/await}
  {/if}
{/snippet}

{#snippet membersTab()}
  {#if workspace}
    {#await import('./dashboard/MembersPanel.svelte') then { default: MembersPanel }}
      <MembersPanel slug={workspace.slug} {meId} myRole={workspace.role} personal={workspace.personal} />
    {/await}
  {/if}
{/snippet}

{#snippet activityTab()}
  {#if workspace}
    {#await import('./activity/ActivityView.svelte') then { default: ActivityView }}
      <ActivityView slug={workspace.slug} />
    {/await}
  {/if}
{/snippet}

{#snippet settingsTab()}
  {#if workspace}
    {#await import('./dashboard/WorkspaceSettings.svelte') then { default: WorkspaceSettings }}
      <WorkspaceSettings {workspace} onupdated={(detail) => (workspace = detail)} />
    {/await}
  {/if}
{/snippet}

<div class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.workspace_loading()}</p>
    <Skeleton class="h-9 w-72" />
    <Skeleton class="h-10 w-96 max-w-full" />
  {:else if status === 'missing'}
    <div class="flex flex-col items-start gap-3">
      <h1 class="text-xl font-bold">{m.workspace_missing_title()}</h1>
      <p class="text-sm text-ink-muted">{m.workspace_missing_body()}</p>
      <Button href="/app">{m.workspace_back_home()}</Button>
    </div>
  {:else if status === 'error' || !workspace}
    <div role="alert" class="flex flex-col items-start gap-3">
      <p>{m.workspace_error()}</p>
      <Button onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else}
    <header class="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-lg font-semibold">{workspace.name}</h1>
        <p class="text-sm text-ink-muted">
          {ROLE_LABEL[workspace.role]()} · {m.workspace_counts({ projects: workspace.counts.projects, members: workspace.counts.members })}
        </p>
      </div>
      {#if !workspace.deletedAt && view === 'proyectos'}
        <Button size="sm" variant="primary" onclick={() => (createOpen = true)} class="max-sm:hidden">
          <Plus size={16} aria-hidden="true" />
          {m.dashboard_new_project()}
        </Button>
      {/if}
    </header>

    {#if workspace.deletedAt}
      <div class="flex flex-col items-start gap-3 rounded-panel bg-petrol p-5">
        <p class="text-sm">
          {m.workspace_in_trash({ date: workspace.purgeAt ? formatDate(workspace.purgeAt) : '' })}
        </p>
        <Button loading={restoring} onclick={() => void restore()}>{m.workspace_restore()}</Button>
      </div>
    {:else}
      <Tabs items={tabs} bind:value={view} label={m.workspace_tabs_label()} onValueChange={selectView} />
    {/if}
  {/if}
</div>

{#if workspace}
  <NewProjectDialog bind:open={createOpen} spaces={[{ slug: workspace.slug, name: workspace.name }]} />
{/if}
