import type { PresenceState } from '../../shared/document/keys.js';
import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import type { PresenceDelta } from '../doc/protocol.ts';
import type { Mat } from '../geometry/matrix.ts';
import type { Box } from '../types.ts';
import { createThrottle, realTimers, type Throttle, type Timers } from './throttle.ts';

export const PRESENCE_INTERVAL_MS = 1000 / 30;

export type PresenceUser = PresenceState['user'];
export type GestureStyle = NonNullable<NonNullable<PresenceState['gesture']>['style']>;

// Por encima de 500 ids la selección viaja como caja: así el estado siempre cabe en el límite de Awareness.
export function selectionFields(ids: readonly string[], box: Box | null): Pick<PresenceState, 'selection' | 'selectionBox'> {
  if (ids.length > DOCUMENT_LIMITS.maxSelectionIds) return { selection: [], selectionBox: box };
  return { selection: [...ids], selectionBox: null };
}

export function gestureIds(ids: readonly string[], selection: readonly string[]): 'selection' | string[] {
  if (ids.length > DOCUMENT_LIMITS.maxSelectionIds) return 'selection';
  if (ids.length === selection.length && ids.every((id, i) => id === selection[i])) return 'selection';
  return [...ids];
}

export type RemotePresence = { clientId: number; state: PresenceState };

// Manda el estado local al host con throttle de 30 Hz (una sola actualización por intervalo); el host lo escribe en
// la Awareness con su editingText. Los remotos llegan ya validados en los lotes.
export class Presence {
  private readonly local: PresenceState;
  private readonly throttle: Throttle;
  private readonly remotes = new Map<number, PresenceState>();
  private readonly listeners = new Set<() => void>();
  private destroyed = false;
  sent = 0;

  constructor(
    private readonly channel: ((state: PresenceState) => void) | null,
    user: PresenceUser,
    pageId: string,
    timers: Timers = realTimers,
  ) {
    this.local = {
      user,
      pageId,
      cursor: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: [],
      selectionBox: null,
      marquee: null,
      gesture: null,
      editingText: null,
      chatTyping: false,
      aiBusy: false,
    };
    this.throttle = createThrottle(() => this.send(), PRESENCE_INTERVAL_MS, timers);
    if (channel) this.send();
  }

  get state(): Readonly<PresenceState> {
    return this.local;
  }

  update(patch: Partial<PresenceState>): void {
    if (this.destroyed) return;
    Object.assign(this.local, patch);
    this.throttle.schedule();
  }

  setSelection(ids: readonly string[], box: Box | null): void {
    this.update(selectionFields(ids, box));
  }

  setGesture(ids: readonly string[] | null, matrix: Mat | null, style?: GestureStyle): void {
    if (!ids || !matrix) {
      this.update({ gesture: null });
      return;
    }
    const gesture: NonNullable<PresenceState['gesture']> = { ids: gestureIds(ids, this.local.selection), matrix: [...matrix] as Mat };
    if (style) gesture.style = style;
    this.update({ gesture });
  }

  flush(): void {
    this.throttle.flush();
  }

  private send(): void {
    if (!this.channel || this.destroyed) return;
    this.sent++;
    this.channel({ ...this.local });
  }

  // Lo que trae un lote: el último estado de cada cliente que cambió y los que se fueron.
  receive(delta: PresenceDelta): void {
    if (this.destroyed) return;
    for (const [clientId, state] of delta.set) this.remotes.set(clientId, state);
    for (const clientId of delta.removed) this.remotes.delete(clientId);
    if (delta.set.length || delta.removed.length) for (const listener of this.listeners) listener();
  }

  onRemoteChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  remote(): ReadonlyMap<number, PresenceState> {
    return this.remotes;
  }

  destroy(): void {
    this.throttle.cancel();
    this.destroyed = true;
    this.listeners.clear();
  }
}
