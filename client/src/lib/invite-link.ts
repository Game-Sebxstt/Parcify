// Qué abre /invitacion: un enlace de proyecto (#t=<token>) o una invitación al espacio (?espacio=<id>).
export type InviteTarget = { kind: 'link'; token: string } | { kind: 'workspace'; invitationId: string };

type InviteWindow = {
  location: { href: string };
  history: Pick<History, 'replaceState' | 'state'>;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
};

// El token solo se guarda en esta pestaña mientras la persona entra o crea su cuenta.
const TOKEN_KEY = 'parcify:invitacion';
// Si se cierra el acceso sin entrar, el token guardado deja de valer pasado este tiempo.
const TOKEN_TTL_MS = 30 * 60 * 1000;
// Solo descarta lo que no puede ser un token; quien lo valida es el servidor.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{1,256}$/;
const INVITATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

function storage(win: InviteWindow) {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

// Lee el destino y borra el token de la barra de direcciones antes de devolverlo.
export function readInviteTarget(win: InviteWindow = window): InviteTarget | null {
  const url = new URL(win.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has('t')) {
    const token = fragment.get('t') ?? '';
    fragment.delete('t');
    const rest = fragment.toString();
    win.history.replaceState(win.history.state, '', `${url.pathname}${url.search}${rest ? `#${rest}` : ''}`);
    if (TOKEN_SHAPE.test(token)) return { kind: 'link', token };
    return null;
  }

  const invitationId = url.searchParams.get('espacio');
  if (invitationId !== null) return INVITATION_ID.test(invitationId) ? { kind: 'workspace', invitationId } : null;

  const token = savedToken(win);
  return token ? { kind: 'link', token } : null;
}

function savedToken(win: InviteWindow): string | null {
  try {
    const raw = storage(win)?.getItem(TOKEN_KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved === 'object' && saved !== null && 'token' in saved && 'at' in saved) {
      const { token, at } = saved;
      const age = Date.now() - Number(at);
      if (typeof token === 'string' && TOKEN_SHAPE.test(token) && age >= 0 && age <= TOKEN_TTL_MS) return token;
    }
    storage(win)?.removeItem(TOKEN_KEY);
    return null;
  } catch {
    forgetInviteToken(win);
    return null;
  }
}

export function rememberInviteToken(token: string, win: InviteWindow = window) {
  try {
    storage(win)?.setItem(TOKEN_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {
    // Sin sessionStorage, al volver del acceso hará falta abrir el enlace otra vez.
  }
}

export function forgetInviteToken(win: InviteWindow = window) {
  try {
    storage(win)?.removeItem(TOKEN_KEY);
  } catch {
    // Nada que borrar.
  }
}

// Ruta a la que vuelve el overlay de acceso; nunca lleva el token.
export function inviteReturnPath(target: InviteTarget): string {
  if (target.kind === 'workspace') return `/invitacion?${new URLSearchParams({ espacio: target.invitationId })}`;
  return '/invitacion';
}

// /invitacion con el overlay abierto en «Entrar» (o «Crear cuenta») y «volver» a la misma invitación.
export function inviteSignInPath(target: InviteTarget, step: 'entrar' | 'crear' = 'entrar'): string {
  const params = new URLSearchParams();
  if (target.kind === 'workspace') params.set('espacio', target.invitationId);
  params.set('acceso', step);
  params.set('volver', inviteReturnPath(target));
  return `/invitacion?${params}`;
}
