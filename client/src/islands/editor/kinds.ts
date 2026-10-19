import type { DescribeLabels } from '../../engine/a11y/describe.ts';
import { m } from '../../paraglide/messages.js';
import type { NodeType } from '../../shared/document/schema.js';

// Nombre de cada tipo en la interfaz y si es femenino, para concordar «seleccionado» o «seleccionada».
const KINDS: Record<NodeType | 'arrow', { label: () => string; feminine: boolean }> = {
  rect: { label: m.editor_kind_rect, feminine: false },
  ellipse: { label: m.editor_kind_ellipse, feminine: true },
  triangle: { label: m.editor_kind_triangle, feminine: false },
  diamond: { label: m.editor_kind_diamond, feminine: false },
  star: { label: m.editor_kind_star, feminine: true },
  polygon: { label: m.editor_kind_polygon, feminine: false },
  arc: { label: m.editor_kind_arc, feminine: false },
  line: { label: m.editor_kind_line, feminine: true },
  arrow: { label: m.editor_kind_arrow, feminine: true },
  connector: { label: m.editor_kind_connector, feminine: false },
  text: { label: m.editor_kind_text, feminine: false },
  image: { label: m.editor_kind_image, feminine: true },
  group: { label: m.editor_kind_group, feminine: false },
  frame: { label: m.editor_kind_frame, feminine: false },
};

export function kindLabel(type: NodeType | 'arrow'): string {
  return KINDS[type].label();
}

export const describeLabels: DescribeLabels = {
  kind: (type) => ({ label: KINDS[type].label(), feminine: KINDS[type].feminine }),
  one: ({ what, w, h, page, feminine }) => (feminine ? m.editor_a11y_selected_f : m.editor_a11y_selected_m)({ what, w, h, page }),
  many: ({ count, page }) => m.editor_a11y_selected_many({ count, page }),
  none: ({ page }) => m.editor_a11y_selected_none({ page }),
};
