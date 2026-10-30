<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch, queryString } from '../../lib/api.ts';
  import { m } from '../../paraglide/messages.js';
  import {
    ProjectActivityResponseSchema,
    WorkspaceActivityResponseSchema,
    type ProjectActivityResponse,
    type WorkspaceActivityResponse,
  } from '../../shared/api/activity.js';
  import Button from '../../ui/Button.svelte';
  import Select from '../../ui/Select.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import ActivityReport from './ActivityReport.svelte';
  import { rangeFor } from './chart.ts';
  import EventHistory from './EventHistory.svelte';

  type Props = { slug: string };
  let { slug }: Props = $props();

  const RANGES = [7, 30, 90] as const;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Valor de la opción «Todo el espacio»: la lista no admite una opción con valor vacío.
  const WORKSPACE = 'workspace';
  const uid = $props.id();

  let days = $state<number>(30);
  let projectId = $state('');
  let workspaceReport = $state<WorkspaceActivityResponse | null>(null);
  let projectReport = $state<ProjectActivityResponse | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let request = 0;

  const report = $derived(projectId ? projectReport : workspaceReport);
  const projectName = $derived(workspaceReport?.projects.find((project) => project.id === projectId)?.name ?? '');
  const scopes = $derived([
    { value: WORKSPACE, label: m.activity_scope_workspace() },
    ...(workspaceReport?.projects ?? []).map((project) => ({ value: project.id, label: project.name })),
    ...(projectId && !projectName ? [{ value: projectId, label: projectId }] : []),
  ]);

  onMount(() => {
    const requested = new URL(window.location.href).searchParams.get('proyecto');
    if (requested && UUID.test(requested)) projectId = requested;
    void load();
  });

  async function load() {
    const current = ++request;
    status = 'loading';
    const params = queryString(rangeFor(days));
    try {
      const [space, project] = await Promise.all([
        apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/activity?${params}`, { schema: WorkspaceActivityResponseSchema }),
        projectId ? apiFetch(`/v1/projects/${projectId}/activity?${params}`, { schema: ProjectActivityResponseSchema }) : null,
      ]);
      if (current !== request) return;
      workspaceReport = space;
      projectReport = project;
      status = 'ready';
    } catch {
      if (current === request) status = 'error';
    }
  }

  function selectProject(next: string) {
    projectId = next;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('proyecto', next);
    else url.searchParams.delete('proyecto');
    history.replaceState(history.state, '', `${url.pathname}${url.search}`);
    void load();
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-wrap items-end gap-4">
    <div class="flex flex-col gap-1 text-sm">
      <label for="{uid}-scope" class="text-ink-muted">{m.activity_scope()}</label>
      <Select
        id="{uid}-scope"
        items={scopes}
        bind:value={() => projectId || WORKSPACE, (next) => selectProject(next === WORKSPACE ? '' : next)}
        label={m.activity_scope()}
        size="lg"
        class="h-10 min-w-56 px-3 text-sm"
      />
    </div>
    <div class="flex flex-col gap-1 text-sm">
      <label for="{uid}-range" class="text-ink-muted">{m.activity_range()}</label>
      <Select
        id="{uid}-range"
        items={RANGES.map((range) => ({ value: String(range), label: m.activity_range_days({ days: range }) }))}
        bind:value={
          () => String(days),
          (next) => {
            days = Number(next);
            void load();
          }
        }
        label={m.activity_range()}
        size="lg"
        class="h-10 px-3 text-sm"
      />
    </div>
  </div>

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.activity_loading()}</p>
    <div class="flex flex-col gap-3" aria-hidden="true">
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-60 w-full" />
    </div>
  {:else if status === 'error' || !report}
    <div role="alert" class="flex flex-col items-start gap-3">
      <p>{m.activity_error()}</p>
      <Button onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else}
    {#if projectId}
      <h2 class="text-lg font-semibold">{projectName || m.activity_project()}</h2>
    {:else}
      <h2 class="sr-only">{m.activity_scope_workspace()}</h2>
    {/if}
    <ActivityReport {report} projects={projectId ? null : workspaceReport?.projects} onproject={selectProject} />
  {/if}
  {#if projectId && status !== 'error'}
    {#key projectId}<EventHistory {projectId} />{/key}
  {/if}
</div>
