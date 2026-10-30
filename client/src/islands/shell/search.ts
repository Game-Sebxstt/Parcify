import { byLastEdited } from '../../lib/projects.ts';
import type { ProjectSummary } from '../../shared/api/projects.js';

export const SEARCH_MIN_CHARS = 2;
// El mismo límite que ProjectListQuerySchema y TemplateListQuerySchema.
export const SEARCH_MAX_CHARS = 80;
export const SEARCH_DELAY_MS = 250;
export const SEARCH_MAX_WORKSPACES = 12;
export const SEARCH_MAX_PROJECTS = 8;
export const SEARCH_MAX_TEMPLATES = 5;

// Parámetros con los que un resultado de plantilla abre la galería. No usan q, que es la búsqueda de Proyectos.
export const TEMPLATE_PARAM = 'plantilla';
export const TEMPLATE_QUERY_PARAM = 'plantillaq';

export function templateHref(slug: string, template: { id: string; name: string }): string {
  const params = new URLSearchParams({ vista: 'plantillas', [TEMPLATE_PARAM]: template.id, [TEMPLATE_QUERY_PARAM]: template.name });
  return `/app/e/${slug}?${params}`;
}

// La consulta que se envía, o null si es demasiado corta para buscar.
export function searchTerm(raw: string): string | null {
  const q = raw.trim().slice(0, SEARCH_MAX_CHARS).trim();
  return q.length >= SEARCH_MIN_CHARS ? q : null;
}

// Como el filtro del servidor (contains sin distinguir mayúsculas), para los compartidos, que se filtran aquí.
export function nameMatches(name: string, q: string): boolean {
  return name.toLocaleLowerCase('es').includes(q.toLocaleLowerCase('es'));
}

export function mergeProjects(lists: ProjectSummary[][], limit: number): ProjectSummary[] {
  const seen = new Map<string, ProjectSummary>();
  for (const list of lists) for (const project of list) if (!seen.has(project.id)) seen.set(project.id, project);
  return [...seen.values()].sort(byLastEdited).slice(0, limit);
}
