import { describe, expect, it } from 'vitest';
import type { Mat } from '../geometry/matrix.ts';
import type { SceneRecord } from '../types.ts';
import type { ExportItem, ExportScene } from './raster.ts';
import { escapeXml, num, serializeSvg, type SvgImage } from './svg.ts';

const ASSET = '01890a5d-ac96-774b-bcce-b302099a8057';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const style = { fill: '#FF7A59FF', stroke: '#0B1220FF', strokeWidth: 2, strokeDash: 'solid', shadow: null };

let counter = 0;
function record(type: string, extra: Record<string, unknown> = {}): SceneRecord {
  counter++;
  return {
    id: `n${counter}`.padEnd(21, '_'),
    pageId: 'page'.padEnd(21, '_'),
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    createdBy: 'u',
    type,
    ...extra,
  } as unknown as SceneRecord;
}

const shape = (type: string, extra: Record<string, unknown> = {}) => record(type, { ...style, ...extra });

function item(rec: SceneRecord, options: { text?: string; parent?: string | null; world?: Mat } = {}): ExportItem {
  return { id: rec.id, record: rec, world: options.world ?? [1, 0, 0, 1, 10, 20], text: options.text ?? '', parent: options.parent ?? null };
}

function svgOf(items: ExportItem[], options: { title?: string; images?: Map<string, SvgImage | null>; transparent?: boolean } = {}): string {
  const scene: ExportScene = { bounds: { x: 0, y: 0, w: 200, h: 100 }, items, background: '#141416FF' };
  return serializeSvg(scene, { title: options.title ?? 'Proyecto', transparent: options.transparent ?? false, images: options.images ?? new Map() });
}

describe('serializeSvg', () => {
  it('cabecera, fondo y aviso de fuentes', () => {
    const svg = svgOf([]);
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">');
    expect(svg).toContain('fill="#141416"');
    expect(svg).toContain('Las fuentes no van incrustadas');
    expect(svgOf([], { transparent: true })).not.toContain('fill="#141416"');
  });

  it('rectángulo con esquinas, elipse y formas como path', () => {
    expect(svgOf([item(shape('rect', { cornerRadius: 6 }))])).toMatch(/<rect width="100" height="50" rx="6" ry="6" fill="#ff7a59" stroke="#0b1220" stroke-width="2"/);
    expect(svgOf([item(shape('ellipse'))])).toContain('<ellipse cx="50" cy="25" rx="50" ry="25"');
    for (const [type, extra] of [
      ['triangle', {}],
      ['diamond', {}],
      ['star', { points: 5, innerRatio: 0.5 }],
      ['polygon', { sides: 6 }],
      ['arc', { startAngle: 0, endAngle: Math.PI, innerRatio: 0 }],
    ] as const) {
      expect(svgOf([item(shape(type, extra))]), type).toMatch(/<path d="M[-\d.]+ [-\d.]+(L[-\d.]+ [-\d.]+)+Z"/);
    }
    expect(svgOf([item(shape('arc', { startAngle: 0, endAngle: Math.PI * 2, innerRatio: 0.5 }))])).toContain('fill-rule="evenodd"');
  });

  it('valores con dos decimales y transformación de mundo', () => {
    const svg = svgOf([item(shape('rect', { w: 10.123456, h: 5.987654, cornerRadius: 0 }), { world: [0.7071067, 0.7071067, -0.7071067, 0.7071067, 1.006, -0.0001] })]);
    expect(svg).toContain('width="10.12" height="5.99"');
    expect(svg).toContain('transform="matrix(0.71 0.71 -0.71 0.71 1.01 0)"');
    expect(num(-0.001)).toBe('0');
    expect(num(Number.NaN)).toBe('0');
  });

  it('sombra con filter y trazo discontinuo', () => {
    const svg = svgOf([item(shape('rect', { cornerRadius: 0, strokeDash: 'dashed', shadow: { x: 4, y: 6, blur: 10, color: '#00000080' } }))]);
    expect(svg).toMatch(/<filter id="shadow1"[^>]*><feDropShadow dx="4" dy="6" stdDeviation="5" flood-color="#000000" flood-opacity="0.5"\/><\/filter>/);
    expect(svg).toContain('filter="url(#shadow1)"');
    expect(svg).toContain('stroke-dasharray="8 5"');
  });

  it('línea con flecha y conector en coordenadas de mundo', () => {
    const line = svgOf([item(shape('line', { points: [[0, 0], [100, 0]], startCap: 'none', endCap: 'arrow', fill: null }))]);
    expect(line.match(/<path /g)).toHaveLength(1);
    expect(line.match(/<polyline /g)).toHaveLength(1);
    const connector = record('connector', {
      ...style,
      from: { x: 0, y: 0 },
      to: { x: 50, y: 50 },
      route: 'straight',
      startCap: 'circle',
      endCap: 'triangle',
      path: [5, 5, 55, 55],
    });
    const svg = svgOf([item(connector)]);
    // Tramo de 70,71 con grosor 2: L = 16. El círculo (r = 6,67) toca el inicio y el trazo se recorta 12 y 14,4.
    expect(svg).toContain('<path d="M13.49 13.49L44.82 44.82"');
    expect(svg).toContain('<circle cx="9.71" cy="9.71" r="6.67"');
    expect(svg).toContain('<polygon points="55,55 ');
    expect(svg).not.toContain('translate(10 20)');
  });

  it('texto en tspan por línea, con familia, tamaño y estilo', () => {
    const text = record('text', {
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: 700,
      italic: true,
      underline: true,
      strike: false,
      color: '#112233FF',
      align: 'center',
      lineHeight: 1.5,
      autoWidth: true,
    });
    const svg = svgOf([item(text, { text: 'Hola\nmundo' })]);
    expect(svg).toContain(`font-family="&apos;Inter&apos;, sans-serif"`);
    expect(svg).toContain('font-size="20" font-weight="700" font-style="italic" text-decoration="underline" text-anchor="middle"');
    expect(svg.match(/<tspan /g)).toHaveLength(2);
    expect(svg).toContain('>Hola</tspan>');
    expect(svg).toContain('>mundo</tspan>');
  });

  it('imagen incrustada como data URI con su alt; una URL que no es un mapa de bits se sustituye por el marcador', () => {
    const image = record('image', { assetId: ASSET, fit: 'cover', cornerRadius: 0, alt: 'Foto del equipo' });
    const svg = svgOf([item(image)], { images: new Map([[ASSET, { href: PIXEL, width: 1, height: 1 }]]) });
    expect(svg).toContain(`<image href="${PIXEL}"`);
    expect(svg).toContain('<title>Foto del equipo</title>');
    expect(svg).toContain('aria-label="Foto del equipo"');
    expect(svg).toContain('clip-path="url(#clip1)"');
    for (const href of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,AAA"onload="alert(1)']) {
      const unsafe = svgOf([item(image)], { images: new Map([[ASSET, { href, width: 1, height: 1 }]]) });
      expect(unsafe, href).not.toContain('<image');
      expect(unsafe, href).not.toContain('javascript');
      expect(unsafe, href).not.toContain('onload');
      expect(unsafe, href).toContain('fill="#2a2a30"');
    }
  });

  it('frames con recorte y grupos anidados; lo oculto no sale', () => {
    const frame = record('frame', { fill: '#FFFFFFFF', clip: true, name: 'Portada' });
    const group = record('group', { w: 0, h: 0, opacity: 0.5 });
    const child = shape('rect', { cornerRadius: 0, name: 'Hijo' });
    const hidden = shape('rect', { cornerRadius: 0, visible: false, name: 'Oculto' });
    const svg = svgOf([item(frame), item(group, { parent: frame.id }), item(child, { parent: group.id }), item(hidden, { parent: frame.id })]);
    expect(svg).toContain('<clipPath id="clip1"><rect width="100" height="50" transform="translate(10 20)"/></clipPath>');
    expect(svg).toContain('data-name="Portada"');
    expect(svg).toContain('<g opacity="0.5"><g data-name="Hijo"');
    expect(svg).not.toContain('Oculto');
  });

  it('un nombre o un texto con </text><script> se escapa: el SVG no lleva contenido ejecutable', () => {
    const evil = '</text><script>alert(1)</script><a href="javascript:x" onclick=\'y\'>&';
    const text = record('text', {
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: '#000000FF',
      align: 'left',
      lineHeight: 1.2,
      autoWidth: true,
      name: evil,
    });
    const labelled = shape('rect', { cornerRadius: 0, name: evil });
    const image = record('image', { assetId: ASSET, fit: 'fill', cornerRadius: 0, alt: evil });
    const svg = svgOf([item(text, { text: evil }), item(labelled, { text: evil }), item(image)], { title: evil });
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<a[\s>]/i);
    // Las comillas van escapadas, así que ningún valor de atributo puede cerrarse antes de tiempo.
    const attributes = (svg.match(/<[^>]*>/g) ?? []).map((tag) => tag.replace(/"[^"]*"/g, '""'));
    expect(attributes.some((tag) => /\son\w+=/i.test(tag))).toBe(false);
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(svg).toContain('&amp;');
    // Fuera de las cadenas escapadas solo quedan las etiquetas propias del serializador.
    const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((match) => match[1]));
    expect([...tags].every((tag) => ['svg', 'title', 'rect', 'g', 'text', 'tspan', 'path', 'defs'].includes(tag!))).toBe(true);
  });

  it('escapeXml quita caracteres que XML no admite', () => {
    expect(escapeXml('a\u0000b\u0007c\uD800d')).toBe('abcd');
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});
