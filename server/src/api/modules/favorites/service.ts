import type { Db } from '../../../core/db.js';
import { requireProject } from '../../../core/permissions.js';
import type { Actor } from '../../types.js';
import { requireVisibleTemplate } from '../templates/service.js';

export type FavoriteType = 'project' | 'template';

// Idempotente: marcar dos veces deja una sola fila.
export async function addFavorite(db: Db, actor: Actor, type: FavoriteType, targetId: string): Promise<void> {
  if (type === 'project') await requireProject(db, actor.userId, targetId);
  else await requireVisibleTemplate(db, actor.userId, targetId);
  await db.favorite.createMany({
    data: [{ userId: actor.userId, targetType: type, targetId }],
    skipDuplicates: true,
  });
}

// Quitar un favorito propio no exige ver el objetivo: así se pueden limpiar los que perdieron acceso.
export async function removeFavorite(db: Db, actor: Actor, type: FavoriteType, targetId: string): Promise<void> {
  await db.favorite.deleteMany({ where: { userId: actor.userId, targetType: type, targetId } });
}
