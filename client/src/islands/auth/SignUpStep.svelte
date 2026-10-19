<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import type { StepContext } from './context.ts';
  import FormError from './FormError.svelte';
  import GoogleButton from './GoogleButton.svelte';
  import LinkButton from './LinkButton.svelte';
  import { describeFailure, emailError, nameError, passwordError, type AuthField } from './validate.ts';

  type Props = { ctx: StepContext; email: string; google: boolean };

  let { ctx, email = $bindable(), google }: Props = $props();

  let name = $state('');
  let password = $state('');
  let pending = $state(false);
  let errors = $state<Partial<Record<AuthField, string>>>({});

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const next: Partial<Record<AuthField, string>> = {};
    const checks: Array<[AuthField, string | null]> = [
      ['name', nameError(name)],
      ['email', emailError(email)],
      ['password', passwordError(password)],
    ];
    for (const [field, message] of checks) if (message) next[field] = message;
    errors = next;
    if (Object.keys(next).length > 0) return;

    pending = true;
    email = email.trim().toLowerCase();
    const result = await ctx.actions.signUp(name.trim(), email, password);
    pending = false;
    if (result.ok) {
      ctx.go('verify');
      return;
    }
    const failure = describeFailure(result);
    // Un 422 de registro no dice si el email ya existe: se responde igual en cualquier caso.
    errors = failure.field === 'form' && result.status === 422 ? { form: m.auth_error_sign_up() } : { [failure.field]: failure.message };
  }
</script>

<form novalidate onsubmit={submit} class="flex flex-col gap-4">
  {#if google}
    <GoogleButton {ctx} onError={(message) => (errors = { form: message })} />
    <p class="text-center text-xs text-ink-muted">{m.auth_divider()}</p>
  {/if}

  <Field label={m.auth_field_name()} error={errors.name}>
    {#snippet children({ id, describedBy, invalid })}
      <Input {id} {describedBy} {invalid} bind:value={name} name="name" autocomplete="name" data-autofocus />
    {/snippet}
  </Field>

  <Field label={m.auth_field_email()} error={errors.email}>
    {#snippet children({ id, describedBy, invalid })}
      <Input {id} {describedBy} {invalid} bind:value={email} type="email" name="email" autocomplete="email" inputmode="email" />
    {/snippet}
  </Field>

  <Field label={m.auth_field_password()} hint={m.auth_password_hint()} error={errors.password}>
    {#snippet children({ id, describedBy, invalid })}
      <Input {id} {describedBy} {invalid} bind:value={password} type="password" name="password" autocomplete="new-password" />
    {/snippet}
  </Field>

  <FormError message={errors.form ?? null} />

  <Button type="submit" variant="primary" class="w-full" loading={pending}>{m.auth_submit_sign_up()}</Button>

  <p class="text-center text-sm text-ink-muted">
    {m.auth_have_account()}
    <LinkButton onclick={() => ctx.go('sign-in')}>{m.auth_to_sign_in()}</LinkButton>
  </p>
</form>
