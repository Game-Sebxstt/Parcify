// Copias locales de proyectos en IndexedDB: una base por usuario, proyecto y epoch.
const PREFIX = 'parcify:';
const SETTING_KEY = 'parcify:localCopy';

export function localCopyName(userId: string, projectId: string, epoch: number): string {
  return `${PREFIX}${userId}:${projectId}:${epoch}`;
}

export function parseLocalCopyName(name: string): { userId: string; projectId: string; epoch: number } | null {
  const match = /^parcify:([^:]+):([^:]+):(\d+)$/.exec(name);
  if (!match) return null;
  return { userId: match[1]!, projectId: match[2]!, epoch: Number(match[3]) };
}

// Ajuste de cuenta «Guardar copia local de los proyectos»; activado por defecto.
export function localCopyEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== '0';
  } catch {
    return false;
  }
}

export function setLocalCopyEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SETTING_KEY, enabled ? '1' : '0');
  } catch {
    // Sin almacenamiento local no hay copias que guardar.
  }
}

export async function listLocalCopies(): Promise<string[]> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return [];
  try {
    const databases = await indexedDB.databases();
    return databases.map((db) => db.name ?? '').filter((name) => name.startsWith(PREFIX));
  } catch {
    return [];
  }
}

export function deleteLocalCopy(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

// Al cerrar sesión se borran todas las bases del usuario.
export async function clearLocalCopies(userId: string): Promise<void> {
  const names = await listLocalCopies();
  await Promise.all(names.filter((name) => parseLocalCopyName(name)?.userId === userId).map(deleteLocalCopy));
}
