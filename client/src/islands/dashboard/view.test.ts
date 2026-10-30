import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '../../shared/api/projects.js';
import { recentProjects } from './view.ts';

function project(index: number, name: string, editedMinute: number): ProjectSummary {
  const edited = new Date(Date.UTC(2026, 0, 1, 0, editedMinute)).toISOString();
  const created = new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString();
  return { id: `p${index}`, name, createdAt: created, lastEditedAt: edited } as ProjectSummary;
}

describe('recentProjects', () => {
  const items = Array.from({ length: 21 }, (_, i) => project(i + 1, `B${String(i + 1).padStart(2, '0')}`, i + 1));
  items.push(project(22, 'Zz reciente', 100));

  it('con «Nombre» conserva los 20 últimos editados y solo cambia su orden', () => {
    const result = recentProjects([items], 'name', 20);
    expect(result).toHaveLength(20);
    expect(result.map((item) => item.name)).toContain('Zz reciente');
    expect(result.map((item) => item.name)).not.toContain('B01');
    expect(result.map((item) => item.name)).not.toContain('B02');
    expect(result[0]!.name).toBe('B03');
    expect(result.at(-1)!.name).toBe('Zz reciente');
  });

  it('quita repetidos entre listas antes de recortar', () => {
    const result = recentProjects([items.slice(0, 10), items.slice(5)], 'edited', 20);
    expect(new Set(result.map((item) => item.id)).size).toBe(20);
    expect(result[0]!.name).toBe('Zz reciente');
  });
});
