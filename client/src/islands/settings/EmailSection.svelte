<script lang="ts">
  import { invalidateCache } from '../../lib/api.ts';
  import type { AccountActions } from '../../lib/auth.ts';
  import { loadSession } from '../../lib/session.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import FormError from '../auth/FormError.svelte';
  import Input from '../../ui/Input.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import CodeField from '../auth/CodeField.svelte';
  import { codeError, describeFailure, emailError } from '../auth/validate.ts';

  type Props = { email: string; actions: AccountActions };
  let { email, actions }: Props = $props();

  let step = $state<'idle' | 'email' | 'code'>('idle');
  let newEmail = $state('');
  let code = $state('');
  let errors = $state<{ email?: string | undefined; code?: string | undefined; form?: string | undefined }>({});
  let busy = $state(false);

  function start() {
    step = 'email';
    newEmail = '';
    code = '';
    errors = {};
  }

  async function request(event: SubmitEvent) {
    event.preventDefault();
    const target = newEmail.trim().toLowerCase();
    const invalid = emailError(target) ?? (target === email ? m.settings_email_same() : null);
    errors = invalid ? { email: invalid } : {};
    if (invalid) return;
    busy = true;
    const result = await actions.requestEmailChange(target);
    busy = false;
    if (!result.ok) {
      const failure = describeFailure(result);
      errors = failure.field === 'email' ? { email: failure.message } : { form: failure.message };
      return;
    }
    newEmail = target;
    step = 'code';
  }

  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    const invalid = codeError(code);
    errors = invalid ? { code: invalid } : {};
    if (invalid) return;
    busy = true;
    const result = await actions.changeEmail(newEmail, code);
    busy = false;
    if (!result.ok) {
      const failure = describeFailure(result);
      errors = failure.field === 'code' ? { code: failure.message } : { form: m.settings_email_change_failed() };
      return;
    }
    invalidateCache('me');
    await loadSession();
    step = 'idle';
    showToast({ message: m.settings_email_changed({ email: newEmail }), tone: 'success' });
  }
</script>

<section aria-labelledby="email-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <h2 id="email-heading" class="text-lg font-semibold">{m.auth_field_email()}</h2>
  <p class="mt-1 text-sm">{m.settings_email_current({ email })}</p>

  {#if step === 'idle'}
    <div class="mt-4"><Button onclick={start}>{m.settings_email_change()}</Button></div>
  {:else if step === 'email'}
    <form class="mt-4 flex flex-col gap-4" onsubmit={request} novalidate>
      <p class="text-sm text-ink-muted">{m.settings_email_lead()}</p>
      <Field label={m.settings_email_new()} error={errors.email}>
        {#snippet children(control)}
          <Input id={control.id} describedBy={control.describedBy} invalid={control.invalid} type="email" bind:value={newEmail} autocomplete="email" spellcheck="false" />
        {/snippet}
      </Field>
      <FormError message={errors.form ?? null} />
      <div class="flex gap-2">
        <Button type="submit" loading={busy}>{m.auth_submit_forgot()}</Button>
        <Button variant="ghost" onclick={() => (step = 'idle')}>{m.common_cancel()}</Button>
      </div>
    </form>
  {:else}
    <form class="mt-4 flex flex-col gap-4" onsubmit={confirm} novalidate>
      <p class="text-sm text-ink-muted">{m.settings_email_code_lead({ email: newEmail })}</p>
      <CodeField bind:value={code} error={errors.code} autofocus />
      <FormError message={errors.form ?? null} />
      <div class="flex gap-2">
        <Button type="submit" loading={busy}>{m.settings_email_confirm()}</Button>
        <Button variant="ghost" onclick={() => (step = 'email')}>{m.settings_email_back()}</Button>
      </div>
    </form>
  {/if}
</section>
