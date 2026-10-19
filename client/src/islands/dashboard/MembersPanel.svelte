<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, apiFetch, browser, queryString } from '../../lib/api.ts';
  import { assetUrl } from '../../lib/assets.ts';
  import { formatDate } from '../../lib/format.ts';
  import { loadWorkspaces } from '../../lib/workspaces.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import { WorkspaceMemberSchema, WorkspaceMembersResponseSchema } from '../../shared/api/workspaces.js';
  import type { OrgRole } from '../../shared/permissions.js';
  import Avatar from '../../ui/Avatar.svelte';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import type { z } from 'zod';
  import WorkspaceInvite from '../share/WorkspaceInvite.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';

  type Member = z.infer<typeof WorkspaceMemberSchema>;
  type Props = { slug: string; meId: string; myRole: OrgRole; personal: boolean };
  let { slug, meId, myRole, personal }: Props = $props();

  let members = $state<Member[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let avatars = $state<Record<string, string | null>>({});
  let pending = $state<{ member: Member; leave: boolean } | null>(null);
  let confirmOpen = $state(false);
  let busy = $state(false);

  const ROLE_LABEL: Record<OrgRole, () => string> = {
    owner: m.role_owner,
    admin: m.role_admin,
    member: m.role_member,
  };

  const isAdmin = $derived(myRole === 'owner' || myRole === 'admin');

  onMount(() => void load());

  async function load(more = false) {
    if (!more) status = 'loading';
    try {
      const params = queryString({ limit: '50', cursor: more ? nextCursor : null });
      const page = await apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/members?${params}`, {
        schema: WorkspaceMembersResponseSchema,
      });
      members = more ? [...members, ...page.items] : page.items;
      nextCursor = page.nextCursor;
      status = 'ready';
      for (const member of page.items) {
        if (!member.avatarAssetId) continue;
        void assetUrl(member.avatarAssetId).then((url) => (avatars = { ...avatars, [member.userId]: url }));
      }
    } catch {
      if (!more) status = 'error';
    }
  }

  // Un admin no toca a los owners; solo un owner nombra o cambia owners.
  function canEdit(member: Member) {
    if (member.userId === meId || !isAdmin) return false;
    return myRole === 'owner' || member.role !== 'owner';
  }

  function roleOptions(): OrgRole[] {
    return myRole === 'owner' ? ['owner', 'admin', 'member'] : ['admin', 'member'];
  }

  async function changeRole(member: Member, role: OrgRole) {
    const previous = member.role;
    members = members.map((item) => (item.id === member.id ? { ...item, role } : item));
    try {
      const updated = await apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/members/${member.id}`, {
        method: 'PATCH',
        body: { role },
        schema: WorkspaceMemberSchema,
      });
      members = members.map((item) => (item.id === member.id ? updated : item));
      showToast({ message: m.members_role_changed({ name: member.name, role: ROLE_LABEL[role]() }), tone: 'success' });
    } catch (error) {
      members = members.map((item) => (item.id === member.id ? { ...item, role: previous } : item));
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    }
  }

  function ask(member: Member) {
    pending = { member, leave: member.userId === meId };
    confirmOpen = true;
  }

  async function confirm() {
    if (!pending) return;
    const { member, leave } = pending;
    busy = true;
    try {
      await apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/members/${member.id}`, { method: 'DELETE' });
      confirmOpen = false;
      if (leave) {
        await loadWorkspaces({ force: true });
        browser.assign('/app');
        return;
      }
      members = members.filter((item) => item.id !== member.id);
      showToast({ message: m.members_removed({ name: member.name }), tone: 'success' });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    } finally {
      busy = false;
    }
  }
</script>

<section aria-labelledby="members-heading" class="flex flex-col gap-4">
  <h2 id="members-heading" class="text-lg font-semibold">{m.members_title()}</h2>

  {#if isAdmin}
    <WorkspaceInvite {slug} />
  {/if}

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.members_loading()}</p>
    <div class="flex flex-col gap-2" aria-hidden="true">
      {#each [0, 1, 2] as index (index)}
        <Skeleton class="h-14 w-full" />
      {/each}
    </div>
  {:else if status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      <p class="text-sm">{m.members_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else}
    <ul class="flex flex-col gap-1" aria-label={m.members_title()}>
      {#each members as member (member.id)}
        <li class="flex flex-wrap items-center gap-3 rounded-panel bg-surface-1 px-3 py-2.5">
          <Avatar name={member.name} src={avatars[member.userId] ?? null} />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">
              {member.name}{#if member.userId === meId}<span class="font-normal text-ink-muted"> {m.members_you()}</span>{/if}
            </p>
            <p class="truncate text-xs text-ink-muted">
              {member.email} · {m.members_since({ date: formatDate(member.createdAt) })}
            </p>
          </div>
          {#if canEdit(member)}
            <label class="sr-only" for="role-{member.id}">{m.members_role_label({ name: member.name })}</label>
            <select
              id="role-{member.id}"
              value={member.role}
              onchange={(event) => void changeRole(member, event.currentTarget.value as OrgRole)}
              class="h-8 cursor-pointer rounded-panel border border-edge bg-surface-2 px-2 text-sm text-ink hover:border-ink-muted focus-visible:border-coral"
            >
              {#each roleOptions() as role (role)}
                <option value={role}>{ROLE_LABEL[role]()}</option>
              {/each}
            </select>
            <Button size="sm" variant="danger-ghost" onclick={() => ask(member)}>{m.members_remove()}</Button>
          {:else}
            <span class="text-sm text-ink-muted">{ROLE_LABEL[member.role]()}</span>
            {#if member.userId === meId && !personal}
              <Button size="sm" variant="danger-ghost" onclick={() => ask(member)}>{m.members_leave()}</Button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    {#if nextCursor}
      <div><Button size="sm" onclick={() => void load(true)}>{m.dashboard_load_more()}</Button></div>
    {/if}
  {/if}
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={pending?.leave ? m.members_leave_title() : m.members_remove_title({ name: pending?.member.name ?? '' })}
  description={pending?.leave ? m.members_leave_body() : m.members_remove_body()}
  confirmLabel={pending?.leave ? m.members_leave() : m.members_remove()}
  danger
  {busy}
  onconfirm={() => void confirm()}
/>
