<script lang="ts">
  import { apiFetch, queryString } from '../../lib/api.ts';
  import { formatDate } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import { ActivityEventsResponseSchema, type ActivityEventDto } from '../../shared/api/activity.js';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';

  type Props = { projectId: string };
  let { projectId }: Props = $props();

  let events = $state<ActivityEventDto[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingMore = $state(false);

  const TITLES: Record<string, (params: { actor: string }) => string> = {
    'project.created': m.activity_event_project_created,
    'project.deleted': m.activity_event_project_deleted,
    'project.restored': m.activity_event_project_restored,
    'project.duplicated': m.activity_event_project_duplicated,
    'member.added': m.activity_event_member_added,
    'member.role_changed': m.activity_event_member_role_changed,
    'member.removed': m.activity_event_member_removed,
    'member.left': m.activity_event_member_left,
    'version.created': m.activity_event_version_created,
    'version.restored': m.activity_event_version_restored,
  };

  $effect(() => {
    void load(projectId);
  });

  async function load(id: string, more = false) {
    if (more) loadingMore = true;
    else status = 'loading';
    try {
      const params = queryString({ limit: '20', cursor: more ? nextCursor : null });
      const page = await apiFetch(`/v1/projects/${id}/activity/events?${params}`, { schema: ActivityEventsResponseSchema });
      if (id !== projectId) return;
      events = more ? [...events, ...page.items] : page.items;
      nextCursor = page.nextCursor;
      status = 'ready';
    } catch {
      if (!more && id === projectId) status = 'error';
    } finally {
      loadingMore = false;
    }
  }

  function title(event: ActivityEventDto) {
    const actor = event.actor ? (event.actor.name ?? m.activity_user_gone()) : m.activity_someone();
    return TITLES[event.type]?.({ actor }) ?? m.activity_event_other({ actor, type: event.type });
  }
</script>

<section aria-labelledby="activity-events" class="flex flex-col gap-3">
  <h3 id="activity-events" class="text-base font-semibold">{m.activity_events_title()}</h3>
  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.activity_events_loading()}</p>
    <div class="flex flex-col gap-2" aria-hidden="true"><Skeleton class="h-10 w-full" /><Skeleton class="h-10 w-full" /></div>
  {:else if status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3">
      <p class="text-sm">{m.activity_events_error()}</p>
      <Button size="sm" onclick={() => void load(projectId)}>{m.common_retry()}</Button>
    </div>
  {:else if events.length === 0}
    <p class="text-sm text-ink-muted">{m.activity_events_empty()}</p>
  {:else}
    <ul class="flex flex-col" aria-labelledby="activity-events">
      {#each events as event (event.id)}
        <li class="flex flex-col gap-0.5 border-t border-petrol py-2.5 first:border-t-0">
          <p class="text-sm font-medium">{title(event)}</p>
          <p class="text-xs text-ink-muted">
            <time datetime={event.createdAt}>{formatDate(event.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </p>
        </li>
      {/each}
    </ul>
    {#if nextCursor}
      <div><Button size="sm" loading={loadingMore} onclick={() => void load(projectId, true)}>{m.dashboard_load_more()}</Button></div>
    {/if}
  {/if}
</section>
