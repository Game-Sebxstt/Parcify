import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkBackend, type BackendCallbacks, type DocumentBackend } from '../engine/doc/backend.ts';
import type { CollabToMain, MainToCollab, OpenParams } from '../engine/doc/protocol.ts';
import { CollabSession, epochDecision, failureFromClose, failureFromReason, openCollabLink, WORKER_BOOT_TIMEOUT_MS, type CollabLink, type CollabToken } from './collab.ts';
import { localCopyName, parseLocalCopyName } from './local-copies.ts';

class FakeLink implements CollabLink {
  readonly sent: MainToCollab[] = [];
  readonly starts: Array<{ kind: 'open' | 'reset'; params: OpenParams; backend: LinkBackend }> = [];
  private handler: (message: CollabToMain) => void = () => {};
  crash: (message: string) => void = () => {};

  start(kind: 'open' | 'reset', params: OpenParams, callbacks: BackendCallbacks): Promise<DocumentBackend> {
    const backend = new LinkBackend(params.gen, () => {}, callbacks);
    this.starts.push({ kind, params, backend });
    return Promise.resolve(backend);
  }

  send(message: MainToCollab): void {
    this.sent.push(structuredClone(message));
  }

  onMessage(handler: (message: CollabToMain) => void): void {
    this.handler = handler;
  }

  onCrash(handler: (message: string) => void): void {
    this.crash = handler;
  }

  emit(message: CollabToMain): void {
    this.handler(structuredClone(message));
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

const token = (overrides: Partial<CollabToken> = {}): CollabToken => ({
  token: 'jwt',
  url: 'ws://localhost:3001/',
  documentName: 'project:p1',
  role: 'editor',
  user: { id: 'u1', name: 'Ana', color: '#FB8F5A' },
  epoch: 1,
  ...overrides,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CollabSession con el host del documento', () => {
  afterEach(() => vi.restoreAllMocks());

  async function open(tokens: Array<CollabToken | Error>) {
    const link = new FakeLink();
    const queue = [...tokens];
    const fetchToken = vi.fn(async () => {
      const next = queue.shift();
      if (!next || next instanceof Error) throw next ?? new Error('sin token');
      return next;
    });
    const session = await CollabSession.open('p1', { link: async () => link, fetchToken });
    return { session, link, fetchToken };
  }

  it('abre la generación 1 con la url del esquema y responde siempre a las peticiones de token', async () => {
    const { session, link } = await open([token(), token({ token: 'otro' }), new Error('red'), token({ epoch: 2 })]);
    expect(link.starts[0]!.kind).toBe('open');
    expect(link.starts[0]!.params).toMatchObject({ gen: 1, url: 'ws://localhost:3001/?schemaVersion=1', documentName: 'project:p1', epoch: 1 });
    link.emit({ t: 'token-request', id: 1 });
    link.emit({ t: 'token-request', id: 2 });
    await settle();
    link.emit({ t: 'token-request', id: 3 });
    await settle();
    link.emit({ t: 'token-request', id: 4 });
    await settle();
    const answers = link.sent.filter((message) => message.t === 'token');
    expect(answers).toEqual([
      { t: 'token', id: 1, token: 'jwt' },
      { t: 'token', id: 2, token: 'otro' },
      { t: 'token', id: 3, error: 'fetch_failed' },
      { t: 'token', id: 4, error: 'epoch_changed' },
    ]);
    session.destroy();
  });

  it('epoch_changed reinicia con gen + 1 y un backend nuevo', async () => {
    const { session, link } = await open([token(), token({ epoch: 2 })]);
    const first = session.backend;
    const resets: DocumentBackend[] = [];
    session.on('reset', (backend) => resets.push(backend));
    link.emit({ t: 'auth-failed', reason: 'Failed to get token during sendToken(): Error: epoch_changed' });
    await settle();
    expect(link.starts[1]).toMatchObject({ kind: 'reset', params: { gen: 2, epoch: 2 } });
    expect(resets).toEqual([session.backend]);
    expect(session.backend).not.toBe(first);
    await expect(first.ready).rejects.toThrow();
    session.destroy();
  });

  it('synced, la copia local y la autenticación llegan al estado', async () => {
    const { session, link } = await open([token()]);
    link.emit({ t: 'local-copy', gen: 1, enabled: true, lostUnsynced: true });
    link.emit({ t: 'authenticated', scope: 'read-write', unsynced: 0 });
    session.backend.synced(true);
    expect(session.state.get()).toMatchObject({ localCopy: true, notice: 'local_copy_discarded', status: 'connected', synced: true });
    link.emit({ t: 'local-copy', gen: 7, enabled: false, lostUnsynced: false });
    expect(session.state.get().localCopy).toBe(true);
    session.destroy();
  });

  it('quien editaba y pasa a lector con cambios sin enviar recibe offline_changes_rejected', async () => {
    const { session, link } = await open([token(), token({ role: 'viewer' })]);
    link.emit({ t: 'token-request', id: 1 });
    await settle();
    link.emit({ t: 'authenticated', scope: 'readonly', unsynced: 2 });
    expect(session.state.get()).toMatchObject({ readOnly: true, notice: 'offline_changes_rejected' });
    session.destroy();
  });

  it('un fallo del host corta la edición con engine_crashed', async () => {
    const { session, link } = await open([token()]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    link.crash('se colgó');
    expect(session.state.get().failure).toBe('engine_crashed');
    expect(link.sent.at(-1)).toEqual({ t: 'stop' });
    session.destroy();
  });

  it('sin respuesta del worker en 10 s el documento se abre en el hilo principal', async () => {
    vi.useFakeTimers();
    const terminated: string[] = [];
    class SilentWorker {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate() {
        terminated.push('ok');
      }
    }
    vi.stubGlobal('Worker', SilentWorker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pending = openCollabLink();
      await vi.advanceTimersByTimeAsync(WORKER_BOOT_TIMEOUT_MS + 10);
      const link = await pending;
      expect(terminated).toEqual(['ok']);
      expect(warn.mock.calls[0]?.[0]).toContain('sin worker');
      await link.destroy();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('colaboración', () => {


  it('recrea el documento solo cuando cambia el epoch, y ofrece la copia si había cambios sin enviar', () => {
    expect(epochDecision(3, 3, true)).toBe('keep');
    expect(epochDecision(3, 4, false)).toBe('recreate');
    expect(epochDecision(3, 4, true)).toBe('recreate-offer-download');
    expect(epochDecision(4, 3, false)).toBe('recreate');
  });

  it('traduce los rechazos del servidor', () => {
    expect(failureFromReason('no_access')).toBe('no_access');
    expect(failureFromReason('client_outdated')).toBe('client_outdated');
    expect(failureFromReason('document_full')).toBe('document_full');
    expect(failureFromReason('too_many_tabs')).toBe('too_many_tabs');
    expect(failureFromReason('session_revoked')).toBe('session_revoked');
    expect(failureFromReason('compacting')).toBeNull();
    expect(failureFromReason('epoch_changed')).toBeNull();
  });

  it('4410 lleva a la papelera; 4401 y 4409 reconectan', () => {
    expect(failureFromClose(4410, 'project_deleted')).toBe('project_deleted');
    expect(failureFromClose(4410, 'workspace_deleted')).toBe('workspace_deleted');
    expect(failureFromClose(4401, 'access_changed')).toBeNull();
    expect(failureFromClose(4409, 'epoch_changed')).toBeNull();
  });

  it('las bases locales llevan usuario, proyecto y epoch', () => {
    const name = localCopyName('u1', '0190a1b2-0000-7000-8000-000000000000', 3);
    expect(name).toBe('parcify:u1:0190a1b2-0000-7000-8000-000000000000:3');
    expect(parseLocalCopyName(name)).toEqual({ userId: 'u1', projectId: '0190a1b2-0000-7000-8000-000000000000', epoch: 3 });
    expect(parseLocalCopyName('otra-base')).toBeNull();
  });
});
