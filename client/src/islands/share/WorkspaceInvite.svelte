<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api.ts';
  import { formatDate } from '../../lib/format.ts';
  import {
    cancelWorkspaceInvitation,
    createWorkspaceInvitation,
    listWorkspaceInvitations,
    type WorkspaceInvitation,
    type WorkspaceInviteRole,
  } from '../../lib/sharing.ts';
  import { m } from '../../paraglide/messages.js';
  import { WORKSPACE_INVITE_ROLES } from '../../shared/api/workspaces.js';
  import Button from '../../ui/Button.svelte';
  import Input from '../../ui/Input.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { emailError } from '../auth/validate.ts';
  import { SELECT_CLASS } from './roles.ts';

  type Props = { slug: string };
  let { slug }: Props = $props();

  const uid = $props.id();
  const ROLE_LABEL: Record<WorkspaceInviteRole, () => string> = { admin: m.role_admin, member: m.role_member };

  let email = $state('');
  let role = $state<WorkspaceInviteRole>('member');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let pending = $state<WorkspaceInvitation[]>([]);
  let canceling = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(false);

  onMount(() => void load());

  async function load() {
    loading = true;
    loadError = null;
    try {
      pending = (await listWorkspaceInvitations(slug)).items;
    } catch (cause) {
      pending = [];
      loadError = message(cause);
    } finally {
      loading = false;
    }
  }

  function message(cause: unknown) {
    if (cause instanceof ApiError && cause.code === 'CONFLICT') return m.members_invite_conflict();
    return cause instanceof ApiError ? cause.message : m.error_internal();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    error = emailError(address);
    if (error) return;
    busy = true;
    try {
      const invitation = await createWorkspaceInvitation(slug, address, role);
      pending = [invitation, ...pending.filter((item) => item.id !== invitation.id)];
      email = '';
      showToast({ message: m.members_invite_sent({ email: invitation.email }), tone: 'success' });
    } catch (cause) {
      const notified = cause instanceof ApiError && (cause.code === 'NETWORK' || cause.code === 'RATE_LIMITED');
      if (!notified) error = message(cause);
    } finally {
      busy = false;
    }
  }

  async function cancel(invitation: WorkspaceInvitation) {
    canceling = invitation.id;
    try {
      await cancelWorkspaceInvitation(slug, invitation.id);
      pending = pending.filter((item) => item.id !== invitation.id);
      showToast({ message: m.members_invite_canceled({ email: invitation.email }), tone: 'success' });
    } catch (cause) {
      const notified = cause instanceof ApiError && (cause.code === 'NETWORK' || cause.code === 'RATE_LIMITED');
      if (!notified) showToast({ message: message(cause), tone: 'error' });
    } finally {
      canceling = null;
    }
  }
</script>

<section aria-labelledby="{uid}-title" class="flex flex-col gap-3 rounded-panel bg-surface-1 p-4">
  <div class="flex flex-col gap-1">
    <h3 id="{uid}-title" class="text-sm font-semibold">{m.members_invite_title()}</h3>
    <p id="{uid}-hint" class="text-xs text-ink-muted">{m.members_invite_hint()}</p>
  </div>
  <form onsubmit={submit} class="flex flex-col gap-2" novalidate>
    <div class="flex flex-wrap gap-2">
      <label class="sr-only" for="{uid}-email">{m.auth_field_email()}</label>
      <Input
        id="{uid}-email"
        type="email"
        autocomplete="off"
        placeholder="nombre@ejemplo.com"
        bind:value={email}
        invalid={Boolean(error)}
        describedBy="{uid}-hint {uid}-error"
        class="h-9 min-w-0 flex-1 text-sm sm:max-w-sm"
      />
      <label class="sr-only" for="{uid}-role">{m.members_invite_role()}</label>
      <select id="{uid}-role" bind:value={role} class={SELECT_CLASS}>
        {#each WORKSPACE_INVITE_ROLES as option (option)}
          <option value={option}>{ROLE_LABEL[option]()}</option>
        {/each}
      </select>
      <Button type="submit" size="sm" variant="primary" class="h-9" loading={busy}>{m.members_invite_submit()}</Button>
    </div>
    <p id="{uid}-error" aria-live="polite" class="text-sm text-danger empty:hidden">{error ?? ''}</p>
  </form>

  {#if loadError}
    <div class="flex flex-wrap items-center gap-2" role="alert">
      <p class="text-sm text-danger">{m.members_pending_error({ error: loadError })}</p>
      <Button size="sm" variant="secondary" loading={loading} onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else if pending.length}
    <h4 id="{uid}-pending" class="pt-1 text-xs font-semibold text-ink-muted">{m.members_pending_title()}</h4>
    <ul class="flex flex-col gap-1" aria-labelledby="{uid}-pending">
      {#each pending as invitation (invitation.id)}
        <li class="flex items-center gap-3 rounded-panel bg-surface-2 px-3 py-2" data-testid="pending-invitation">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{invitation.email}</p>
            <p class="truncate text-xs text-ink-muted">
              {m.members_pending_meta({
                role: ROLE_LABEL[invitation.role](),
                date: formatDate(invitation.expiresAt),
                name: invitation.inviter.name,
              })}
            </p>
          </div>
          <Button
            size="sm"
            variant="danger-ghost"
            label={m.members_invite_cancel_label({ email: invitation.email })}
            loading={canceling === invitation.id}
            onclick={() => void cancel(invitation)}
          >
            {m.members_invite_cancel()}
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
