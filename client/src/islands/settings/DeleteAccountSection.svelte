<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, apiFetch, browser, invalidateCache } from '../../lib/api.ts';
  import { lazyAuthActions as authActions } from '../../lib/auth-lazy.ts';
  import { clearLocalCopies } from '../../lib/local-copies.ts';
  import { m } from '../../paraglide/messages.js';
  import { DeleteMeConflictDetailsSchema, type MeResponse } from '../../shared/api/me.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import FormError from '../auth/FormError.svelte';
  import { describeFailure } from '../auth/validate.ts';

  type Props = { me: MeResponse; hasPassword: boolean; googleEnabled: boolean };
  let { me, hasPassword, googleEnabled }: Props = $props();

  let open = $state(false);
  let step = $state<'confirm' | 'reauth' | 'blocked'>('confirm');
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let blocking = $state<Array<{ slug: string; name: string }>>([]);

  onMount(() => {
    // Al volver de entrar con Google para confirmar, el diálogo se abre de nuevo.
    const url = new URL(window.location.href);
    if (url.searchParams.get('borrar') === '1') {
      url.searchParams.delete('borrar');
      history.replaceState(history.state, '', `${url.pathname}${url.search}`);
      openDialog();
    }
  });

  function openDialog() {
    step = 'confirm';
    password = '';
    error = null;
    open = true;
  }

  async function remove() {
    busy = true;
    error = null;
    try {
      await apiFetch('/v1/me', { method: 'DELETE' });
      await clearLocalCopies(me.user.id);
      invalidateCache();
      browser.assign('/');
    } catch (failure) {
      busy = false;
      if (failure instanceof ApiError && failure.code === 'SESSION_NOT_FRESH') {
        step = 'reauth';
        return;
      }
      if (failure instanceof ApiError && failure.code === 'MUST_TRANSFER_OWNERSHIP') {
        const details = DeleteMeConflictDetailsSchema.safeParse(failure.details);
        blocking = details.success ? details.data.workspaces : [];
        step = 'blocked';
        return;
      }
      error = failure instanceof ApiError ? failure.message : m.error_internal();
    }
  }

  async function reauthenticate(event: SubmitEvent) {
    event.preventDefault();
    if (!password) {
      error = m.settings_password_current_required();
      return;
    }
    busy = true;
    const result = await authActions.signIn(me.user.email, password);
    if (!result.ok) {
      busy = false;
      error = describeFailure(result).message;
      return;
    }
    await remove();
  }

  async function reauthWithGoogle() {
    busy = true;
    const origin = window.location.origin;
    const result = await authActions.signInWithGoogle(`${origin}/app/ajustes?borrar=1`, `${origin}/app/ajustes?error=google`);
    if (!result.ok) {
      busy = false;
      error = describeFailure(result).message;
    }
  }
</script>

<section aria-labelledby="delete-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <h2 id="delete-heading" class="text-lg font-semibold">{m.settings_delete()}</h2>
  <p class="mt-1 text-sm text-ink-muted">{m.settings_delete_lead()}</p>
  <div class="mt-4"><Button variant="danger" onclick={openDialog}>{m.settings_delete_action()}</Button></div>
</section>

<Dialog bind:open title={m.settings_delete_title()}>
  {#if step === 'confirm'}
    <div class="flex flex-col gap-4">
      <p class="text-sm">{m.settings_delete_explain()}</p>
      <FormError message={error} />
      <div class="flex justify-end gap-2">
        <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
        <Button variant="danger" loading={busy} onclick={() => void remove()}>{m.settings_delete_confirm()}</Button>
      </div>
    </div>
  {:else if step === 'reauth'}
    <div class="flex flex-col gap-4">
      <p class="text-sm">{m.settings_delete_reauth()}</p>
      {#if hasPassword}
        <form class="flex flex-col gap-4" onsubmit={reauthenticate} novalidate>
          <Field label={m.auth_field_password()} error={error}>
            {#snippet children(control)}
              <Input id={control.id} describedBy={control.describedBy} invalid={control.invalid} type="password" bind:value={password} autocomplete="current-password" />
            {/snippet}
          </Field>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
            <Button type="submit" variant="danger" loading={busy}>{m.settings_delete_confirm()}</Button>
          </div>
        </form>
      {:else}
        <FormError message={error} />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
          <Button loading={busy} disabled={!googleEnabled} onclick={() => void reauthWithGoogle()}>{m.settings_delete_reauth_google()}</Button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-4">
      <p class="text-sm">{m.settings_delete_blocked()}</p>
      <ul class="flex flex-col gap-1">
        {#each blocking as workspace (workspace.slug)}
          <li>
            <a href="/app/e/{workspace.slug}?vista=miembros" class="text-sm font-semibold underline">{workspace.name}</a>
          </li>
        {/each}
      </ul>
      <div class="flex justify-end"><Button onclick={() => (open = false)}>{m.common_close()}</Button></div>
    </div>
  {/if}
</Dialog>
