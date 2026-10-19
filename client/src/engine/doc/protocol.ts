import type { PresenceState } from '../../shared/document/keys.js';
import type { Animation, AnimProp, Keyframe, Meta } from '../../shared/document/schema.js';
import type { DocumentJson } from '../../shared/document/to-json.js';
import type { ProjectRole } from '../../shared/permissions.js';
import type { NodeRecord } from '../types.ts';

// Mensajes entre el hilo principal y el host del documento (worker o modo directo). Los dos lados son código propio
// del mismo origen: se comprueba el discriminante `t`, no se validan con zod.

export type PageRecord = Readonly<{ id: string; name: string; index: string; background?: string }>;
export type PageFields = { name: string; index: string; background?: string };

// Claves que se parchean en sitio sin pasar el nodo por zod, en este orden (un bit cada una).
export const FAST_KEYS = ['x', 'y', 'rotation', 'opacity', 'visible', 'locked'] as const;
export type FastKey = (typeof FAST_KEYS)[number];
const FAST_BOOLEAN = FAST_KEYS.map((key) => key === 'visible' || key === 'locked');
export const FAST_BIT: Readonly<Record<string, number | undefined>> = Object.fromEntries(FAST_KEYS.map((key, i) => [key, 1 << i]));

export type DocOp =
  | { k: 'node.set'; record: NodeRecord }
  | { k: 'node.patch'; id: string; set: Record<string, unknown>; unset?: string[] }
  | { k: 'node.delete'; id: string }
  | { k: 'text.set'; id: string; content: string }
  | { k: 'text.delete'; id: string }
  | { k: 'page.set'; id: string; page: PageFields }
  | { k: 'page.patch'; id: string; set: Partial<PageFields> }
  | { k: 'page.delete'; id: string }
  // Crea la animación del nodo con una pista vacía si no existe; si existe, no hace nada.
  | { k: 'animation.ensure'; id: string; settings: AnimationSettings }
  | { k: 'animation.patch'; id: string; set: Partial<AnimationSettings> }
  // Crea la pista si falta. Una pista llena (máximo de keyframes) no admite claves nuevas.
  | { k: 'keyframe.set'; id: string; prop: AnimProp; key: string; keyframe: Keyframe }
  | { k: 'keyframe.delete'; id: string; prop: AnimProp; key: string }
  // Sin efecto si la clave no existe.
  | { k: 'animation.delete'; id: string };

export type AnimationSettings = Omit<Animation, 'tracks'>;

// Solo existe en el espejo del hilo principal; nunca se manda.
export type MirrorOp = DocOp | { k: 'text.local'; id: string; content: string };

export type OpOrigin = 'local' | 'ai';
// 'new' abre un paso de deshacer; 'merge' se funde con el anterior dentro del captureTimeout.
export type OpStep = 'new' | 'merge';

export type MainToHost =
  | { t: 'ops'; seq: number; origin: OpOrigin; step: OpStep; selection: string[]; ops: DocOp[] }
  | { t: 'step-after'; selection: string[] }
  | { t: 'undo' | 'redo'; seq: number; selection: string[] }
  | { t: 'text-open'; session: number; id: string; value: string; selection: string[] }
  | { t: 'text-close'; session: number }
  | { t: 'text-edit'; seq: number; session: number; textGen: number; base: number; start: number; end: number; insert: string; anchor: number; head: number }
  | { t: 'text-caret'; seq: number; session: number; textGen: number; base: number; anchor: number; head: number }
  // editingText lo pone el host.
  | { t: 'presence'; state: PresenceState }
  // Devuelve el crédito: el principal ya aplicó el lote anterior.
  | { t: 'consumed' }
  | { t: 'ping'; id: number };

export type RemoteCaret = { clientId: number; anchor: number; head: number; color: string; name: string };

// Estado de la sesión de texto abierta, en índices absolutos del texto del host.
export type TextSessionState = {
  session: number;
  id: string;
  textGen: number;
  value: string;
  rseq: number;
  anchor: number;
  head: number;
  carets: RemoteCaret[];
};

export type FastPatch = { ids: string[]; masks: Uint8Array; values: Float64Array };

export type PresenceDelta = { set: Array<[clientId: number, state: PresenceState]>; removed: number[] };

export type DocBatch = {
  t: 'batch';
  gen: number;
  // Último seq procesado: el lote ya refleja todo lo anterior.
  applied: number;
  // Primer lote de la generación: sustituye el espejo entero.
  full?: true;
  // Incluye transacciones locales (ops, deshacer, rehacer, texto).
  local?: true;
  synced?: boolean;
  fast?: FastPatch;
  keys?: Array<{ id: string; set: Record<string, unknown>; unset: string[] }>;
  set?: NodeRecord[];
  del?: string[];
  texts?: Array<[id: string, content: string | null]>;
  pages?: PageRecord[];
  meta?: Meta | null;
  // Animaciones cambiadas, ya validadas (null: no existe o no es válida).
  animations?: Array<[id: string, animation: Animation | null]>;
  history?: { canUndo: boolean; canRedo: boolean };
  restoreSelection?: string[];
  presence?: PresenceDelta;
  text?: TextSessionState;
  invalid: number;
};

// Respuesta a un ping: no pasa por el crédito.
export type HostPong = { t: 'pong'; id: number };

export type OpenParams = {
  gen: number;
  url: string;
  documentName: string;
  userId: string;
  projectId: string;
  epoch: number;
  role: ProjectRole;
  useLocal: boolean;
  // Solo en reset: el documento que se descarta se guarda como JSON para «Descargar tu copia local».
  keepDiscarded?: boolean;
};

// Qué copia local se pide: el documento abierto o el último descartado por un epoch nuevo.
export type LocalSnapshotSource = 'current' | 'discarded';

export type MainToCollab =
  | ({ t: 'open' } & OpenParams)
  | ({ t: 'reset' } & OpenParams)
  | { t: 'token'; id: number; token: string }
  | { t: 'token'; id: number; error: 'fetch_failed' | 'epoch_changed' }
  | { t: 'reconnect' }
  | { t: 'stop' }
  | { t: 'pagehide' }
  | { t: 'local-snapshot'; id: number; source: LocalSnapshotSource }
  | { t: 'destroy' };

export type CollabToMain =
  | { t: 'booted' }
  | { t: 'token-request'; id: number }
  | { t: 'authenticated'; scope: 'read-write' | 'readonly'; unsynced: number }
  | { t: 'auth-failed'; reason: string }
  | { t: 'status'; status: 'connecting' | 'connected' | 'disconnected' }
  | { t: 'close'; code: number; reason: string }
  | { t: 'stateless'; payload: string }
  | { t: 'unsynced'; number: number }
  | { t: 'local-copy'; gen: number; enabled: boolean; lostUnsynced: boolean }
  | { t: 'local-snapshot'; id: number; data: DocumentJson | null }
  | { t: 'destroyed' }
  | { t: 'fatal'; message: string };

export type WorkerMessage = MainToHost | MainToCollab;
export type MainMessage = DocBatch | HostPong | CollabToMain;

export type FastEntry = { id: string; mask: number; values: ArrayLike<unknown> };

// Empaqueta los parches rápidos en dos buffers transferibles: una máscara por id y los valores de sus bits activos,
// en el orden de FAST_KEYS (los booleanos como 0/1). `values[i]` de cada entrada es el valor de FAST_KEYS[i].
export function packFast(entries: readonly FastEntry[]): FastPatch {
  let count = 0;
  for (const entry of entries) for (let i = 0; i < FAST_KEYS.length; i++) if (entry.mask & (1 << i)) count++;
  const ids: string[] = new Array(entries.length);
  const masks = new Uint8Array(entries.length);
  const values = new Float64Array(count);
  let at = 0;
  entries.forEach((entry, n) => {
    ids[n] = entry.id;
    masks[n] = entry.mask;
    for (let i = 0; i < FAST_KEYS.length; i++) {
      if ((entry.mask & (1 << i)) === 0) continue;
      const value = entry.values[i];
      values[at++] = typeof value === 'boolean' ? (value ? 1 : 0) : (value as number);
    }
  });
  return { ids, masks, values };
}

// Recorre lo empaquetado. `values[i]` es el valor de FAST_KEYS[i] si su bit está en `mask`; el array se reutiliza
// entre llamadas.
export function unpackFast(fast: FastPatch, visit: (id: string, mask: number, values: readonly unknown[]) => void): void {
  const scratch: unknown[] = new Array(FAST_KEYS.length);
  let at = 0;
  for (let n = 0; n < fast.ids.length; n++) {
    const mask = fast.masks[n]!;
    for (let i = 0; i < FAST_KEYS.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const value = fast.values[at++]!;
      scratch[i] = FAST_BOOLEAN[i] ? value !== 0 : value;
    }
    visit(fast.ids[n]!, mask, scratch);
  }
}

export function transferOf(batch: DocBatch): Transferable[] {
  return batch.fast ? [batch.fast.masks.buffer, batch.fast.values.buffer] : [];
}
