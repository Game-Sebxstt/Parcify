<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import CodeField from './CodeField.svelte';
  import type { StepContext } from './context.ts';
  import FormError from './FormError.svelte';
  import LinkButton from './LinkButton.svelte';
  import ResendCode from './ResendCode.svelte';
  import { codeError, describeFailure, passwordError, type AuthField } from './validate.ts';

  type Props = { ctx: StepContext; email: string };

  let { ctx, email }: Props = $props();

  let code = $state('');
  let password = $state('');
  let pending = $state(false);
  let errors = $state<Partial<Record<AuthField, string>>>({});

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const next: Partial<Record<AuthField, string>> = {};
    const invalidCode = codeError(code);
    const invalidPassword = passwordError(password);
    if (invalidCode) next.code = invalidCode;
    if (invalidPassword) next.password = invalidPassword;
    errors = next;
    if (Object.keys(next).length > 0) return;

    pending = true;
    const result = await ctx.actions.resetPassword(email, code, password);
    pending = false;
    if (result.ok) {
      ctx.go('sign-in', m.auth_password_changed());
      return;
    }
    const failure = describeFailure(result);
    errors = { [failure.field]: failure.message };
  }

  async function resend() {
    const result = await ctx.actions.requestPasswordReset(email);
    if (result.ok || (result.code !== 'NETWORK' && result.status !== 429)) {
      errors = {};
      code = '';
      return true;
    }
    errors = { form: describeFailure(result).message };
    return false;
  }
</script>

<form novalidate onsubmit={submit} class="flex flex-col gap-4">
  <p class="text-sm text-ink-muted">{m.auth_reset_lead({ email })}</p>

  <CodeField bind:value={code} error={errors.code} autofocus />
  <ResendCode onResend={resend} />

  <Field label={m.auth_field_new_password()} hint={m.auth_password_hint()} error={errors.password}>
    {#snippet children({ id, describedBy, invalid })}
      <Input {id} {describedBy} {invalid} bind:value={password} type="password" name="new-password" autocomplete="new-password" />
    {/snippet}
  </Field>

  <FormError message={errors.form ?? null} />

  <Button type="submit" variant="primary" class="w-full" loading={pending}>{m.auth_submit_reset()}</Button>

  <p class="text-center text-sm">
    <LinkButton onclick={() => ctx.go('sign-in')}>{m.auth_back_to_sign_in()}</LinkButton>
  </p>
</form>
