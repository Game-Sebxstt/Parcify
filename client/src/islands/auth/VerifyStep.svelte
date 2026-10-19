<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import CodeField from './CodeField.svelte';
  import type { StepContext } from './context.ts';
  import FormError from './FormError.svelte';
  import LinkButton from './LinkButton.svelte';
  import ResendCode from './ResendCode.svelte';
  import { codeError, describeFailure, type AuthField } from './validate.ts';

  type Props = { ctx: StepContext; email: string };

  let { ctx, email }: Props = $props();

  let code = $state('');
  let pending = $state(false);
  let notice = $state<string | null>(null);
  let errors = $state<Partial<Record<AuthField, string>>>({});

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const invalid = codeError(code);
    errors = invalid ? { code: invalid } : {};
    if (invalid) return;

    pending = true;
    const result = await ctx.actions.verifyEmail(email, code);
    if (result.ok) {
      ctx.finish(ctx.returnTo ?? '/app?bienvenida=1');
      return;
    }
    pending = false;
    const failure = describeFailure(result);
    errors = { [failure.field]: failure.message };
  }

  async function resend() {
    const result = await ctx.actions.sendVerificationOtp(email);
    if (result.ok) {
      notice = m.auth_resent();
      errors = {};
      code = '';
      return true;
    }
    errors = { form: describeFailure(result).message };
    return false;
  }
</script>

<form novalidate onsubmit={submit} class="flex flex-col gap-4">
  <p class="text-sm text-ink-muted">{m.auth_verify_lead({ email })}</p>

  <CodeField bind:value={code} error={errors.code} autofocus />

  <ResendCode onResend={resend} />
  <p role="status" class="text-sm text-sage empty:hidden">{notice ?? ''}</p>

  <FormError message={errors.form ?? null} />

  <Button type="submit" variant="primary" class="w-full" loading={pending}>{m.auth_submit_verify()}</Button>

  <p class="text-center text-sm">
    <LinkButton onclick={() => ctx.go('sign-in')}>{m.auth_back_to_sign_in()}</LinkButton>
  </p>
</form>
