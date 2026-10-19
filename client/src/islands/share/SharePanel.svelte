<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError } from '../../lib/api.ts';
  import { assetUrl } from '../../lib/assets.ts';
  import { listProjectMembers, removeProjectMember, setProjectMemberRole, type ProjectMember } from '../../lib/sharing.ts';
  import { m } from '../../paraglide/messages.js';
  import { PROJECT_ROLES, roleAtLeast, type ProjectRole } from '../../shared/permissions.js';
  import Avatar from '../../ui/Avatar.svelte';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { PROJECT_ROLE_LABEL, SELECT_CLASS } from './roles.ts';
  import ShareInvite from './ShareInvite.svelte';
  import ShareLinks from './ShareLinks.svelte';

  type Props = { open: boolean; projectId: string; projectName: string; meId: string; myRole: ProjectRole };
  let { open = $bindable(false), projectId, projectName, meId, myRole }: Props = $props();

  let people = $state<ProjectMember[]>([]);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let avatars = $state<Record<string, string | null>>({});
  let busy = $state<string | null>(null);
  // Cambia cuando una invitación por email crea un enlace, para que la lista de enlaces se recargue.
  let linksVersion = $state(0);

  const roleOptions = $derived(PROJECT_ROLES.filter((role) => roleAtLeast(myRole, role)));

  $effect(() => {
    if (!open) return;
    untrack(() => void load());
  });

  async function load() {
    status = 'loading';
    try {
      const { items } = await listProjectMembers(projectId);
      people = items;
      status = 'ready';
      for (const person of items) {
        const id = person.avatarAssetId;
        if (!id || id in avatars) continue;
        avatars[id] = null;
        void assetUrl(id).then((url) => (avatars[id] = url));
      }
    } catch {
      status = 'error';
    }
  }

  function fail(error: unknown) {
    const notified = error instanceof ApiError && (error.code === 'NETWORK' || error.code === 'RATE_LIMITED');
    if (!notified) showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
  }

  // Solo el acceso directo se cambia o se quita aquí; el que da el espacio se gestiona en el espacio.
  function editable(person: ProjectMember) {
    return person.userId !== meId && person.origin === 'direct' && roleAtLeast(myRole, person.role);
  }

  async function changeRole(person: ProjectMember, select: HTMLSelectElement) {
    const role = select.value as ProjectRole;
    busy = person.userId;
    try {
      const updated = await setProjectMemberRole(projectId, person.userId, role);
      people = people.map((item) => (item.userId === person.userId ? updated : item));
      showToast({ message: m.share_role_changed({ name: person.name, role: PROJECT_ROLE_LABEL[updated.role]() }), tone: 'success' });
    } catch (error) {
      select.value = person.role;
      fail(error);
    } finally {
      busy = null;
    }
  }

  async function remove(person: ProjectMember) {
    busy = person.userId;
    try {
      await removeProjectMember(projectId, person.userId);
      showToast({ message: m.share_removed({ name: person.name }), tone: 'success' });
      await load();
    } catch (error) {
      fail(error);
    } finally {
      busy = null;
    }
  }

  function invited(kind: 'direct' | 'link') {
    if (kind === 'direct') void load();
    else linksVersion += 1;
  }
</script>

<Dialog bind:open title={m.share_title({ name: projectName })} description={m.share_description()}>
  <div class="flex flex-col gap-7" data-testid="share-panel">
    <ShareInvite {projectId} {fail} oninvited={invited} />

    <section aria-labelledby="share-people" class="flex flex-col gap-3">
      <h3 id="share-people" class="text-sm font-semibold">{m.share_people_title()}</h3>
      {#if status === 'loading'}
        <p class="sr-only" role="status">{m.share_people_loading()}</p>
        <div class="flex flex-col gap-2" aria-hidden="true">
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
        </div>
      {:else if status === 'error'}
        <div role="alert" class="flex flex-col items-start gap-3">
          <p class="text-sm">{m.share_people_error()}</p>
          <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
        </div>
      {:else}
        <ul class="flex flex-col gap-1" aria-labelledby="share-people">
          {#each people as person (person.userId)}
            <li class="flex items-center gap-3 rounded-panel bg-surface-2 px-3 py-2" data-testid="share-person">
              <Avatar name={person.name} src={person.avatarAssetId ? (avatars[person.avatarAssetId] ?? null) : null} size="sm" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">
                  {person.name}{#if person.userId === meId}<span class="font-normal text-ink-muted"> {m.share_you()}</span>{/if}
                </p>
                <p class="text-xs text-ink-muted">
                  {person.origin === 'workspace' ? m.share_origin_workspace() : m.share_origin_direct()}
                </p>
              </div>
              {#if editable(person)}
                <label class="sr-only" for="share-role-{person.userId}">{m.share_role_label({ name: person.name })}</label>
                <select
                  id="share-role-{person.userId}"
                  value={person.role}
                  disabled={busy === person.userId}
                  onchange={(event) => void changeRole(person, event.currentTarget)}
                  class={SELECT_CLASS}
                >
                  {#each roleOptions as role (role)}
                    <option value={role}>{PROJECT_ROLE_LABEL[role]()}</option>
                  {/each}
                </select>
                <Button
                  size="sm"
                  variant="danger-ghost"
                  label={m.share_remove_label({ name: person.name })}
                  disabled={busy === person.userId}
                  onclick={() => void remove(person)}
                >
                  {m.share_remove()}
                </Button>
              {:else}
                <span class="shrink-0 text-sm text-ink-muted">{PROJECT_ROLE_LABEL[person.role]()}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <ShareLinks {projectId} {fail} version={linksVersion} />
  </div>
</Dialog>
