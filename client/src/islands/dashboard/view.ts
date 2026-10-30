import type { ProjectSummary } from '../../shared/api/projects.js';

export type ProjectView = 'grid' | 'list';
export type ProjectSort = 'edited' | 'name' | 'created';

// Cuadrícula o lista: lo comparten el inicio y la página de cada espacio.
export const VIEW_KEY = 'parcify:dashboardView';

export function readView(): ProjectView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function writeView(view: ProjectView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Sin almacenamiento (modo privado estricto) la vista dura lo que la página.
  }
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

// El mismo orden que aplica el servidor en cada espacio, para mezclar las listas de varios espacios.
export function compareProjects(sort: ProjectSort): (a: ProjectSummary, b: ProjectSummary) => number {
  if (sort === 'name') return (a, b) => collator.compare(a.name, b.name);
  const key = sort === 'created' ? 'createdAt' : 'lastEditedAt';
  return (a, b) => Date.parse(b[key]) - Date.parse(a[key]);
}

// Junta listas que pueden repetir proyectos (un favorito compartido sale en las dos), ordena y recorta.
export function mergeProjects(lists: ProjectSummary[][], sort: ProjectSort, limit: number): ProjectSummary[] {
  const seen = new Set<string>();
  const merged: ProjectSummary[] = [];
  for (const item of lists.flat()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged.sort(compareProjects(sort)).slice(0, limit);
}

// Vistos recientemente: siempre los últimos editados; el orden elegido solo reordena esos.
export function recentProjects(lists: ProjectSummary[][], sort: ProjectSort, limit: number): ProjectSummary[] {
  return mergeProjects(lists, 'edited', limit).sort(compareProjects(sort));
}
