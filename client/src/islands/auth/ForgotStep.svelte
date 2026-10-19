<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import type { StepContext } from './context.ts';
  import FormError from './FormError.svelte';
  import LinkButton from './LinkButton.svelte';
  import { describeFailure, emailError, type AuthField } from './validate.ts';

  type Props = { ctx: StepContext; email: string };

  let { ctx, email = $bindable() }: Props = $props();

  let pending = $state(false);
  let errors = $state<Partial<Record<AuthField, string>>>({});

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const invalid = emailError(email);
    errors = invalid ? { email: invalid } : {};
    if (invalid) return;

    pending = true;
    email = email.trim().toLowerCase();
    const result = await ctx.actions.requestPasswordReset(email);
    pending = false;
    // Solo la red o el límite de intentos frenan el paso: el resto no revela si la cuenta existe.
    if (!result.ok && (result.code === 'NETWORK' || result.status === 429)) {
      errors = { form: describeFailure(result).message };
      return;
    }
    ctx.go('reset');
  }
</script>

<form novalidate onsubmit={submit} class="flex flex-col gap-4">
  <p class="text-sm text-ink-muted">{m.auth_forgot_lead()}</p>

  <Field label={m.auth_field_email()} error={errors.email}>
    {#snippet children({ id, describedBy, invalid })}
      <Input {id} {describedBy} {invalid} bind:value={email} type="email" name="email" autocomplete="email" inputmode="email" data-autofocus />
    {/snippet}
  </Field>

  <FormError message={errors.form ?? null} />

  <Button type="submit" variant="primary" class="w-full" loading={pending}>{m.auth_submit_forgot()}</Button>

  <p class="text-center text-sm">
    <LinkButton onclick={() => ctx.go('sign-in')}>{m.auth_back_to_sign_in()}</LinkButton>
  </p>
</form>
