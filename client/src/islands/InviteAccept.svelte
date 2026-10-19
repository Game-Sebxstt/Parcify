<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, browser } from '../lib/api.ts';
  import { formatDate } from '../lib/format.ts';
  import {
    forgetInviteToken,
    inviteSignInPath,
    readInviteTarget,
    rememberInviteToken,
    type InviteTarget,
  } from '../lib/invite-link.ts';
  import { loadSession, signOut } from '../lib/session.svelte.ts';
  import {
    acceptReceivedInvitation,
    acceptShareLink,
    getReceivedInvitation,
    inspectShareLink,
    rejectReceivedInvitation,
    type ReceivedInvitation,
    type ShareLinkInspect,
  } from '../lib/sharing.ts';
  import { m } from '../paraglide/messages.js';
  import { SlugSchema } from '../shared/api/common.js';
  import { roleAtLeast } from '../shared/permissions.js';
  import Button from '../ui/Button.svelte';

  type View =
    | { kind: 'loading' }
    | { kind: 'missing' }
    | { kind: 'signed-out' }
    | { kind: 'link'; info: ShareLinkInspect }
    | { kind: 'workspace'; info: ReceivedInvitation }
    | { kind: 'declined' }
    | { kind: 'handled'; slug: string | null }
    // `switchAccount`: el error depende de la cuenta, así que se ofrece entrar con otra.
    // `retry`: fallo de red o del servidor; la misma invitación se puede volver a pedir.
    | { kind: 'error'; message: string; switchAccount: boolean; retry?: boolean };

  let view = $state<View>({ kind: 'loading' });
  let target = $state.raw<InviteTarget | null>(null);
  let email = $state('');
  let busy = $state<'accept' | 'decline' | 'switch' | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    void start();
    // Abrir otro enlace en la misma pestaña solo cambia el fragmento y no recarga la página.
    const onHashChange = () => {
      if (!window.location.hash) return;
      busy = null;
      error = null;
      view = { kind: 'loading' };
      void start();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  async function start() {
    target = readInviteTarget();
    if (!target) {
      view = { kind: 'missing' };
      return;
    }
    const me = await loadSession({ redirectOn401: false });
    if (!me) {
      if (target.kind === 'link') rememberInviteToken(target.token);
      // Se recarga con el overlay de acceso abierto y «volver» a esta misma invitación.
      if (!new URLSearchParams(window.location.search).has('acceso')) {
        window.location.replace(inviteSignInPath(target));
        return;
      }
      view = { kind: 'signed-out' };
      return;
    }
    email = me.user.email;
    forgetInviteToken();
    if (target.kind === 'link') await inspectLink(target.token);
    else await inspectWorkspace(target.invitationId);
  }

  async function inspectLink(token: string) {
    try {
      view = { kind: 'link', info: await inspectShareLink(token) };
      forgetInviteToken();
    } catch (cause) {
      const next = failure(cause, 'link');
      // Si se recarga tras un fallo pasajero, la invitación sigue disponible en esta pestaña.
      if (next.kind === 'error' && next.retry) rememberInviteToken(token);
      view = next;
    }
  }

  async function inspectWorkspace(invitationId: string) {
    try {
      const info = await getReceivedInvitation(invitationId);
      if (info.status === 'pending') view = { kind: 'workspace', info };
      else if (info.status === 'expired') view = { kind: 'error', message: m.invite_error_workspace_expired(), switchAccount: false };
      else view = { kind: 'handled', slug: info.status === 'accepted' ? info.workspace.slug : null };
    } catch (cause) {
      view = failure(cause, 'workspace');
    }
  }

  function failure(cause: unknown, kind: 'link' | 'workspace'): View {
    const code = cause instanceof ApiError ? cause.code : 'INTERNAL';
    switch (code) {
      case 'INVITE_EXPIRED':
        return { kind: 'error', message: kind === 'link' ? m.invite_error_link_expired() : m.invite_error_workspace_expired(), switchAccount: false };
      case 'INVITE_REVOKED':
        return { kind: 'error', message: m.invite_error_revoked(), switchAccount: false };
      case 'INVITE_USED_UP':
        return { kind: 'error', message: m.invite_error_used_up(), switchAccount: false };
      case 'INVITE_EMAIL_MISMATCH':
        return { kind: 'error', message: m.invite_error_email_mismatch(), switchAccount: true };
      case 'INVITE_NOT_FOUND':
      case 'NOT_FOUND':
        return kind === 'link'
          ? { kind: 'error', message: m.invite_error_link_not_found(), switchAccount: true }
          : { kind: 'error', message: m.invite_error_workspace_not_found({ email }), switchAccount: true };
      case 'INVITE_ALREADY_HANDLED': {
        const slug = cause instanceof ApiError ? SlugSchema.safeParse(cause.details.slug) : null;
        return { kind: 'handled', slug: slug?.success ? slug.data : null };
      }
      default:
        return { kind: 'error', message: cause instanceof ApiError ? cause.message : m.error_internal(), switchAccount: false, retry: true };
    }
  }

  async function retry() {
    const current = target;
    if (!current || busy) return;
    error = null;
    view = { kind: 'loading' };
    if (current.kind === 'link') await inspectLink(current.token);
    else await inspectWorkspace(current.invitationId);
  }

  async function accept() {
    const current = target;
    if (!current || busy) return;
    busy = 'accept';
    error = null;
    try {
      if (current.kind === 'link') {
        const { projectId } = await acceptShareLink(current.token);
        browser.assign(`/p/${encodeURIComponent(projectId)}`);
        return;
      }
      const { slug } = await acceptReceivedInvitation(current.invitationId);
      browser.assign(`/app/e/${encodeURIComponent(slug)}`);
      return;
    } catch (cause) {
      const next = failure(cause, current.kind);
      if (next.kind === 'handled' && next.slug) {
        browser.assign(`/app/e/${encodeURIComponent(next.slug)}`);
        return;
      }
      // Sin red o con demasiadas peticiones apiFetch ya avisó: la invitación sigue a la vista.
      if (cause instanceof ApiError && (cause.code === 'NETWORK' || cause.code === 'RATE_LIMITED')) error = cause.message;
      else view = next;
    }
    busy = null;
  }

  async function decline() {
    if (!target || busy) return;
    if (target.kind === 'link') {
      browser.assign('/app');
      return;
    }
    busy = 'decline';
    error = null;
    try {
      await rejectReceivedInvitation(target.invitationId);
      view = { kind: 'declined' };
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : m.error_internal();
    } finally {
      busy = null;
    }
  }

  async function switchAccount() {
    if (!target || busy) return;
    busy = 'switch';
    if (target.kind === 'link') rememberInviteToken(target.token);
    try {
      await signOut(inviteSignInPath(target));
    } catch {
      busy = null;
      error = m.error_internal();
    }
  }

  function linkMessage(info: ShareLinkInspect) {
    const values = { project: info.project.name, workspace: info.workspace.name };
    const edit = info.role === 'editor';
    if (info.inviter) {
      const named = { ...values, inviter: info.inviter.name };
      return edit ? m.invite_project_edit(named) : m.invite_project_view(named);
    }
    return edit ? m.invite_project_edit_anon(values) : m.invite_project_view_anon(values);
  }

  function workspaceMessage(info: ReceivedInvitation) {
    return m.invite_workspace({
      inviter: info.inviter.name,
      workspace: info.workspace.name,
      role: info.role === 'admin' ? m.invite_role_admin() : m.invite_role_member(),
    });
  }
</script>

<section aria-labelledby="invite-title" class="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-8">
  <h1 id="invite-title" class="text-2xl font-bold tracking-[-0.02em]">{m.invite_title()}</h1>

  {#if view.kind === 'loading'}
    <p role="status" class="text-ink-muted">{m.invite_loading()}</p>
  {:else if view.kind === 'missing'}
    <p>{m.invite_missing()}</p>
    <div><Button href="/" variant="secondary">{m.invite_go_app()}</Button></div>
  {:else if view.kind === 'signed-out' && target}
    <p>{m.invite_sign_in_lead()}</p>
    <div class="flex flex-wrap gap-2">
      <Button href={inviteSignInPath(target)} variant="primary" data-auth-open="entrar">{m.auth_submit_sign_in()}</Button>
      <Button href={inviteSignInPath(target, 'crear')} variant="secondary" data-auth-open="crear">{m.auth_submit_sign_up()}</Button>
    </div>
  {:else if view.kind === 'link' || view.kind === 'workspace'}
    {@const already = view.kind === 'link' && roleAtLeast(view.info.currentRole, view.info.role)}
    <div class="flex flex-col gap-2">
      <p class="text-lg" data-testid="invite-message">
        {view.kind === 'link' ? linkMessage(view.info) : workspaceMessage(view.info)}
      </p>
      <p class="text-sm text-ink-muted">
        {m.invite_expires({ date: formatDate(view.info.expiresAt) })} {m.invite_signed_in_as({ email })}
      </p>
    </div>
    {#if already && view.kind === 'link'}
      <p>{m.invite_already_member({ project: view.info.project.name })}</p>
      <div><Button href="/p/{view.info.project.id}" variant="primary">{m.invite_open_project()}</Button></div>
    {:else}
      <div class="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy === 'accept'} disabled={busy !== null} onclick={() => void accept()}>
          {busy === 'accept' ? m.invite_accepting() : m.invite_accept()}
        </Button>
        <Button variant="ghost" loading={busy === 'decline'} disabled={busy !== null} onclick={() => void decline()}>
          {m.invite_decline()}
        </Button>
      </div>
    {/if}
    <p role="alert" class="text-sm text-danger empty:hidden">{error ?? ''}</p>
  {:else if view.kind === 'declined'}
    <p role="status">{m.invite_declined()}</p>
    <div><Button href="/app" variant="secondary">{m.invite_go_app()}</Button></div>
  {:else if view.kind === 'handled'}
    <p role="status">{m.invite_workspace_handled()}</p>
    <div>
      {#if view.slug}
        <Button href="/app/e/{view.slug}" variant="primary">{m.invite_open_workspace()}</Button>
      {:else}
        <Button href="/app" variant="secondary">{m.invite_go_app()}</Button>
      {/if}
    </div>
  {:else if view.kind === 'error'}
    <p role="alert" data-testid="invite-error">{view.message}</p>
    {#if view.switchAccount}
      <p class="text-sm text-ink-muted">{m.invite_signed_in_as({ email })}</p>
    {/if}
    <div class="flex flex-wrap gap-2">
      {#if view.retry}
        <Button variant="primary" onclick={() => void retry()}>{m.common_retry()}</Button>
      {/if}
      {#if view.switchAccount}
        <Button variant="primary" loading={busy === 'switch'} onclick={() => void switchAccount()}>{m.invite_switch_account()}</Button>
      {/if}
      <Button href="/app" variant="secondary">{m.invite_go_app()}</Button>
    </div>
    <p role="alert" class="text-sm text-danger empty:hidden">{error ?? ''}</p>
  {/if}
</section>
