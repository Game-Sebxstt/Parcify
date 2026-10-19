<script lang="ts">
  import { formatDate, formatNumber } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import type { ActivityCounters, ProjectActivityResponse, WorkspaceActivityResponse } from '../../shared/api/activity.js';
  import type { NodeType } from '../../shared/document/schema.js';
  import { kindLabel } from '../editor/kinds.ts';
  import { bucketByDay, type Metric } from './chart.ts';
  import EditsChart from './EditsChart.svelte';
  import MinutesChart from './MinutesChart.svelte';
  import { peopleOf } from './people.ts';

  type Props = {
    report: ProjectActivityResponse;
    projects?: WorkspaceActivityResponse['projects'] | null;
    onproject?: (id: string) => void;
  };
  let { report, projects = null, onproject }: Props = $props();

  const COLUMNS: Array<{ key: Metric; label: () => string }> = [
    { key: 'editOps', label: m.activity_edits },
    { key: 'activeMinutes', label: m.activity_minutes },
    { key: 'sessions', label: m.activity_sessions },
    { key: 'nodesCreated', label: m.activity_created },
    { key: 'nodesDeleted', label: m.activity_deleted },
    { key: 'chatMessages', label: m.activity_messages },
    { key: 'versionsCreated', label: m.activity_versions },
    { key: 'aiActions', label: m.activity_ai },
  ];
  const KNOWN_KINDS = new Set<string>(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc', 'line', 'connector', 'text', 'image', 'group', 'frame']);

  const people = $derived(peopleOf(report));
  const order = $derived(people.map((person) => person.id));
  const edits = $derived(bucketByDay(report.from, report.to, report.series, 'editOps', order));
  const minutes = $derived(bucketByDay(report.from, report.to, report.series, 'activeMinutes', order));
  const empty = $derived(COLUMNS.every((column) => report.totals[column.key] === 0));
  const kinds = $derived(
    Object.entries(report.nodeCountByType)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]),
  );
  const totalsOf = (userId: string): ActivityCounters | undefined => report.byUser.find((row) => row.userId === userId);
  const day = (value: string) => formatDate(`${value}T00:00:00Z`, { dateStyle: 'medium', timeZone: 'UTC' });
  const kind = (type: string) => (KNOWN_KINDS.has(type) ? kindLabel(type as NodeType) : type);
</script>

{#snippet countersTable(caption: string, firstLabel: string, rows: Array<{ id: string; name: string; counters: ActivityCounters; open?: () => void }>)}
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm tabular">
      <caption class="sr-only">{caption}</caption>
      <thead>
        <tr class="text-ink-muted">
          <th scope="col" class="py-1.5 pr-4 font-medium">{firstLabel}</th>
          {#each COLUMNS as column (column.key)}<th scope="col" class="py-1.5 pr-4 font-medium">{column.label()}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr class="border-t border-petrol">
            <th scope="row" class="py-1.5 pr-4 font-normal">
              {#if row.open}
                <button type="button" class="cursor-pointer text-left underline-offset-2 hover:underline" aria-label={m.activity_project_open({ name: row.name })} onclick={row.open}>
                  {row.name}
                </button>
              {:else}
                {row.name}
              {/if}
            </th>
            {#each COLUMNS as column (column.key)}<td class="py-1.5 pr-4">{formatNumber(row.counters[column.key])}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<div class="flex flex-col gap-8">
  <p class="text-sm text-ink-muted">{m.activity_period({ from: day(report.from), to: day(report.to) })}</p>

  {#if empty}
    <p class="text-sm">{m.activity_empty()}</p>
  {:else}
    <section aria-labelledby="activity-totals" class="flex flex-col gap-3">
      <h3 id="activity-totals" class="text-base font-semibold">{m.activity_totals()}</h3>
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each COLUMNS as column (column.key)}
          <div class="flex flex-col-reverse gap-1 rounded-panel bg-surface-1 p-4">
            <dt class="text-xs text-ink-muted">{column.label()}</dt>
            <dd class="text-xl font-semibold tabular">{formatNumber(report.totals[column.key])}</dd>
          </div>
        {/each}
      </dl>
    </section>

    <div class="grid gap-8 lg:grid-cols-2">
      <EditsChart buckets={edits} {people} />
      <MinutesChart buckets={minutes} />
    </div>

    <section aria-labelledby="activity-people" class="flex flex-col gap-3">
      <h3 id="activity-people" class="text-base font-semibold">{m.activity_people_title()}</h3>
      {@render countersTable(
        m.activity_people_title(),
        m.activity_person(),
        people.flatMap((person) => {
          const counters = totalsOf(person.id);
          return counters ? [{ id: person.id, name: person.name, counters }] : [];
        }),
      )}
    </section>

    {#if projects && projects.length > 0}
      <section aria-labelledby="activity-projects" class="flex flex-col gap-3">
        <h3 id="activity-projects" class="text-base font-semibold">{m.activity_projects_title()}</h3>
        {@render countersTable(
          m.activity_projects_title(),
          m.activity_project(),
          projects.map((project) => ({
            id: project.id,
            name: project.name,
            counters: project.totals,
            ...(onproject ? { open: () => onproject(project.id) } : {}),
          })),
        )}
      </section>
    {/if}
  {/if}

  {#if kinds.length > 0}
    <section aria-labelledby="activity-nodes" class="flex flex-col gap-3">
      <div>
        <h3 id="activity-nodes" class="text-base font-semibold">{m.activity_nodes_title()}</h3>
        <p class="text-sm text-ink-muted">{m.activity_nodes_lead()}</p>
      </div>
      <table class="w-full max-w-sm text-left text-sm tabular">
        <caption class="sr-only">{m.activity_nodes_title()}</caption>
        <thead>
          <tr class="text-ink-muted">
            <th scope="col" class="py-1.5 pr-4 font-medium">{m.activity_kind()}</th>
            <th scope="col" class="py-1.5 font-medium">{m.activity_count()}</th>
          </tr>
        </thead>
        <tbody>
          {#each kinds as [type, count] (type)}
            <tr class="border-t border-petrol">
              <th scope="row" class="py-1.5 pr-4 font-normal">{kind(type)}</th>
              <td class="py-1.5">{formatNumber(count)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <section aria-labelledby="activity-help" class="flex flex-col gap-2 rounded-panel bg-surface-1 p-5 text-sm">
    <h3 id="activity-help" class="text-base font-semibold">{m.activity_help_title()}</h3>
    <p>{m.activity_help_minutes()}</p>
    <p>{m.activity_help_edits()}</p>
    <p>{m.activity_help_sessions()}</p>
    <p>{m.activity_help_other()}</p>
    <p class="text-ink-muted">{m.activity_help_server()}</p>
  </section>
</div>
