import { formatRelative } from '../../lib/format.ts';
import { m } from '../../paraglide/messages.js';
import type { TemplateSummary } from '../../shared/api/templates.js';

// «Publicada por Ana hace 3 días», o «Plantilla de Parcify» para las globales.
export function templateByline(template: TemplateSummary, meId: string): string {
  if (template.scope === 'parcify') return m.templates_by_parcify();
  const when = formatRelative(template.createdAt);
  if (!template.createdBy) return m.templates_published({ when });
  if (template.createdBy.id === meId) return m.templates_published_by_you({ when });
  return m.templates_published_by({ name: template.createdBy.name, when });
}
