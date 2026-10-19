// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageDto } from '../shared/api/chat.js';
import {
  filterMembers,
  lastRead,
  markRead,
  mentionQuery,
  mentionsInBody,
  mergeMessages,
  parseChatEvent,
  renderBody,
  tokenize,
  typingSignal,
  unreadCount,
  type ChatEntry,
} from './chat.ts';

const PROJECT = '0190a000-0000-7000-8000-000000000001';

function message(id: string, overrides: Partial<ChatMessageDto> = {}): ChatEntry {
  return {
    id,
    projectId: PROJECT,
    author: { id: 'otra', name: 'Bea', avatarAssetId: null },
    body: 'hola',
    replyTo: null,
    attachments: [],
    mentions: [],
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-10-17T10:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('cuerpo del mensaje', () => {
  it('detecta enlaces http(s) y deja fuera la puntuación final', () => {
    expect(tokenize('mira https://parcify.app/p/1, y http://a.test.')).toEqual([
      { kind: 'text', text: 'mira ' },
      { kind: 'link', text: 'https://parcify.app/p/1', href: 'https://parcify.app/p/1' },
      { kind: 'text', text: ', y ' },
      { kind: 'link', text: 'http://a.test', href: 'http://a.test/' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('javascript:, data: y HTML no se enlazan ni se interpretan', () => {
    const body = 'javascript:alert(1) data:text/html,<b>x</b> <img src=x onerror=alert(1)>';
    expect(tokenize(body)).toEqual([{ kind: 'text', text: body }]);

    const node = document.createElement('p');
    renderBody(node, body);
    expect(node.querySelector('a, img, b')).toBeNull();
    expect(node.textContent).toBe(body);
  });

  it('construye el enlace con nodos DOM y los atributos seguros', () => {
    const node = document.createElement('p');
    renderBody(node, 'ver https://ejemplo.com/"><script>x</script> ya');
    const link = node.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://ejemplo.com/');
    expect(link.rel).toBe('noopener noreferrer nofollow');
    expect(link.target).toBe('_blank');
    expect(node.querySelector('script')).toBeNull();
    expect(node.textContent).toBe('ver https://ejemplo.com/"><script>x</script> ya');
  });

  it('resalta las menciones conocidas, también con varias palabras', () => {
    expect(tokenize('@Ana López mira @Anabel', ['Ana López'])).toEqual([
      { kind: 'mention', text: '@Ana López' },
      { kind: 'text', text: ' mira @Anabel' },
    ]);
  });
});

describe('menciones al escribir', () => {
  it('reconoce la @consulta justo antes del cursor', () => {
    expect(mentionQuery('hola @an', 8)).toEqual({ start: 5, query: 'an' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('correo a@b', 10)).toBeNull();
    expect(mentionQuery('hola @an tal', 12)).toBeNull();
  });

  it('filtra sin distinguir acentos ni mayúsculas', () => {
    const members = [{ name: 'Álvaro Ruiz' }, { name: 'Bea Martín' }, { name: 'Ana' }];
    expect(filterMembers(members, 'alv')).toEqual([{ name: 'Álvaro Ruiz' }]);
    expect(filterMembers(members, 'mart')).toEqual([{ name: 'Bea Martín' }]);
    expect(filterMembers(members, '')).toHaveLength(3);
  });

  it('solo envía las menciones que siguen en el texto', () => {
    const picked = { u1: 'Ana', u2: 'Bea' };
    expect(mentionsInBody('@Ana hola', picked)).toEqual(['u1']);
  });
});

describe('lista de mensajes', () => {
  it('une por id, ordena por fecha y deja los pendientes al final', () => {
    const a = message('0190a000-0000-7000-8000-00000000000a', { createdAt: '2026-10-17T10:00:00.000Z' });
    const b = message('0190a000-0000-7000-8000-00000000000b', { createdAt: '2026-10-17T10:01:00.000Z' });
    const pending: ChatEntry = { ...message('tmp-1', { createdAt: '2026-10-17T09:00:00.000Z' }), pending: 'sending' };
    const edited = { ...a, body: 'editado' };
    expect(mergeMessages([b, pending], [a, edited]).map((entry) => [entry.id, entry.body])).toEqual([
      [a.id, 'editado'],
      [b.id, 'hola'],
      ['tmp-1', 'hola'],
    ]);
  });

  it('cuenta no leídos de otros desde el último leído guardado', () => {
    const ids = ['0190a000-0000-7000-8000-000000000001', '0190a000-0000-7000-8000-000000000002', '0190a000-0000-7000-8000-000000000003'];
    const list = [message(ids[0]!), message(ids[1]!, { author: { id: 'yo', name: 'Yo', avatarAssetId: null } }), message(ids[2]!)];
    expect(unreadCount(list, 'yo', null)).toBe(2);
    markRead('yo', PROJECT, ids[0]!);
    markRead('yo', PROJECT, '0190a000-0000-7000-8000-000000000000');
    expect(lastRead('yo', PROJECT)).toBe(ids[0]);
    expect(unreadCount(list, 'yo', lastRead('yo', PROJECT))).toBe(1);
  });

  it('acepta solo eventos chat.message válidos de este proyecto', () => {
    const valid = message('0190a000-0000-7000-8000-000000000001');
    expect(parseChatEvent({ type: 'chat.message', message: valid }, PROJECT)).toEqual(valid);
    expect(parseChatEvent({ type: 'chat.message', message: { ...valid, projectId: '0190a000-0000-7000-8000-0000000000ff' } }, PROJECT)).toBeNull();
    expect(parseChatEvent({ type: 'asset.ready', assetId: valid.id }, PROJECT)).toBeNull();
  });
});

describe('escribiendo…', () => {
  it('se apaga a los 3 s sin teclear y al enviar', () => {
    vi.useFakeTimers();
    const calls: boolean[] = [];
    const signal = typingSignal((value) => calls.push(value));
    signal.input();
    signal.input();
    vi.advanceTimersByTime(2_900);
    signal.input();
    vi.advanceTimersByTime(2_900);
    expect(calls).toEqual([true]);
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([true, false]);
    signal.input();
    signal.stop();
    signal.stop();
    expect(calls).toEqual([true, false, true, false]);
  });
});
