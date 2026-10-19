// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeReturnPath } from './api.ts';
import { forgetInviteToken, inviteReturnPath, inviteSignInPath, readInviteTarget, rememberInviteToken } from './invite-link.ts';

const TOKEN = 'q3Jx-Lw_9fZ0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('readInviteTarget', () => {
  it('lee el token del fragmento y lo borra de la URL con replaceState', () => {
    window.history.replaceState(null, '', `/invitacion#t=${TOKEN}`);
    const replace = vi.spyOn(window.history, 'replaceState');

    expect(readInviteTarget()).toEqual({ kind: 'link', token: TOKEN });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');
    expect(`${window.location.pathname}${window.location.search}`).toBe('/invitacion');
  });

  it('conserva la query y el resto del fragmento', () => {
    window.history.replaceState(null, '', `/invitacion?x=1#t=${TOKEN}&otro=2`);
    expect(readInviteTarget()).toEqual({ kind: 'link', token: TOKEN });
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#otro=2');
  });

  it('borra también un token mal formado y no lo devuelve', () => {
    window.history.replaceState(null, '', '/invitacion#t=%3Cscript%3E');
    expect(readInviteTarget()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('no escribe el token en ningún sitio por su cuenta', () => {
    window.history.replaceState(null, '', `/invitacion#t=${TOKEN}`);
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    readInviteTarget();
    expect(window.sessionStorage.length).toBe(0);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('lee la invitación al espacio de ?espacio=', () => {
    window.history.replaceState(null, '', '/invitacion?espacio=inv_123-abc');
    expect(readInviteTarget()).toEqual({ kind: 'workspace', invitationId: 'inv_123-abc' });
  });

  it.each([['//evil.example'], ['https://evil.example'], ['../../v1/me'], ['a b'], ['']])('rechaza ?espacio=%s', (value) => {
    window.history.replaceState(null, '', `/invitacion?${new URLSearchParams({ espacio: value })}`);
    expect(readInviteTarget()).toBeNull();
  });

  it('recupera el token guardado al volver del acceso y lo olvida después', () => {
    rememberInviteToken(TOKEN);
    window.history.replaceState(null, '', '/invitacion');
    expect(readInviteTarget()).toEqual({ kind: 'link', token: TOKEN });
    forgetInviteToken();
    expect(readInviteTarget()).toBeNull();
  });

  it('descarta y borra el token guardado cuando pasan 30 minutos', () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    rememberInviteToken(TOKEN);
    window.history.replaceState(null, '', '/invitacion');
    clock.mockReturnValue(now + 29 * 60 * 1000);
    expect(readInviteTarget()).toEqual({ kind: 'link', token: TOKEN });
    clock.mockReturnValue(now + 31 * 60 * 1000);
    expect(readInviteTarget()).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([[TOKEN], ['{"token":"<x>","at":0}'], ['no es json']])('descarta un valor guardado sin fecha o mal formado: %s', (raw) => {
    window.sessionStorage.setItem('parcify:invitacion', raw);
    window.history.replaceState(null, '', '/invitacion');
    expect(readInviteTarget()).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('el fragmento manda sobre un token guardado antes', () => {
    rememberInviteToken('viejo');
    window.history.replaceState(null, '', `/invitacion#t=${TOKEN}`);
    expect(readInviteTarget()).toEqual({ kind: 'link', token: TOKEN });
  });

  it('sin token ni espacio no hay invitación', () => {
    window.history.replaceState(null, '', '/invitacion');
    expect(readInviteTarget()).toBeNull();
  });
});

describe('volver', () => {
  it('el enlace de proyecto vuelve a /invitacion sin el token', () => {
    const target = { kind: 'link', token: TOKEN } as const;
    expect(inviteReturnPath(target)).toBe('/invitacion');
    expect(inviteSignInPath(target)).not.toContain(TOKEN);
    expect(inviteSignInPath(target)).toBe('/invitacion?acceso=entrar&volver=%2Finvitacion');
  });

  it('la invitación al espacio vuelve a su propia página y es una ruta interna', () => {
    const target = { kind: 'workspace', invitationId: 'inv_1' } as const;
    const path = inviteSignInPath(target, 'crear');
    const params = new URL(path, 'https://parcify.invalid').searchParams;
    expect(params.get('espacio')).toBe('inv_1');
    expect(params.get('acceso')).toBe('crear');
    expect(safeReturnPath(params.get('volver'))).toBe('/invitacion?espacio=inv_1');
  });
});
