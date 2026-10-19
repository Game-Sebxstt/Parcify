// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthActions, AuthResult } from '../lib/auth.ts';
import AuthOverlay from './AuthOverlay.svelte';

const ok: AuthResult = { ok: true };
const fail = (code: string, status: number): AuthResult => ({ ok: false, code, status });

function makeActions(overrides: Partial<Record<keyof AuthActions, AuthResult>> = {}) {
  const action = (name: keyof AuthActions) => vi.fn(async () => overrides[name] ?? ok);
  return {
    signIn: action('signIn'),
    signInWithGoogle: action('signInWithGoogle'),
    signUp: action('signUp'),
    verifyEmail: action('verifyEmail'),
    sendVerificationOtp: action('sendVerificationOtp'),
    requestPasswordReset: action('requestPasswordReset'),
    resetPassword: action('resetPassword'),
    signOut: action('signOut'),
  } satisfies AuthActions;
}

function setup(options: { url?: string; actions?: ReturnType<typeof makeActions>; providers?: Array<'email' | 'google'> } = {}) {
  window.history.replaceState(null, '', options.url ?? '/?acceso=entrar');
  const actions = options.actions ?? makeActions();
  const navigate = vi.fn();
  render(AuthOverlay, { props: { actions, navigate, providers: options.providers ?? ['email', 'google'] } });
  return { actions, navigate };
}

async function fill(label: string | RegExp, value: string) {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

async function submit(name: string | RegExp) {
  await fireEvent.click(screen.getByRole('button', { name }));
}

const dialog = () => screen.getByRole('dialog');

function describedBy(input: HTMLElement) {
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthOverlay: apertura y cierre', () => {
  it('?acceso=entrar abre el paso Entrar con el foco en el email', async () => {
    setup();
    await waitFor(() => expect(dialog().getAttribute('aria-labelledby')).toBe('auth-title'));
    expect(screen.getByRole('heading', { name: 'Entrar en Parcify' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Email')));
  });

  it('?acceso=crear abre Crear cuenta', async () => {
    setup({ url: '/?acceso=crear' });
    expect(await screen.findByRole('heading', { name: 'Crear tu cuenta' })).toBeTruthy();
  });

  it('sin parámetros no se abre hasta pulsar un enlace data-auth-open, y al cerrar devuelve el foco', async () => {
    const link = document.createElement('a');
    link.href = '/?acceso=crear';
    link.dataset.authOpen = 'crear';
    link.textContent = 'Crear cuenta';
    document.body.append(link);
    setup({ url: '/' });
    expect(screen.queryByRole('dialog')).toBeNull();

    link.focus();
    await fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Crear tu cuenta' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it('al cerrar quita acceso, volver y error de la URL', async () => {
    setup({ url: '/?acceso=entrar&volver=%2Fapp&error=google&otro=1' });
    await screen.findByRole('heading', { name: 'Entrar en Parcify' });
    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(window.location.search).toBe('?otro=1');
  });

  it('error=google abre Entrar con el aviso de Google', async () => {
    setup({ url: '/?error=google' });
    expect(await screen.findByText(/No se pudo entrar con Google/)).toBeTruthy();
  });
});

describe('AuthOverlay: Entrar', () => {
  it('con sesión va a /app', async () => {
    const { actions, navigate } = setup();
    await fill('Email', 'Ana@Ejemplo.com ');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Entrar');
    expect(actions.signIn).toHaveBeenCalledWith('ana@ejemplo.com', 'una-clave-larga');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
  });

  it('respeta un «volver» interno', async () => {
    const { navigate } = setup({ url: '/?acceso=entrar&volver=%2Fp%2Fabc' });
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Entrar');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/p/abc'));
  });

  it.each([['//evil.example'], ['/.//evil.example']])('ignora un «volver» externo %j', async (volver) => {
    const { navigate } = setup({ url: `/?acceso=entrar&volver=${encodeURIComponent(volver)}` });
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Entrar');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
  });

  it('valida el email junto al campo sin llamar a la API', async () => {
    const { actions } = setup();
    await fill('Email', 'no-es-un-email');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Entrar');
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(email)).toMatch(/Escribe un email válido/);
    expect(actions.signIn).not.toHaveBeenCalled();
  });

  it('credenciales incorrectas: mensaje junto a la contraseña que no dice si el email existe', async () => {
    setup({ actions: makeActions({ signIn: fail('INVALID_EMAIL_OR_PASSWORD', 401) }) });
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Entrar');
    const password = screen.getByLabelText('Contraseña');
    await waitFor(() => expect(describedBy(password)).toBe('El email o la contraseña no son correctos.'));
    expect(password.getAttribute('aria-invalid')).toBe('true');
    const region = document.getElementById(password.getAttribute('aria-describedby')!.split(' ').at(-1)!);
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });

  it('EMAIL_NOT_VERIFIED reenvía el código y pasa a Verificar', async () => {
    const actions = makeActions({ signIn: fail('EMAIL_NOT_VERIFIED', 403) });
    setup({ actions });
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Entrar');
    expect(await screen.findByRole('heading', { name: 'Verifica tu email' })).toBeTruthy();
    expect(actions.sendVerificationOtp).toHaveBeenCalledWith('ana@ejemplo.com');
    expect(screen.getByText(/Tu email aún no está verificado/)).toBeTruthy();
  });

  it('el límite de intentos se explica sin revelar nada de la cuenta', async () => {
    setup({ actions: makeActions({ signIn: fail('UNKNOWN', 429) }) });
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Entrar');
    expect(await screen.findByText('Demasiados intentos. Espera un minuto y vuelve a probar.')).toBeTruthy();
  });
});

describe('AuthOverlay: Google', () => {
  it('el botón inicia el flujo con vuelta a /app y error a /?acceso=entrar&error=google', async () => {
    const { actions } = setup();
    await submit('Continuar con Google');
    const origin = window.location.origin;
    expect(actions.signInWithGoogle).toHaveBeenCalledWith(`${origin}/app`, `${origin}/?acceso=entrar&error=google`);
  });

  it('no aparece si el servidor no tiene Google configurado', async () => {
    setup({ providers: ['email'] });
    await screen.findByRole('heading', { name: 'Entrar en Parcify' });
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).toBeNull();
  });
});

describe('AuthOverlay: Crear cuenta y Verificar', () => {
  it('registro → Verificar → código pegado con espacios → /app con bienvenida', async () => {
    const { actions, navigate } = setup({ url: '/?acceso=crear' });
    await fill('Nombre', 'Ana');
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Crear cuenta');
    expect(actions.signUp).toHaveBeenCalledWith('Ana', 'ana@ejemplo.com', 'una-clave-larga');

    expect(await screen.findByRole('heading', { name: 'Verifica tu email' })).toBeTruthy();
    expect(screen.getByText(/ana@ejemplo.com/)).toBeTruthy();
    const code = screen.getByLabelText('Código de verificación');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    await waitFor(() => expect(document.activeElement).toBe(code));

    await fill('Código de verificación', '123 456');
    await tick();
    expect((code as HTMLInputElement).value).toBe('123456');
    await submit('Verificar email');
    expect(actions.verifyEmail).toHaveBeenCalledWith('ana@ejemplo.com', '123456');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app?bienvenida=1'));
  });

  it('la contraseña corta se marca junto al campo', async () => {
    const { actions } = setup({ url: '/?acceso=crear' });
    await fill('Nombre', 'Ana');
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'corta');
    await submit('Crear cuenta');
    expect(describedBy(screen.getByLabelText('Contraseña'))).toMatch(/al menos 10 caracteres/);
    expect(actions.signUp).not.toHaveBeenCalled();
  });

  it('un código incorrecto se explica junto al campo', async () => {
    setup({ url: '/?acceso=crear', actions: makeActions({ verifyEmail: fail('INVALID_OTP', 400) }) });
    await fill('Nombre', 'Ana');
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Crear cuenta');
    await screen.findByRole('heading', { name: 'Verifica tu email' });
    await fill('Código de verificación', '000000');
    await submit('Verificar email');
    await waitFor(() =>
      expect(describedBy(screen.getByLabelText('Código de verificación'))).toMatch(/no es válido o ha caducado/),
    );
  });

  it('«Reenviar código» espera 60 s y después reenvía', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { actions } = setup({ url: '/?acceso=crear' });
    await fill('Nombre', 'Ana');
    await fill('Email', 'ana@ejemplo.com');
    await fill('Contraseña', 'una-clave-larga');
    await submit('Crear cuenta');
    await screen.findByRole('heading', { name: 'Verifica tu email' });
    expect(screen.getByText('Reenviar código en 60 s')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reenviar código' })).toBeNull();

    vi.advanceTimersByTime(60_000);
    await tick();
    await submit('Reenviar código');
    expect(actions.sendVerificationOtp).toHaveBeenCalledWith('ana@ejemplo.com');
    expect(await screen.findByText('Te enviamos un código nuevo.')).toBeTruthy();
    expect(screen.getByText('Reenviar código en 60 s')).toBeTruthy();
  });
});

describe('AuthOverlay: recuperar la contraseña', () => {
  it('Olvidé mi contraseña → Nueva contraseña → Entrar con aviso', async () => {
    const { actions } = setup();
    await submit('¿Olvidaste tu contraseña?');
    expect(await screen.findByRole('heading', { name: 'Recuperar la contraseña' })).toBeTruthy();
    await fill('Email', 'ana@ejemplo.com');
    await submit('Enviar código');
    expect(actions.requestPasswordReset).toHaveBeenCalledWith('ana@ejemplo.com');

    expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeTruthy();
    expect(screen.getByText(/Si existe una cuenta con ana@ejemplo.com/)).toBeTruthy();
    await fill('Código de verificación', '654321');
    await fill('Contraseña nueva', 'otra-clave-larga');
    await submit('Cambiar contraseña');
    expect(actions.resetPassword).toHaveBeenCalledWith('ana@ejemplo.com', '654321', 'otra-clave-larga');

    expect(await screen.findByRole('heading', { name: 'Entrar en Parcify' })).toBeTruthy();
    expect(screen.getByText('Contraseña cambiada. Entra con la nueva.').getAttribute('role')).toBe('status');
  });

  it('pasa a Nueva contraseña aunque el servidor responda error, para no revelar si la cuenta existe', async () => {
    setup({ url: '/?acceso=entrar', actions: makeActions({ requestPasswordReset: fail('UNKNOWN', 400) }) });
    await submit('¿Olvidaste tu contraseña?');
    await fill('Email', 'nadie@ejemplo.com');
    await submit('Enviar código');
    expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeTruthy();
  });
});
