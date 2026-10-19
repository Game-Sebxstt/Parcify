import {
  ChatListResponseSchema,
  ChatMessageSchema,
  type ChatMessageDto,
} from '../shared/api/chat.js';
import { MAX_UPLOAD_BYTES, type AssetDto } from '../shared/api/assets.js';
import { apiFetch, queryString } from './api.ts';
import { checkUpload, uploadAsset } from './assets.ts';

export const CHAT_TYPING_IDLE_MS = 3_000;

export type ChatSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'mention'; text: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
// Puntuación que suele cerrar la frase y no forma parte del enlace.
const TRAILING = /[.,;:!?)\]}»”’]+$/;

function safeHref(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitMentions(text: string, names: readonly string[]): ChatSegment[] {
  const usable = [...new Set(names.filter((name) => name.trim()))].sort((a, b) => b.length - a.length);
  if (!usable.length || !text.includes('@')) return text ? [{ kind: 'text', text }] : [];
  const pattern = new RegExp(`@(?:${usable.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  const segments: ChatSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    segments.push({ kind: 'mention', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

// Texto plano troceado en texto, enlaces http(s) y menciones; nunca interpreta HTML.
export function tokenize(body: string, mentionNames: readonly string[] = []): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const raw = match[0].replace(TRAILING, '');
    const href = safeHref(raw);
    if (!href) continue;
    if (match.index > last) segments.push(...splitMentions(body.slice(last, match.index), mentionNames));
    segments.push({ kind: 'link', text: raw, href });
    last = match.index + raw.length;
  }
  if (last < body.length) segments.push(...splitMentions(body.slice(last), mentionNames));
  return segments;
}

// Rellena el nodo con nodos Text y <a> creados a mano.
export function renderBody(node: HTMLElement, body: string, mentionNames: readonly string[] = []): void {
  const fragment = document.createDocumentFragment();
  for (const segment of tokenize(body, mentionNames)) {
    if (segment.kind === 'text') {
      fragment.append(document.createTextNode(segment.text));
    } else if (segment.kind === 'link') {
      const link = document.createElement('a');
      link.href = segment.href;
      link.rel = 'noopener noreferrer nofollow';
      link.target = '_blank';
      link.textContent = segment.text;
      link.className = 'text-coral underline underline-offset-2 break-all';
      fragment.append(link);
    } else {
      const mention = document.createElement('span');
      mention.textContent = segment.text;
      mention.className = 'font-semibold text-coral';
      fragment.append(mention);
    }
  }
  node.replaceChildren(fragment);
}

// Acción de Svelte: `use:chatBody={{ body, mentionNames }}`.
export function chatBody(node: HTMLElement, input: { body: string; mentionNames: readonly string[] }) {
  renderBody(node, input.body, input.mentionNames);
  return {
    update(next: { body: string; mentionNames: readonly string[] }) {
      renderBody(node, next.body, next.mentionNames);
    },
  };
}

// La «@consulta» que se está escribiendo justo antes del cursor, si la hay.
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s(])@([\p{L}\p{N}_.-]{0,40})$/u.exec(before);
  if (!match) return null;
  const query = match[2]!;
  return { start: caret - query.length - 1, query };
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function filterMembers<T extends { name: string }>(members: readonly T[], query: string, max = 6): T[] {
  const needle = fold(query);
  return members.filter((member) => fold(member.name).split(/\s+/).some((part) => part.startsWith(needle))).slice(0, max);
}

// Menciones que siguen en el texto al enviar: si se borró «@Nombre», no se menciona.
export function mentionsInBody(body: string, picked: Readonly<Record<string, string>>): string[] {
  const ids: string[] = [];
  for (const [userId, name] of Object.entries(picked)) {
    if (splitMentions(body, [name]).some((segment) => segment.kind === 'mention')) ids.push(userId);
  }
  return ids;
}

export type ChatEntry = ChatMessageDto & { pending?: 'sending' | 'failed'; tempId?: string };

function compare(a: ChatEntry, b: ChatEntry): number {
  if (a.pending && !b.pending) return 1;
  if (!a.pending && b.pending) return -1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Une mensajes por id y los ordena; los pendientes van siempre al final.
export function mergeMessages(current: readonly ChatEntry[], incoming: readonly ChatEntry[]): ChatEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort(compare);
}

const readKey = (userId: string, projectId: string) => `parcify:chat-read:${userId}:${projectId}`;

export function lastRead(userId: string, projectId: string): string | null {
  try {
    return localStorage.getItem(readKey(userId, projectId));
  } catch {
    return null;
  }
}

export function markRead(userId: string, projectId: string, messageId: string): void {
  try {
    const previous = localStorage.getItem(readKey(userId, projectId));
    // Los ids son uuidv7: el orden de texto es el orden de creación.
    if (!previous || previous < messageId) localStorage.setItem(readKey(userId, projectId), messageId);
  } catch {
    // Sin localStorage el indicador no persiste.
  }
}

export function unreadCount(messages: readonly ChatEntry[], userId: string, readId: string | null): number {
  return messages.filter((entry) => !entry.pending && !entry.deletedAt && entry.author.id !== userId && (!readId || entry.id > readId))
    .length;
}

// «Escribiendo…»: true al teclear y false a los 3 s sin teclear o al enviar.
export function typingSignal(set: (typing: boolean) => void, idleMs = CHAT_TYPING_IDLE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let typing = false;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (typing) {
      typing = false;
      set(false);
    }
  };
  return {
    input() {
      if (!typing) {
        typing = true;
        set(true);
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(stop, idleMs);
    },
    stop,
  };
}

export function parseChatEvent(message: Record<string, unknown>, projectId: string): ChatMessageDto | null {
  if (message.type !== 'chat.message') return null;
  const parsed = ChatMessageSchema.safeParse(message.message);
  return parsed.success && parsed.data.projectId === projectId ? parsed.data : null;
}

export function listChat(projectId: string, before?: string | null) {
  return apiFetch(`/v1/projects/${projectId}/chat?${queryString({ before: before ?? null, limit: '50' })}`, {
    schema: ChatListResponseSchema,
  });
}

export function sendChat(
  projectId: string,
  input: { body: string; replyToId?: string; attachments?: string[]; mentions?: string[] },
) {
  return apiFetch(`/v1/projects/${projectId}/chat`, { method: 'POST', body: input, schema: ChatMessageSchema });
}

export function editChat(projectId: string, messageId: string, input: { body: string; mentions?: string[] }) {
  return apiFetch(`/v1/projects/${projectId}/chat/${messageId}`, { method: 'PATCH', body: input, schema: ChatMessageSchema });
}

export function deleteChat(projectId: string, messageId: string) {
  return apiFetch(`/v1/projects/${projectId}/chat/${messageId}`, { method: 'DELETE' });
}

// Adjuntos del chat: cualquiera que vea el proyecto puede subirlos.
export async function uploadChatImage(file: File, projectId: string): Promise<AssetDto> {
  checkUpload(file, MAX_UPLOAD_BYTES, true);
  return uploadAsset(file, { purpose: 'chat', projectId });
}
