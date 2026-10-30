<script lang="ts">
  import { ApiError, apiFetch } from '../../lib/api.ts';
  import type { AccountActions } from '../../lib/auth.ts';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Checkbox from '../../ui/Checkbox.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import FormError from '../auth/FormError.svelte';
  import { describeFailure, passwordError } from '../auth/validate.ts';

  type Props = { hasPassword: boolean; actions: AccountActions; onchanged: () => void };
  let { hasPassword, actions, onchanged }: Props = $props();

  let current = $state('');
  let next = $state('');
  let revokeOthers = $state(true);
  let errors = $state<{ current: string | null; next: string | null; form: string | null }>({ current: null, next: null, form: null });
  let busy = $state(false);

  function reset() {
    current = '';
    next = '';
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    errors = {
      current: hasPassword && !current ? m.settings_password_current_required() : null,
      next: passwordError(next),
      form: null,
    };
    if (errors.current || errors.next) return;
    busy = true;
    if (hasPassword) {
      const result = await actions.changePassword(current, next, revokeOthers);
      busy = false;
      if (!result.ok) {
        const failure = describeFailure(result);
        if (result.code === 'INVALID_PASSWORD' || failure.field === 'password') {
          errors = { ...errors, current: m.settings_password_wrong() };
        } else {
          errors = { ...errors, form: failure.message };
        }
        return;
      }
      reset();
      showToast({ message: m.settings_password_changed(), tone: 'success' });
      onchanged();
      return;
    }
    try {
      await apiFetch('/v1/me/password', { method: 'POST', body: { newPassword: next } });
      reset();
      showToast({ message: m.settings_password_created(), tone: 'success' });
      onchanged();
    } catch (error) {
      errors = { ...errors, form: error instanceof ApiError ? error.message : m.error_internal() };
    } finally {
      busy = false;
    }
  }
</script>

<section aria-labelledby="password-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <h2 id="password-heading" class="text-lg font-semibold">
    {hasPassword ? m.settings_password() : m.settings_password_create()}
  </h2>
  {#if !hasPassword}
    <p class="mt-1 text-sm text-ink-muted">{m.settings_password_create_lead()}</p>
  {/if}
  <form class="mt-4 flex flex-col gap-4" onsubmit={submit} novalidate>
    {#if hasPassword}
      <Field label={m.settings_password_current()} error={errors.current}>
        {#snippet children(control)}
          <Input id={control.id} describedBy={control.describedBy} invalid={control.invalid} type="password" bind:value={current} autocomplete="current-password" />
        {/snippet}
      </Field>
    {/if}
    <Field label={m.auth_field_new_password()} hint={m.auth_password_hint()} error={errors.next}>
      {#snippet children(control)}
        <Input id={control.id} describedBy={control.describedBy} invalid={control.invalid} type="password" bind:value={next} autocomplete="new-password" />
      {/snippet}
    </Field>
    {#if hasPassword}
      <Checkbox bind:checked={revokeOthers} label={m.settings_password_revoke_others()} class="self-start" />
    {/if}
    <FormError message={errors.form} />
    <div>
      <Button type="submit" loading={busy}>{hasPassword ? m.settings_password_submit() : m.settings_password_create()}</Button>
    </div>
  </form>
</section>
