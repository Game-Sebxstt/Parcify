<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import type { StepContext } from './context.ts';
  import FormError from './FormError.svelte';
  import GoogleButton from './GoogleButton.svelte';
  import LinkButton from './LinkButton.svelte';
  import { describeFailure, emailError, type AuthField } from './validate.ts';

  type Props = { ctx: StepContext; email: string; google: boolean; initialError?: string | null };

  let { ctx, email = $bindable(), google, initialError = null }: Props = $props();

  let password = $state('');
  let pending = $state(false);
  let errors = $state<Partial<Record<AuthField, string>>>({});

  $effect.pre(() => {
    if (initialError) errors = { form: initialError };
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const next: Partial<Record<AuthField, string>> = {};
    const invalidEmail = emailError(email);
    if (invalidEmail) next.email = invalidEmail;
    if (!password) next.password = m.auth_error_credentials();
    errors = next;
    if (Object.keys(next).length > 0) return;

    pending = true;
    const address = email.trim().toLowerCase();
    const result = await ctx.actions.signIn(address, password);
    if (result.ok) {
      ctx.finish(ctx.returnTo ?? '/app');
      return;
    }
    if (result.code === 'EMAIL_NOT_VERIFIED') {
      await ctx.actions.sendVerificationOtp(address);
      pending = false;
      ctx.go('verify', m.auth_unverified_notice());
      return;
    }
    pending = false;
    const failure = describeFailure(result);
    errors = { [failure.field]: failure.message };
  }
</script>

<form novalidate onsubmit={submit} class="flex flex-col gap-4">
  {#if google}
    <GoogleButton {ctx} onError={(message) => (errors = { form: message })} />
    <p class="text-center text-xs text-ink-muted">{m.auth_divider()}</p>
  {/if}

  <Field label={m.auth_field_email()} error={errors.email}>
    {#snippet children({ id, describedBy, invalid })}
      <Input {id} {describedBy} {invalid} bind:value={email} type="email" name="email" autocomplete="email" inputmode="email" data-autofocus />
    {/snippet}
  </Field>

  <Field label={m.auth_field_password()} error={errors.password}>
    {#snippet children({ id, describedBy, invalid })}
      <Input {id} {describedBy} {invalid} bind:value={password} type="password" name="password" autocomplete="current-password" />
    {/snippet}
  </Field>

  <div class="-mt-1 text-sm">
    <LinkButton onclick={() => ctx.go('forgot')}>{m.auth_forgot_link()}</LinkButton>
  </div>

  <FormError message={errors.form ?? null} />

  <Button type="submit" variant="primary" class="w-full" loading={pending}>
    {m.auth_submit_sign_in()}
  </Button>

  <p class="text-center text-sm text-ink-muted">
    {m.auth_no_account()}
    <LinkButton onclick={() => ctx.go('sign-up')}>{m.auth_to_sign_up()}</LinkButton>
  </p>
</form>
