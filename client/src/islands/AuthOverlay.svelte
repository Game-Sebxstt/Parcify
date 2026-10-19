<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import { onMount, tick } from 'svelte';
  import { m } from '../paraglide/messages.js';
  import { MetaResponseSchema, type MetaResponse } from '../shared/api/meta.js';
  import { apiFetch, cached, safeReturnPath } from '../lib/api.ts';
  import { authActions, type AuthActions } from '../lib/auth.ts';
  import type { AuthStep, StepContext } from './auth/context.ts';
  import ForgotStep from './auth/ForgotStep.svelte';
  import ResetStep from './auth/ResetStep.svelte';
  import SignInStep from './auth/SignInStep.svelte';
  import SignUpStep from './auth/SignUpStep.svelte';
  import VerifyStep from './auth/VerifyStep.svelte';

  type Props = {
    actions?: AuthActions;
    // Sin valor, se leen de GET /v1/meta.
    providers?: MetaResponse['authProviders'];
    navigate?: (target: string) => void;
  };

  let {
    actions = authActions,
    providers,
    navigate = (target: string) => window.location.assign(target),
  }: Props = $props();

  const OPEN_PARAMS: Record<string, AuthStep> = { entrar: 'sign-in', crear: 'sign-up' };
  const URL_KEYS = ['acceso', 'volver', 'error', 'email'];

  const TITLES: Record<AuthStep, () => string> = {
    'sign-in': m.auth_sign_in_title,
    'sign-up': m.auth_sign_up_title,
    verify: m.auth_verify_title,
    forgot: m.auth_forgot_title,
    reset: m.auth_reset_title,
  };

  let dialog = $state<HTMLDialogElement | null>(null);
  let step = $state<AuthStep>('sign-in');
  let email = $state('');
  let notice = $state<string | null>(null);
  let googleError = $state<string | null>(null);
  let returnTo = $state<string | null>(null);
  let loadedProviders = $state<MetaResponse['authProviders']>(['email']);
  let opener: HTMLElement | null = null;

  const google = $derived((providers ?? loadedProviders).includes('google'));

  const ctx: StepContext = {
    get actions() {
      return actions;
    },
    get returnTo() {
      return returnTo;
    },
    go: (next, message = null) => {
      googleError = null;
      notice = message;
      step = next;
      void focusFirstField();
    },
    finish: (target) => navigate(target),
  };

  async function focusFirstField() {
    await tick();
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  export function open(next: AuthStep = 'sign-in', from: HTMLElement | null = null) {
    opener = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    step = next;
    notice = null;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    void focusFirstField();
  }

  function close() {
    dialog?.close();
  }

  function handleClosed() {
    googleError = null;
    notice = null;
    const url = new URL(window.location.href);
    if (URL_KEYS.some((key) => url.searchParams.has(key))) {
      for (const key of URL_KEYS) url.searchParams.delete(key);
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    if (opener?.isConnected) opener.focus();
    opener = null;
  }

  // Los enlaces «Entrar» y «Crear cuenta» de la página funcionan sin JS (?acceso=…); con JS abren el overlay.
  function handleDocumentClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const trigger = (event.target as Element | null)?.closest<HTMLElement>('[data-auth-open]');
    if (!trigger) return;
    const next = OPEN_PARAMS[trigger.dataset.authOpen ?? ''];
    if (!next) return;
    event.preventDefault();
    open(next, trigger);
  }

  onMount(() => {
    document.addEventListener('click', handleDocumentClick);

    if (!providers) {
      cached('meta', () => apiFetch('/v1/meta', { schema: MetaResponseSchema, redirectOn401: false }))
        .then((meta) => (loadedProviders = meta.authProviders))
        .catch(() => undefined);
    }

    const params = new URLSearchParams(window.location.search);
    returnTo = safeReturnPath(params.get('volver'));
    // El formulario del cierre de la landing llega con el email ya escrito.
    const prefill = params.get('email')?.trim();
    if (prefill) email = prefill.slice(0, 254);
    const fromUrl = OPEN_PARAMS[params.get('acceso') ?? ''];
    if (params.get('error') === 'google') googleError = m.auth_error_google();
    if (fromUrl || googleError) open(fromUrl ?? 'sign-in', null);

    return () => document.removeEventListener('click', handleDocumentClick);
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="auth-title"
  onclose={handleClosed}
  class="m-auto max-h-[calc(100dvh-1.5rem)] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-panel bg-surface-1 p-0 text-ink shadow-float"
>
  <div class="flex flex-col gap-5 p-6 sm:p-8">
    <div class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-4">
        <img src="/brand/Logo-no-background-no-text.png" alt="" width="40" height="40" class="size-10" />
        <h2 id="auth-title" class="text-xl font-bold tracking-[-0.02em]">{TITLES[step]()}</h2>
      </div>
      <button
        type="button"
        onclick={close}
        aria-label={m.common_close()}
        class="-mt-2 -mr-3 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <XIcon size={18} aria-hidden="true" />
      </button>
    </div>

    <p role="status" class="rounded-panel bg-petrol px-3.5 py-2.5 text-sm text-ink empty:hidden">{notice ?? ''}</p>

    {#key step}
      {#if step === 'sign-in'}
        <SignInStep {ctx} bind:email {google} initialError={googleError} />
      {:else if step === 'sign-up'}
        <SignUpStep {ctx} bind:email {google} />
      {:else if step === 'verify'}
        <VerifyStep {ctx} {email} />
      {:else if step === 'forgot'}
        <ForgotStep {ctx} bind:email />
      {:else}
        <ResetStep {ctx} {email} />
      {/if}
    {/key}
  </div>
</dialog>
