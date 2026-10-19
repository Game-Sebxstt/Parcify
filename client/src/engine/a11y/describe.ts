import type { NodeType } from '../../shared/document/schema.js';
import type { NodeRecord } from '../types.ts';

// Textos del anuncio, en el idioma de la interfaz. `feminine` concuerda el participio con el tipo («Elipse
// seleccionada», «Rectángulo seleccionado»).
export type DescribeLabels = {
  kind(type: NodeType | 'arrow'): { label: string; feminine: boolean };
  one(args: { what: string; w: number; h: number; page: string; feminine: boolean }): string;
  many(args: { count: number; page: string }): string;
  none(args: { page: string }): string;
};

const MAX_TEXT = 40;

// Una línea con flecha se nombra como flecha.
export function kindOf(record: NodeRecord): NodeType | 'arrow' {
  return record.type === 'line' && (record.endCap === 'arrow' || record.startCap === 'arrow') ? 'arrow' : record.type;
}

// Nombre de un nodo en el panel de capas y en los anuncios: el suyo, el comienzo de su texto o el de su tipo.
export function displayName(record: NodeRecord, kind: string, text = ''): string {
  if (record.name) return record.name;
  const content = text.replace(/\s+/g, ' ').trim();
  if (content) return content.length > MAX_TEXT ? `${content.slice(0, MAX_TEXT - 1)}…` : content;
  return kind;
}

// Lo que anuncia la región aria-live al cambiar la selección: «Rectángulo seleccionado, 120 por 80, en Página 1».
export function describeSelection(
  records: readonly NodeRecord[],
  page: string,
  labels: DescribeLabels,
  extra: { sizeOf?: (record: NodeRecord) => { w: number; h: number }; textOf?: (record: NodeRecord) => string } = {},
): string {
  if (records.length === 0) return labels.none({ page });
  if (records.length > 1) return labels.many({ count: records.length, page });
  const record = records[0]!;
  const kind = labels.kind(kindOf(record));
  const name = displayName(record, kind.label, extra.textOf?.(record) ?? '');
  const what = name === kind.label ? kind.label : `${kind.label} «${name}»`;
  const size = extra.sizeOf?.(record) ?? { w: record.w, h: record.h };
  const sentence = labels.one({ what, w: Math.round(size.w), h: Math.round(size.h), page, feminine: kind.feminine });
  // El texto alternativo de una imagen se lee después.
  return record.type === 'image' && record.alt ? `${sentence}. ${record.alt}` : sentence;
}
