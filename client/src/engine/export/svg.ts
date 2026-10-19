import type { AssetVariant } from '../assets/AssetResolver.ts';
import { FULL_CROP, imagePlacement } from '../geometry/image.ts';
import type { Mat } from '../geometry/matrix.ts';
import { arcPolygon, arcSweep, dashPattern, ellipsePolygon, outline } from '../geometry/shapes.ts';
import { cssFamily } from '../text/fonts.ts';
import { ALIGN_FACTOR, layoutOf, type TextLayout } from '../text/layout.ts';
import type { ConnectorRecord, ContainerRecord, ImageRecord, LineRecord, RenderableRecord, ShapeRecord } from '../types.ts';
import type { ExportItem, ExportScene } from './raster.ts';

// Imagen incrustada: data URI de un mapa de bits y su tamaño natural. null si no se pudo cargar.
export type SvgImage = { href: string; width: number; height: number };
// Ancho de un texto con una fuente CSS; sin medidor solo se parten las líneas en los saltos explícitos.
export type MeasureText = (text: string, font: string) => number;

export type SvgOptions = {
  title: string;
  transparent: boolean;
  images: ReadonlyMap<string, SvgImage | null>;
  measure?: MeasureText;
};

// Solo mapas de bits en base64: nada de SVG anidados (que podrían llevar scripts) ni otros esquemas.
const SAFE_DATA_URI = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]*={0,2}$/;
const HEX_COLOR = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;
// Caracteres que XML 1.0 no admite, sustitutos sueltos incluidos.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Dos decimales como mucho y nunca «-0», «NaN» ni «Infinity».
export function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function paint(color: string | null | undefined, kind: 'fill' | 'stroke'): string {
  const match = color ? HEX_COLOR.exec(color) : null;
  if (!match) return `${kind}="none"`;
  const alpha = match[2] ? parseInt(match[2], 16) / 255 : 1;
  return `${kind}="#${match[1]!.toLowerCase()}"${alpha < 1 ? ` ${kind}-opacity="${num(alpha)}"` : ''}`;
}

function matrixAttr(m: Readonly<Mat>): string {
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) {
    return m[4] === 0 && m[5] === 0 ? '' : ` transform="translate(${num(m[4])} ${num(m[5])})"`;
  }
  return ` transform="matrix(${m.map(num).join(' ')})"`;
}

function pathData(points: readonly number[], closed: boolean): string {
  if (points.length < 4) return '';
  let d = `M${num(points[0]!)} ${num(points[1]!)}`;
  for (let i = 2; i < points.length; i += 2) d += `L${num(points[i]!)} ${num(points[i + 1]!)}`;
  return closed ? `${d}Z` : d;
}

class SvgWriter {
  private readonly defs: string[] = [];
  private counter = 0;

  constructor(private readonly options: SvgOptions) {}

  private id(prefix: string): string {
    return `${prefix}${++this.counter}`;
  }

  get definitions(): string {
    return this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
  }

  private shadowFilter(record: ShapeRecord): string {
    if (!record.shadow) return '';
    const id = this.id('shadow');
    const { x, y, blur, color } = record.shadow;
    const match = HEX_COLOR.exec(color);
    const flood = match ? `#${match[1]!.toLowerCase()}` : '#000000';
    const opacity = match?.[2] ? parseInt(match[2], 16) / 255 : 1;
    this.defs.push(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(x)}" dy="${num(y)}" stdDeviation="${num(blur / 2)}" flood-color="${flood}" flood-opacity="${num(opacity)}"/></filter>`,
    );
    return ` filter="url(#${id})"`;
  }

  private strokeAttrs(record: { stroke: string | null; strokeWidth: number; strokeDash: 'solid' | 'dashed' | 'dotted' }): string {
    if (!record.stroke || record.strokeWidth <= 0) return ' stroke="none"';
    const pattern = dashPattern(record.strokeDash, record.strokeWidth);
    const dash = pattern ? ` stroke-dasharray="${num(pattern[0])} ${num(pattern[1])}"${record.strokeDash === 'dotted' ? ' stroke-linecap="round"' : ''}` : '';
    return ` ${paint(record.stroke, 'stroke')} stroke-width="${num(record.strokeWidth)}" stroke-linejoin="round"${dash}`;
  }

  private shape(record: ShapeRecord): string {
    const fill = paint(record.fill, 'fill');
    const stroke = this.strokeAttrs(record);
    const { w, h } = record;
    switch (record.type) {
      case 'rect': {
        const r = Math.min(record.cornerRadius, w / 2, h / 2);
        return `<rect width="${num(w)}" height="${num(h)}"${r > 0 ? ` rx="${num(r)}" ry="${num(r)}"` : ''} ${fill}${stroke}/>`;
      }
      case 'ellipse':
        return `<ellipse cx="${num(w / 2)}" cy="${num(h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}" ${fill}${stroke}/>`;
      case 'arc':
        if (arcSweep(record.startAngle, record.endAngle) >= Math.PI * 2) {
          // Corona completa: el exterior y el hueco con evenodd.
          const outer = pathData(ellipsePolygon(w, h), true);
          const inner = record.innerRatio > 0 ? pathData(ellipsePolygon(w * record.innerRatio, h * record.innerRatio).map((v, i) => v + (i % 2 === 0 ? (w * (1 - record.innerRatio)) / 2 : (h * (1 - record.innerRatio)) / 2)), true) : '';
          return `<path d="${outer}${inner}" fill-rule="evenodd" ${fill}${stroke}/>`;
        }
        return `<path d="${pathData(arcPolygon(w, h, record.startAngle, record.endAngle, record.innerRatio), true)}" ${fill}${stroke}/>`;
      default:
        return `<path d="${pathData(outline(record).points, true)}" ${fill}${stroke}/>`;
    }
  }

  private line(record: LineRecord | ConnectorRecord, points: readonly number[]): string {
    if (!record.stroke || record.strokeWidth <= 0 || points.length < 4) return '';
    const width = record.strokeWidth;
    const color = paint(record.stroke, 'stroke');
    const pattern = dashPattern(record.strokeDash, width);
    const dash = pattern ? ` stroke-dasharray="${num(pattern[0])} ${num(pattern[1])}"` : '';
    let out = `<path d="${pathData(points, false)}" fill="none" ${color} stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
    const n = points.length / 2;
    const at = (i: number) => [points[i * 2]!, points[i * 2 + 1]!] as const;
    const size = Math.max(8, width * 4);
    for (const [cap, tip, prev] of [
      [record.startCap, at(0), at(1)],
      [record.endCap, at(n - 1), at(n - 2)],
    ] as const) {
      const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
      const [tx, ty] = tip;
      const back = (spread: number) => [tx - size * Math.cos(angle - spread), ty - size * Math.sin(angle - spread), tx - size * Math.cos(angle + spread), ty - size * Math.sin(angle + spread)];
      if (cap === 'arrow') {
        const [ax, ay, bx, by] = back(Math.PI / 6);
        out += `<path d="${pathData([ax!, ay!, tx, ty, bx!, by!], false)}" fill="none" ${color} stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else if (cap === 'bar') {
        const half = size / 2;
        const nx = -Math.sin(angle) * half;
        const ny = Math.cos(angle) * half;
        out += `<path d="${pathData([tx + nx, ty + ny, tx - nx, ty - ny], false)}" fill="none" ${color} stroke-width="${num(width)}" stroke-linecap="round"/>`;
      } else if (cap === 'triangle') {
        const [ax, ay, bx, by] = back(Math.PI / 7);
        out += `<path d="${pathData([tx, ty, ax!, ay!, bx!, by!], true)}" ${paint(record.stroke, 'fill')}/>`;
      } else if (cap === 'circle') {
        out += `<circle cx="${num(tx)}" cy="${num(ty)}" r="${num(Math.max(3, width * 1.6))}" ${paint(record.stroke, 'fill')}/>`;
      }
    }
    return out;
  }

  private image(record: ImageRecord): string {
    const loaded = this.options.images.get(record.assetId);
    const alt = record.alt ? `<title>${escapeXml(record.alt)}</title>` : '';
    const label = record.alt ? ` role="img" aria-label="${escapeXml(record.alt)}"` : '';
    const r = Math.min(record.cornerRadius, record.w / 2, record.h / 2);
    const radius = r > 0 ? ` rx="${num(r)}" ry="${num(r)}"` : '';
    if (!loaded || !SAFE_DATA_URI.test(loaded.href)) {
      // Igual que en el lienzo: un marcador gris donde iba la imagen.
      return `<g${label}>${alt}<rect width="${num(record.w)}" height="${num(record.h)}"${radius} fill="#2a2a30"/></g>`;
    }
    const { area, image } = imagePlacement(record, loaded.width, loaded.height);
    const crop = record.crop ?? FULL_CROP;
    // La imagen entera, colocada para que su parte recortada caiga en `image`, y recortada al área.
    const fullW = image.w / (crop.w || 1);
    const fullH = image.h / (crop.h || 1);
    const clip = this.id('clip');
    this.defs.push(`<clipPath id="${clip}"><rect x="${num(area.x)}" y="${num(area.y)}" width="${num(area.w)}" height="${num(area.h)}"${radius}/></clipPath>`);
    return `<g${label} clip-path="url(#${clip})">${alt}<image href="${loaded.href}" x="${num(image.x - crop.x * fullW)}" y="${num(image.y - crop.y * fullH)}" width="${num(fullW)}" height="${num(fullH)}" preserveAspectRatio="none"/></g>`;
  }

  private wrap(layout: TextLayout, font: string): string[] {
    const measure = this.options.measure;
    const lines: string[] = [];
    for (const paragraph of layout.content.split(/\r?\n/)) {
      if (!measure || layout.wrapWidth === null) {
        lines.push(paragraph);
        continue;
      }
      let current = '';
      for (const word of paragraph.split(/(?<=\s)/)) {
        const next = current + word;
        if (current && measure(next.trimEnd(), font) > layout.wrapWidth) {
          lines.push(current.trimEnd());
          current = word;
        } else {
          current = next;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  private text(layout: TextLayout): string {
    const weight = layout.weight;
    // Se mide con la fuente cargada en el editor, la misma con la que se ve el lienzo.
    const font = `${layout.italic ? 'italic ' : ''}${weight} ${layout.size}px "${cssFamily(layout.family)}"`;
    const lines = this.wrap(layout, font);
    const lineHeight = layout.size * layout.lineHeight;
    const top = layout.box.y + (layout.box.h - lines.length * lineHeight) * ALIGN_FACTOR[layout.vAlign];
    const x = layout.box.x + layout.box.w * ALIGN_FACTOR[layout.align];
    const anchor = layout.align === 'left' ? 'start' : layout.align === 'center' ? 'middle' : 'end';
    const decoration = [layout.underline && 'underline', layout.strike && 'line-through'].filter(Boolean).join(' ');
    const attrs = [
      `font-family="${escapeXml(`'${layout.family}', sans-serif`)}"`,
      `font-size="${num(layout.size)}"`,
      `font-weight="${weight}"`,
      layout.italic ? 'font-style="italic"' : '',
      decoration ? `text-decoration="${decoration}"` : '',
      `text-anchor="${anchor}"`,
      paint(layout.color, 'fill'),
      'xml:space="preserve"',
    ].filter(Boolean);
    // Línea base aproximada: el centro de la línea más 0,35 em.
    const spans = lines
      .map((line, i) => `<tspan x="${num(x)}" y="${num(top + i * lineHeight + lineHeight / 2 + layout.size * 0.35)}">${escapeXml(line)}</tspan>`)
      .join('');
    return `<text ${attrs.join(' ')}>${spans}</text>`;
  }

  private leaf(item: ExportItem, record: RenderableRecord): string {
    let body = '';
    let filter = '';
    // Los conectores ya vienen en coordenadas de mundo.
    const transform = record.type === 'connector' ? '' : matrixAttr(item.world);
    switch (record.type) {
      case 'line':
        body = this.line(record, record.points.flat());
        break;
      case 'connector':
        body = this.line(record, record.path ?? []);
        break;
      case 'image':
        body = this.image(record);
        break;
      case 'text':
        break;
      default:
        filter = this.shadowFilter(record);
        body = this.shape(record);
    }
    const layout = layoutOf(record, item.text);
    const label = layout ? this.text(layout) : '';
    if (!body && !label) return '';
    const shape = filter ? `<g${filter}>${body}</g>` : body;
    return `<g${nameAttr(record.name)}${transform}${opacityAttr(record.opacity)}>${shape}${label}</g>`;
  }

  private container(item: ExportItem, record: ContainerRecord, children: string): string {
    if (record.type === 'group') return `<g${nameAttr(record.name)}${opacityAttr(record.opacity)}>${children}</g>`;
    const transform = matrixAttr(item.world);
    const background = record.fill ? `<rect width="${num(record.w)}" height="${num(record.h)}" ${paint(record.fill, 'fill')}${transform}/>` : '';
    let content = children;
    if (record.clip && children) {
      const clip = this.id('clip');
      this.defs.push(`<clipPath id="${clip}"><rect width="${num(record.w)}" height="${num(record.h)}"${transform}/></clipPath>`);
      content = `<g clip-path="url(#${clip})">${children}</g>`;
    }
    return `<g${nameAttr(record.name)}${opacityAttr(record.opacity)}>${background}${content}</g>`;
  }

  render(item: ExportItem, children: ReadonlyMap<string, ExportItem[]>): string {
    const record = item.record;
    if (!record.visible) return '';
    if (record.type === 'group' || record.type === 'frame') {
      const inner = (children.get(item.id) ?? []).map((child) => this.render(child, children)).join('');
      return this.container(item, record, inner);
    }
    return this.leaf(item, record);
  }
}

function nameAttr(name: string | undefined): string {
  return name ? ` data-name="${escapeXml(name)}"` : '';
}

function opacityAttr(opacity: number): string {
  return opacity < 1 ? ` opacity="${num(opacity)}"` : '';
}

// SVG desde los NodeRecord de la escena: formas, texto en tspan, imágenes como data URI y sombras con filtros.
// Todo el texto del usuario va escapado y las fuentes no se incrustan (solo se nombran).
export function serializeSvg(scene: ExportScene, options: SvgOptions): string {
  const writer = new SvgWriter(options);
  const children = new Map<string, ExportItem[]>();
  const roots: ExportItem[] = [];
  for (const item of scene.items) {
    if (item.parent) {
      const list = children.get(item.parent);
      if (list) list.push(item);
      else children.set(item.parent, [item]);
    } else {
      roots.push(item);
    }
  }
  const body = roots.map((item) => writer.render(item, children)).join('');
  const { x, y, w, h } = scene.bounds;
  const background = options.transparent ? '' : `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" ${paint(scene.background, 'fill')}/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}">` +
    `<title>${escapeXml(options.title)}</title>` +
    `<!-- Las fuentes no van incrustadas: el texto usa su nombre de familia. -->` +
    writer.definitions +
    background +
    body +
    `</svg>`
  );
}

export type SvgImageSource = {
  imageUrl(assetId: string, variant: AssetVariant): Promise<string | null>;
};

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

async function embedImage(url: string, signal: AbortSignal): Promise<SvgImage | null> {
  try {
    const response = await fetch(url, { credentials: 'omit', signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime = blob.type.split(';')[0]!.trim().toLowerCase();
    if (!IMAGE_MIMES.has(mime)) return null;
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { href: `data:${mime};base64,${btoa(binary)}`, ...size };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}

// Carga la variante full de cada imagen, mide el texto con un canvas y devuelve el SVG como Blob.
export async function renderSvg(source: SvgImageSource, scene: ExportScene, options: { title: string; transparent: boolean; signal?: AbortSignal }): Promise<Blob> {
  const signal = options.signal ?? new AbortController().signal;
  const ids = new Set<string>();
  for (const item of scene.items) if (item.record.type === 'image') ids.add(item.record.assetId);
  const images = new Map<string, SvgImage | null>();
  await Promise.all(
    [...ids].map(async (id) => {
      const url = await source.imageUrl(id, 'full');
      images.set(id, url ? await embedImage(url, signal) : null);
    }),
  );
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const context = new OffscreenCanvas(1, 1).getContext('2d');
  const measure: MeasureText | undefined = context
    ? (text, font) => {
        context.font = font;
        return context.measureText(text).width;
      }
    : undefined;
  const svg = serializeSvg(scene, { title: options.title, transparent: options.transparent, images, ...(measure ? { measure } : {}) });
  return new Blob([svg], { type: 'image/svg+xml' });
}
