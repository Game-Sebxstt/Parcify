import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { PresenceStateSchema, ROOT_KEYS, type PresenceState } from '../../../shared/document/keys.js';
import { ANIMATION_LIMITS } from '../../../shared/document/limits.js';
import { AI_ORIGIN, LOCAL_ORIGIN } from '../../origins.ts';
import { createThrottle, realTimers, type Throttle, type Timers } from '../../presence/throttle.ts';
import { transferOf, type DocBatch, type DocOp, type HostPong, type MainToHost, type TextSessionState } from '../protocol.ts';
import { HostHistory } from './HostHistory.ts';
import { Materializer } from './Materializer.ts';
import { TextSession } from './TextSession.ts';

type Logger = Pick<Console, 'warn' | 'error' | 'debug'>;

export const EDITING_INTERVAL_MS = 1000 / 30;

export type HostOptions = {
  gen?: number;
  logger?: Logger;
  timers?: Timers;
  // Con `post`, el host manda los lotes él mismo con un crédito de 1 (worker). Sin él, quien lo usa los pide con
  // take() cuando onPending avisa (modo directo).
  post?: (batch: DocBatch, transfer: Transferable[]) => void;
  reply?: (message: HostPong) => void;
  onPending?: () => void;
};

// Único escritor del Y.Doc: aplica las ops del hilo principal (una transacción por mensaje), lleva el historial,
// la sesión de texto y la Awareness propia, y junta lo cambiado en lotes. Cada seq procesado se acusa en un lote,
// aunque no cambie nada.
export class DocHost {
  readonly gen: number;
  private readonly materializer: Materializer;
  private readonly history: HostHistory;
  private readonly logger: Logger;
  private readonly timers: Timers;
  private readonly post: HostOptions['post'];
  private readonly reply: HostOptions['reply'];
  // Modo directo: hay algo que pedir con take().
  onPending: () => void;
  private readonly nodes: Y.Map<unknown>;
  private readonly texts: Y.Map<unknown>;
  private readonly pages: Y.Map<unknown>;
  private readonly animations: Y.Map<unknown>;
  private awareness: Awareness | null = null;
  private credit = 1;
  private flushQueued = false;
  private applied = 0;
  private appliedSent = 0;
  private syncedPending: boolean | undefined;
  private localPending = false;
  private historyState: { canUndo: boolean; canRedo: boolean } | null = null;
  private restoreSelection: string[] | null = null;
  private readonly presenceSet = new Map<number, PresenceState>();
  private readonly presenceRemoved = new Set<number>();
  private readonly remotes = new Map<number, PresenceState>();
  private textDirty = false;
  private text: TextSession | null = null;
  private mainState: PresenceState | null = null;
  private editing: PresenceState['editingText'] = null;
  private readonly editingThrottle: Throttle;
  private readOnlyWarned = false;
  private destroyed = false;
  readOnly = false;

  constructor(
    readonly doc: Y.Doc,
    awareness: Awareness | null,
    options: HostOptions = {},
  ) {
    this.gen = options.gen ?? 1;
    this.logger = options.logger ?? console;
    this.timers = options.timers ?? realTimers;
    this.post = options.post;
    this.reply = options.reply;
    this.onPending = options.onPending ?? (() => {});
    this.nodes = doc.getMap(ROOT_KEYS.nodes);
    this.texts = doc.getMap(ROOT_KEYS.texts);
    this.pages = doc.getMap(ROOT_KEYS.pages);
    this.animations = doc.getMap(ROOT_KEYS.animations);
    this.materializer = new Materializer(doc, () => this.pending(), this.logger);
    this.history = new HostHistory(
      doc,
      (state) => {
        this.historyState = state;
        this.pending();
      },
      (selection) => {
        this.restoreSelection = selection;
      },
    );
    this.editingThrottle = createThrottle(() => this.publish(), EDITING_INTERVAL_MS, this.timers);
    doc.on('afterTransaction', this.onTransaction);
    this.setAwareness(awareness);
    this.pending();
  }

  private readonly onTransaction = (transaction: Y.Transaction) => {
    if (transaction.local && transaction.changed.size > 0) this.localPending = true;
  };

  // El proveedor cambia de Awareness al reconectar: se pasa el estado propio a la nueva.
  setAwareness(awareness: Awareness | null): void {
    if (this.awareness === awareness) return;
    this.awareness?.off('change', this.onAwareness);
    for (const clientId of this.remotes.keys()) this.removeRemote(clientId);
    this.awareness = awareness;
    if (!awareness) return;
    awareness.on('change', this.onAwareness);
    for (const clientId of awareness.getStates().keys()) if (clientId !== awareness.clientID) this.readRemote(clientId);
    this.publish();
    this.pending();
  }

  setSynced(synced: boolean): void {
    this.syncedPending = synced;
    this.pending();
  }

  // ── Mensajes del principal ──

  handle(message: MainToHost): void {
    if (this.destroyed) return;
    switch (message.t) {
      case 'ops':
        this.applyOps(message);
        this.ack(message.seq);
        return;
      case 'step-after':
        this.history.setSelectionAfter(message.selection);
        return;
      case 'undo':
      case 'redo':
        if (!this.readOnly) {
          if (message.t === 'undo') this.history.undo(message.selection);
          else this.history.redo(message.selection);
        }
        this.ack(message.seq);
        return;
      case 'text-open':
        this.openText(message);
        return;
      case 'text-close':
        if (this.text?.session === message.session) this.closeText();
        return;
      case 'text-edit':
        if (this.text?.session === message.session && !this.readOnly) this.text.edit(message);
        else this.logger.debug('Edición de texto descartada: sesión cerrada.');
        this.ack(message.seq);
        return;
      case 'text-caret':
        if (this.text?.session === message.session) this.text.caret(message);
        this.ack(message.seq);
        return;
      case 'presence': {
        const page = this.mainState?.pageId;
        this.mainState = message.state;
        this.publish();
        if (this.text && page !== message.state.pageId) this.textChanged();
        return;
      }
      case 'consumed':
        this.credit = 1;
        this.scheduleFlush();
        return;
      case 'ping':
        this.reply?.({ t: 'pong', id: message.id });
        return;
      default:
        this.logger.warn(`Mensaje desconocido para el documento: ${(message as { t?: unknown }).t}`);
    }
  }

  private ack(seq: number): void {
    if (seq > this.applied) this.applied = seq;
    this.pending();
  }

  private applyOps(message: Extract<MainToHost, { t: 'ops' }>): void {
    if (this.readOnly) {
      if (!this.readOnlyWarned) {
        this.readOnlyWarned = true;
        this.logger.warn('Cambios descartados: el documento es de solo lectura.');
      }
      return;
    }
    if (message.step === 'new') this.history.begin(message.selection);
    else this.history.setSelection(message.selection);
    const origin = message.origin === 'ai' ? AI_ORIGIN : LOCAL_ORIGIN;
    let current: DocOp | null = null;
    try {
      this.doc.transact(() => {
        for (const op of message.ops) {
          current = op;
          this.applyOp(op);
        }
      }, origin);
    } catch (error) {
      this.logger.error(`No se pudo aplicar la operación ${(current as DocOp | null)?.k ?? '?'}`, error instanceof Error ? error.message : error);
    }
  }

  private applyOp(op: DocOp): void {
    switch (op.k) {
      case 'node.set': {
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(op.record)) if (value !== undefined) map.set(key, value);
        this.nodes.set(op.record.id, map);
        return;
      }
      case 'node.patch': {
        const map = this.nodes.get(op.id);
        if (!(map instanceof Y.Map)) return;
        // Solo se escriben las claves que cambian: reescribir valores iguales hace crecer el documento.
        for (const [key, value] of Object.entries(op.set)) {
          if (value === undefined) {
            if (map.has(key)) map.delete(key);
            continue;
          }
          const current = map.get(key);
          if (current === value) continue;
          if (typeof value === 'object' && value !== null && JSON.stringify(current) === JSON.stringify(value)) continue;
          map.set(key, value);
        }
        for (const key of op.unset ?? []) if (map.has(key)) map.delete(key);
        return;
      }
      case 'node.delete':
        if (this.nodes.has(op.id)) this.nodes.delete(op.id);
        return;
      case 'text.set':
        this.texts.set(op.id, new Y.Text(op.content));
        return;
      case 'text.delete':
        if (this.texts.has(op.id)) this.texts.delete(op.id);
        return;
      case 'page.set': {
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(op.page)) if (value !== undefined) map.set(key, value);
        this.pages.set(op.id, map);
        return;
      }
      case 'page.patch': {
        const map = this.pages.get(op.id);
        if (!(map instanceof Y.Map)) return;
        for (const [key, value] of Object.entries(op.set)) if (value !== undefined && map.get(key) !== value) map.set(key, value);
        return;
      }
      case 'page.delete':
        if (this.pages.has(op.id)) this.pages.delete(op.id);
        return;
      case 'animation.delete':
        if (this.animations.has(op.id)) this.animations.delete(op.id);
        return;
      case 'animation.ensure': {
        // Un nodo borrado en remoto no recibe animación.
        if (this.animations.get(op.id) instanceof Y.Map || !this.nodes.has(op.id)) return;
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(op.settings)) if (value !== undefined) map.set(key, value);
        map.set('tracks', new Y.Map<unknown>());
        this.animations.set(op.id, map);
        return;
      }
      case 'animation.patch': {
        const map = this.animations.get(op.id);
        if (!(map instanceof Y.Map)) return;
        for (const [key, value] of Object.entries(op.set)) if (value !== undefined && map.get(key) !== value) map.set(key, value);
        return;
      }
      case 'keyframe.set': {
        const map = this.animations.get(op.id);
        if (!(map instanceof Y.Map)) return;
        let tracks = map.get('tracks');
        if (!(tracks instanceof Y.Map)) {
          tracks = new Y.Map<unknown>();
          map.set('tracks', tracks);
        }
        const tracksMap = tracks as Y.Map<unknown>;
        let track = tracksMap.get(op.prop);
        if (!(track instanceof Y.Map)) {
          track = new Y.Map<unknown>();
          tracksMap.set(op.prop, track);
        }
        const keyframes = track as Y.Map<unknown>;
        if (!keyframes.has(op.key) && keyframes.size >= ANIMATION_LIMITS.maxKeyframesPerTrack) return;
        if (JSON.stringify(keyframes.get(op.key)) === JSON.stringify(op.keyframe)) return;
        keyframes.set(op.key, { t: op.keyframe.t, v: op.keyframe.v, e: op.keyframe.e });
        return;
      }
      case 'keyframe.delete': {
        const map = this.animations.get(op.id);
        const tracks = map instanceof Y.Map ? map.get('tracks') : undefined;
        const track = tracks instanceof Y.Map ? tracks.get(op.prop) : undefined;
        if (track instanceof Y.Map && track.has(op.key)) track.delete(op.key);
        return;
      }
    }
  }

  // ── Texto ──

  private openText(message: Extract<MainToHost, { t: 'text-open' }>): void {
    this.closeText();
    this.history.begin(message.selection);
    this.text = new TextSession(this.doc, message.session, message.id, message.value, () => this.textChanged(), this.logger);
    this.textChanged();
  }

  private closeText(): void {
    if (!this.text) return;
    this.text.close();
    this.text = null;
    this.editing = null;
    this.editingThrottle.cancel();
    this.publish();
  }

  private textChanged(): void {
    this.textDirty = true;
    const editing = this.text?.editing() ?? null;
    if (editing?.anchor !== this.editing?.anchor || editing?.head !== this.editing?.head || editing?.nodeId !== this.editing?.nodeId) {
      this.editing = editing;
      this.editingThrottle.schedule();
    }
    this.pending();
  }

  // ── Presencia ──

  private publish(): void {
    if (!this.awareness || !this.mainState || this.destroyed) return;
    this.awareness.setLocalState({ ...this.mainState, editingText: this.editing });
  }

  private readonly onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const own = this.awareness?.clientID;
    const id = this.text?.id;
    let carets = false;
    const editingHere = (clientId: number) => id !== undefined && this.remotes.get(clientId)?.editingText?.nodeId === id;
    for (const clientId of [...added, ...updated]) {
      if (clientId === own) continue;
      carets ||= editingHere(clientId);
      this.readRemote(clientId);
      carets ||= editingHere(clientId);
    }
    for (const clientId of removed) {
      carets ||= editingHere(clientId);
      this.removeRemote(clientId);
    }
    if (carets) this.textDirty = true;
    this.pending();
  };

  // Un estado remoto inválido se trata como «se fue».
  private readRemote(clientId: number): void {
    const parsed = PresenceStateSchema.safeParse(this.awareness?.getStates().get(clientId));
    if (!parsed.success) {
      this.removeRemote(clientId);
      return;
    }
    this.remotes.set(clientId, parsed.data);
    this.presenceSet.set(clientId, parsed.data);
    this.presenceRemoved.delete(clientId);
  }

  private removeRemote(clientId: number): void {
    if (!this.remotes.delete(clientId)) return;
    this.presenceSet.delete(clientId);
    this.presenceRemoved.add(clientId);
  }

  // ── Lotes ──

  private hasSomethingToSend(): boolean {
    return (
      this.materializer.hasPending ||
      this.applied > this.appliedSent ||
      this.syncedPending !== undefined ||
      this.presenceSet.size > 0 ||
      this.presenceRemoved.size > 0 ||
      this.historyState !== null ||
      this.restoreSelection !== null ||
      this.textDirty
    );
  }

  private pending(): void {
    if (this.destroyed) return;
    if (this.post) this.scheduleFlush();
    else if (this.hasSomethingToSend()) this.onPending();
  }

  private scheduleFlush(): void {
    if (this.credit === 0 || this.flushQueued || this.destroyed || !this.hasSomethingToSend()) return;
    this.flushQueued = true;
    // Las transacciones de un mismo mensaje del WebSocket van juntas.
    queueMicrotask(() => {
      this.flushQueued = false;
      if (this.credit === 0 || this.destroyed) return;
      const batch = this.take();
      if (!batch) return;
      this.credit = 0;
      this.post!(batch, transferOf(batch));
    });
  }

  // El lote con lo pendiente, o null si no hay nada que mandar.
  take(): DocBatch | null {
    if (this.destroyed || !this.hasSomethingToSend()) return null;
    const changes = this.materializer.take();
    const batch: DocBatch = { t: 'batch', gen: this.gen, applied: this.applied, invalid: this.materializer.invalidCount, ...changes };
    this.appliedSent = this.applied;
    if (this.localPending) batch.local = true;
    this.localPending = false;
    if (this.syncedPending !== undefined) batch.synced = this.syncedPending;
    this.syncedPending = undefined;
    if (batch.full || this.historyState) batch.history = this.historyState ?? { canUndo: this.history.canUndo, canRedo: this.history.canRedo };
    this.historyState = null;
    if (this.restoreSelection) batch.restoreSelection = this.restoreSelection;
    this.restoreSelection = null;
    if (batch.full) {
      this.presenceSet.clear();
      for (const [clientId, state] of this.remotes) this.presenceSet.set(clientId, state);
      this.presenceRemoved.clear();
    }
    if (this.presenceSet.size || this.presenceRemoved.size) {
      batch.presence = { set: [...this.presenceSet], removed: [...this.presenceRemoved] };
      this.presenceSet.clear();
      this.presenceRemoved.clear();
    }
    if (this.textDirty) {
      const state = this.textState();
      if (state) batch.text = state;
      this.textDirty = false;
    }
    return batch;
  }

  private textState(): TextSessionState | null {
    return this.text?.state(this.remotes, this.mainState?.pageId ?? '') ?? null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.closeText();
    this.destroyed = true;
    this.editingThrottle.cancel();
    this.awareness?.off('change', this.onAwareness);
    this.doc.off('afterTransaction', this.onTransaction);
    this.history.destroy();
    this.materializer.destroy();
  }
}
