import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import { NodeSchema } from '../../shared/document/schema.js';
import type { EditorCore } from '../EditorCore.ts';
import type { Point } from '../geometry/matrix.ts';
import { hasTextContent, type NodeRecord } from '../types.ts';

export const CLIPBOARD_PREFIX = '<!--parcify:';
export const CLIPBOARD_SUFFIX = '-->';
export const CLIPBOARD_VERSION = 1;
// Un bloque mayor no viene de Parcify o no merece la pena leerlo.
export const MAX_CLIPBOARD_CHARS = 16 * 1024 * 1024;
// POST /v1/assets/copy acepta hasta 50 ids por llamada.
export const ASSET_COPY_BATCH = 50;

// De dónde salió la copia: si el proyecto cambia, las imágenes se copian al proyecto destino, porque cada asset solo lo ve quien ve su proyecto.
export type ClipboardSource = { projectId: string; workspace: string };

export type ClipboardPayload = {
  source: ClipboardSource | null;
  nodes: NodeRecord[];
  texts: Record<string, string>;
};

export type PasteContent =
  | { kind: 'nodes'; payload: ClipboardPayload }
  | { kind: 'images'; files: File[] }
  | { kind: 'svg'; file: File }
  | { kind: 'text'; text: string };

// Dentro de un comentario HTML, «-->» lo cerraría antes de tiempo y «<» abriría marcado: el JSON va con <, > y &
// escapados como \u00XX, que JSON.parse devuelve tal cual.
const UNSAFE_IN_COMMENT = /[<>&\u2028\u2029]/g;

export function serializeClipboard(payload: ClipboardPayload): string {
  const json = JSON.stringify({ v: CLIPBOARD_VERSION, source: payload.source, nodes: payload.nodes, texts: payload.texts });
  const escaped = json.replace(UNSAFE_IN_COMMENT, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `${CLIPBOARD_PREFIX}${escaped}${CLIPBOARD_SUFFIX}`;
}

const SOURCE_FIELD = /^[A-Za-z0-9-]{1,64}$/;

function readSource(value: unknown): ClipboardSource | null {
  if (!value || typeof value !== 'object') return null;
  const { projectId, workspace } = value as Record<string, unknown>;
  if (typeof projectId !== 'string' || typeof workspace !== 'string') return null;
  if (!SOURCE_FIELD.test(projectId) || !SOURCE_FIELD.test(workspace)) return null;
  return { projectId, workspace };
}

// Lee el bloque de Parcify de un text/html. Lo que no valida contra el esquema se descarta; null si no hay bloque.
export function parseClipboard(html: string): ClipboardPayload | null {
  if (html.length > MAX_CLIPBOARD_CHARS) return null;
  const start = html.indexOf(CLIPBOARD_PREFIX);
  if (start === -1) return null;
  const end = html.indexOf(CLIPBOARD_SUFFIX, start + CLIPBOARD_PREFIX.length);
  if (end === -1) return null;
  let data: unknown;
  try {
    data = JSON.parse(html.slice(start + CLIPBOARD_PREFIX.length, end));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { v, nodes, texts, source } = data as Record<string, unknown>;
  if (v !== CLIPBOARD_VERSION || !Array.isArray(nodes) || nodes.length > DOCUMENT_LIMITS.maxNodes) return null;
  const records: NodeRecord[] = [];
  for (const node of nodes) {
    const parsed = NodeSchema.safeParse(node);
    if (parsed.success) records.push(parsed.data);
  }
  const ids = new Set(records.map((record) => record.id));
  const contents: Record<string, string> = {};
  if (texts && typeof texts === 'object') {
    for (const [id, value] of Object.entries(texts as Record<string, unknown>)) {
      if (ids.has(id) && typeof value === 'string') contents[id] = value.slice(0, DOCUMENT_LIMITS.maxTextLength);
    }
  }
  return { source: readSource(source), nodes: records, texts: contents };
}

// text/plain de una copia: el texto de los nodos, uno por línea, en el orden en que se copiaron.
export function plainTextOf(payload: Pick<ClipboardPayload, 'nodes' | 'texts'>): string {
  const lines: string[] = [];
  for (const record of payload.nodes) {
    const text = hasTextContent(record) ? payload.texts[record.id] : undefined;
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

export function assetIdsOf(nodes: readonly NodeRecord[]): string[] {
  const ids = new Set<string>();
  for (const record of nodes) if (record.type === 'image') ids.add(record.assetId);
  return [...ids];
}

// Cambia los assetId de las imágenes según el mapa viejo → nuevo; los que no están se quedan como estaban.
export function remapAssets(nodes: readonly NodeRecord[], map: Readonly<Record<string, string>>): NodeRecord[] {
  return nodes.map((record) => {
    if (record.type !== 'image') return record;
    const next = map[record.assetId];
    return next ? { ...record, assetId: next } : record;
  });
}

const SPACE = /\s/;

function startsWithAt(text: string, prefix: string, at: number): boolean {
  return text.slice(at, at + prefix.length).toLowerCase() === prefix;
}

function skipSpace(text: string, at: number): number {
  while (at < text.length && SPACE.test(text[at]!)) at++;
  return at;
}

// Un SVG pegado como texto se sube como imagen y lo rasteriza el servidor: nunca se mete en el DOM.
// Solo se mira la forma, en una pasada: declaración XML, comentarios y DOCTYPE opcionales, `<svg` y `</svg>` al final.
export function looksLikeSvg(text: string): boolean {
  if (text.length > MAX_CLIPBOARD_CHARS) return false;
  const svg = text.trim();
  if (!svg.toLowerCase().endsWith('</svg>')) return false;
  let at = 0;
  if (startsWithAt(svg, '<?xml', at)) {
    const end = svg.indexOf('?>', at);
    if (end === -1 || svg.slice(at, end).includes('>')) return false;
    at = skipSpace(svg, end + 2);
  }
  for (;;) {
    if (startsWithAt(svg, '<!--', at)) {
      const end = svg.indexOf('-->', at + 4);
      if (end === -1) return false;
      at = skipSpace(svg, end + 3);
    } else if (startsWithAt(svg, '<!doctype', at)) {
      const end = svg.indexOf('>', at);
      if (end === -1) return false;
      at = skipSpace(svg, end + 1);
    } else break;
  }
  if (!startsWithAt(svg, '<svg', at)) return false;
  const next = svg[at + 4];
  return next !== undefined && (next === '>' || SPACE.test(next));
}

function svgFile(text: string): File {
  return new File([text], 'pegado.svg', { type: 'image/svg+xml' });
}

function fromParts(html: string, files: File[], text: string): PasteContent | null {
  if (html) {
    const payload = parseClipboard(html);
    if (payload) return payload.nodes.length ? { kind: 'nodes', payload } : null;
  }
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (images.length) return { kind: 'images', files: images };
  if (looksLikeSvg(text)) return { kind: 'svg', file: svgFile(text.trim()) };
  const plain = text.replace(/\r\n?/g, '\n');
  if (plain.trim()) return { kind: 'text', text: plain.slice(0, DOCUMENT_LIMITS.maxTextLength) };
  return null;
}

type TransferLike = { getData(type: string): string; files?: ArrayLike<File> | null };

// Qué trae un evento paste, por orden de preferencia: nodos de Parcify, imágenes, un SVG en texto o texto plano.
// Del HTML ajeno solo se lee el bloque de Parcify; el resto se ignora.
export function readTransfer(data: TransferLike): PasteContent | null {
  return fromParts(data.getData('text/html') ?? '', Array.from(data.files ?? []), data.getData('text/plain') ?? '');
}

// Lo mismo desde la API asíncrona (el «Pegar» del menú contextual).
export async function readClipboardItems(items: readonly ClipboardItem[]): Promise<PasteContent | null> {
  let html = '';
  let text = '';
  const files: File[] = [];
  for (const item of items) {
    for (const type of item.types) {
      if (type === 'text/html' && !html) html = await (await item.getType(type)).text();
      else if (type === 'text/plain' && !text) text = await (await item.getType(type)).text();
      else if (type.startsWith('image/')) {
        const blob = await item.getType(type);
        files.push(new File([blob], `pegado.${type.slice(6).replace(/\+.*$/, '')}`, { type }));
      }
    }
  }
  return fromParts(html, files, text);
}

export type ClipboardHost = {
  source: ClipboardSource | null;
  // Copia en el proyecto actual los assets de otro proyecto y devuelve el mapa viejo → nuevo.
  copyAssets?: (ids: string[]) => Promise<Record<string, string>>;
  // Imágenes pegadas: se suben como assets y se colocan en `at`.
  insertFiles?: (files: File[], at: Point) => void;
};

type SystemClipboard = Pick<Clipboard, 'read' | 'write'>;

function systemClipboard(): SystemClipboard | null {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;
  if (typeof navigator.clipboard.read !== 'function' || typeof navigator.clipboard.write !== 'function') return null;
  return navigator.clipboard;
}

// Copiar, cortar y pegar del lienzo. El teclado llega por los eventos copy, cut y paste; el menú contextual usa
// la API asíncrona y, si el navegador no deja leer, lo último que se copió aquí.
export class ClipboardController {
  private last: string | null = null;
  private destroyed = false;

  constructor(
    private readonly core: EditorCore,
    private readonly host: ClipboardHost,
  ) {}

  // Lo que se escribe al copiar la selección: el bloque en text/html y el texto en text/plain.
  private snapshot(): { html: string; text: string } | null {
    const copied = this.core.commands.copyPayload();
    if (!copied) return null;
    const payload: ClipboardPayload = { ...copied, source: this.host.source };
    const html = serializeClipboard(payload);
    this.last = html;
    return { html, text: plainTextOf(payload) };
  }

  copyTo(data: DataTransfer): boolean {
    const snapshot = this.snapshot();
    if (!snapshot) return false;
    data.setData('text/html', snapshot.html);
    data.setData('text/plain', snapshot.text);
    return true;
  }

  cutTo(data: DataTransfer): boolean {
    if (this.core.readOnly.get() || !this.copyTo(data)) return false;
    this.core.commands.deleteSelection();
    return true;
  }

  async copy(): Promise<boolean> {
    const snapshot = this.snapshot();
    if (!snapshot) return false;
    const system = systemClipboard();
    if (system && typeof ClipboardItem !== 'undefined') {
      try {
        await system.write([
          new ClipboardItem({
            'text/html': new Blob([snapshot.html], { type: 'text/html' }),
            'text/plain': new Blob([snapshot.text], { type: 'text/plain' }),
          }),
        ]);
      } catch {
        // Sin permiso, la copia sigue disponible para pegar en esta pestaña.
      }
    }
    return true;
  }

  async cut(): Promise<boolean> {
    if (this.core.readOnly.get()) return false;
    const copied = await this.copy();
    if (copied && !this.destroyed) this.core.commands.deleteSelection();
    return copied;
  }

  // «Pegar» del menú contextual: lee el portapapeles del sistema y, si no se puede, lo último copiado aquí.
  async pasteFromSystem(at?: Point): Promise<boolean> {
    if (this.core.readOnly.get()) return false;
    let content: PasteContent | null = null;
    const system = systemClipboard();
    if (system) {
      try {
        content = await readClipboardItems(await system.read());
      } catch {
        content = null;
      }
    }
    if (!content && this.last) {
      const payload = parseClipboard(this.last);
      if (payload) content = { kind: 'nodes', payload };
    }
    return content ? this.paste(content, at) : false;
  }

  // Pega lo leído. Las imágenes de otro proyecto se copian antes al proyecto actual.
  async paste(content: PasteContent, at?: Point): Promise<boolean> {
    const core = this.core;
    if (this.destroyed || core.readOnly.get()) return false;
    const point = at ?? core.viewCenter();
    switch (content.kind) {
      case 'nodes': {
        let { nodes } = content.payload;
        const source = content.payload.source;
        const ids = assetIdsOf(nodes);
        if (ids.length && this.host.copyAssets && source && this.host.source && source.projectId !== this.host.source.projectId) {
          const map: Record<string, string> = {};
          for (let i = 0; i < ids.length; i += ASSET_COPY_BATCH) {
            try {
              Object.assign(map, await this.host.copyAssets(ids.slice(i, i + ASSET_COPY_BATCH)));
            } catch {
              // Las que no se copian se pegan igual y se ven como imagen rota.
            }
          }
          if (this.destroyed || core.readOnly.get()) return false;
          nodes = remapAssets(nodes, map);
        }
        return core.commands.pasteNodes(nodes, content.payload.texts);
      }
      case 'images':
        if (!this.host.insertFiles) return false;
        this.host.insertFiles(content.files, point);
        return true;
      case 'svg':
        if (!this.host.insertFiles) return false;
        this.host.insertFiles([content.file], point);
        return true;
      case 'text':
        return core.commands.pasteText(content.text, point) !== null;
    }
  }

  destroy(): void {
    this.destroyed = true;
  }
}
