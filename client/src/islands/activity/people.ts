import { m } from '../../paraglide/messages.js';
import type { ProjectActivityResponse } from '../../shared/api/activity.js';
import { COLLAB_COLORS } from '../../shared/collab-colors.js';

export type Person = { id: string; name: string; color: string };

// En el orden de byUser (más ediciones primero), con un color por persona.
export function peopleOf(report: Pick<ProjectActivityResponse, 'users' | 'byUser'>): Person[] {
  const names = new Map(report.users.map((user) => [user.id, user.name]));
  return report.byUser.map((row, index) => ({
    id: row.userId,
    name: names.get(row.userId) ?? m.activity_user_gone(),
    color: COLLAB_COLORS[index % COLLAB_COLORS.length]!,
  }));
}
