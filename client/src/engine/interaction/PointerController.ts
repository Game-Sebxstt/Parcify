import { newConnector, newFrame, newLine, newShape, DEFAULT_SIZE } from '../commands/defaults.ts';
import type { EditorCore, Tool } from '../EditorCore.ts';
import { isAnchorable, SNAP_THRESHOLD_PX } from '../EditorCore.ts';
import { localMatrix } from '../geometry/bounds.ts';
import { anchorAt, routeEnd, routeStart, type ConnectorEnd } from '../geometry/connectors.ts';
import { apply, compose, invert, rotateAround, rotation, scaling, translation, type Mat, type Point } from '../geometry/matrix.ts';
import { snapBox, type SnapCandidates } from '../geometry/snapping.ts';
import { snapRotation, toDeg, toRad } from '../geometry/angles.ts';
import { expandQuad, HANDLE_SIDES, hitHandle, insideQuad, resizeCursor, type SelectionFrame } from '../overlay/handles.ts';
import type { HandleKind } from '../render/sink.ts';
import { Store } from '../store.ts';
import { containsAABB, type AABB, type BasicShapeType, type LineRecord } from '../types.ts';
import type { InputProfile, PointerKind } from './input/profile.ts';
import { findShortcut, type KeyInput } from './shortcuts.ts';

export type PointerInput = {
  x: number;
  y: number;
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  pointerId: number;
  pointerType: PointerKind;
  pressure: number;
};

export type PointerState = 'idle' | 'pressing' | 'dragging' | 'marquee' | 'resizing' | 'rotating' | 'creating' | 'panning' | 'point';

// viaBox: se pulsó en un hueco dentro de la caja de la selección; arrastrar mueve la selección y un clic es un clic en vacío.
type PressTarget =
  | { kind: 'node'; id: string; wasSelected: boolean; viaBox?: boolean }
  | { kind: 'empty'; base: readonly string[] }
  | { kind: 'handle'; handle: HandleKind; frame: SelectionFrame }
  | { kind: 'rotate'; frame: SelectionFrame }
  | { kind: 'point'; id: string; index: number }
  | { kind: 'create'; tool: Tool }
  | { kind: 'pan' };

export type PressKind = PressTarget['kind'];

// A menos de esta distancia de pantalla, el extremo de un conector se pega al ancla con nombre más cercana.
export const ANCHOR_SNAP_PX = 12;
const SHAPE_TOOLS = new Set<Tool>(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc']);

// Máquina de estados del puntero: idle → pressing → (dragging | marquee | resizing | rotating | creating | panning | point) → idle.
// Los pointermove solo guardan la última posición; el trabajo se hace una vez por frame en flush().
export class PointerController {
  state: PointerState = 'idle';
  readonly cursor = new Store('default');
  private down: PointerInput | null = null;
  private latest: PointerInput | null = null;
  private moved = false;
  private target: PressTarget | null = null;
  private spaceHeld = false;
  private lastPan: Point | null = null;
  private moveIds: string[] = [];
  private startBox: AABB | null = null;
  private candidates: SnapCandidates | null = null;
  private candidatesCamera = -1;
  private matrix: Mat | null = null;
  private pointPreview: Array<[number, number]> | null = null;
  private endPreview: { which: 'from' | 'to'; end: ConnectorEnd } | null = null;
  private startAngle = 0;
  // id null: el clic fue en vacío (o en el hueco de la selección).
  private lastClick: { id: string | null; x: number; y: number; time: number } | null = null;
  // Con el dedo, la selección que dejaría la pulsación se aplica al pasar el umbral o al soltar, no al tocar.
  private pendingSelect: string[] | null = null;

  constructor(private readonly core: EditorCore) {}

  private get tool(): Tool {
    return this.core.tool.get();
  }

  private get profile(): Readonly<InputProfile> {
    return this.core.inputProfile.get();
  }

  // Qué se ha pulsado en el gesto en curso (null sin gesto).
  get pressKind(): PressKind | null {
    return this.target?.kind ?? null;
  }

  private get readOnly(): boolean {
    return this.core.readOnly.get();
  }

  private world(input: { x: number; y: number }): Point {
    return this.core.camera.screenToWorld(input.x, input.y);
  }

  // ── Entradas ──

  pointerDown(input: PointerInput): void {
    if (this.state !== 'idle') this.cancel();
    this.down = input;
    this.latest = input;
    this.moved = false;

    if (input.button === 1 || this.spaceHeld || this.tool === 'hand') {
      this.core.stopFollowing();
      this.core.markUserCamera();
      this.target = { kind: 'pan' };
      this.state = 'panning';
      this.lastPan = { x: input.x, y: input.y };
      this.cursor.set('grabbing');
      return;
    }
    if (input.button !== 0) {
      this.down = null;
      return;
    }

    if (this.tool !== 'select') {
      if (this.readOnly) return;
      this.target = { kind: 'create', tool: this.tool };
      this.state = 'pressing';
      return;
    }

    const handle = this.handleAt(input.x, input.y);
    if (handle) {
      this.target = handle;
      this.state = 'pressing';
      return;
    }

    const hit = this.core.pick(input.x, input.y, { includeLocked: input.alt });
    const selection = this.core.selection.get();
    const gap = !input.shift && !input.ctrl && (!hit || this.isBackdrop(hit, selection)) && this.insideSelectionBox(input.x, input.y, selection);
    if (gap) {
      this.target = { kind: 'node', id: selection[0]!, wasSelected: true, viaBox: true };
    } else if (hit) {
      const wasSelected = selection.includes(hit);
      if (input.shift) {
        this.select(wasSelected ? selection.filter((id) => id !== hit) : [...selection, hit]);
      } else if (!wasSelected) {
        this.select([hit]);
      }
      this.target = { kind: 'node', id: hit, wasSelected };
    } else {
      if (!input.shift) this.select([]);
      this.target = { kind: 'empty', base: input.shift ? selection : [] };
    }
    this.state = 'pressing';
  }

  private select(ids: string[]): void {
    if (this.profile.deferSelection) this.pendingSelect = ids;
    else this.core.setSelection(ids);
  }

  private applyPendingSelection(): void {
    const ids = this.pendingSelect;
    this.pendingSelect = null;
    if (ids) this.core.setSelection(ids);
  }

  // Un frame no seleccionado que envuelve la selección (la contiene o es padre de alguno de sus nodos) hace de fondo:
  // tocarlo dentro de la caja de la selección cuenta como tocar un hueco.
  private isBackdrop(id: string, selection: readonly string[]): boolean {
    if (selection.includes(id) || this.core.record(id)?.type !== 'frame') return false;
    if (selection.some((selected) => this.core.tree.isDescendant(selected, id))) return true;
    return containsAABB(this.core.boundsOf([id]), this.core.boundsOf(selection));
  }

  // Varios nodos (o un grupo): un hueco dentro de su caja, más un margen, cuenta como la selección.
  private insideSelectionBox(x: number, y: number, selection: readonly string[]): boolean {
    const multiple = selection.length >= 2 || (selection.length === 1 && this.core.record(selection[0]!)?.type === 'group');
    if (!multiple) return false;
    const frame = this.core.selectionFrame(selection);
    if (!frame) return false;
    return insideQuad(expandQuad(this.core.screenCorners(frame), this.profile.boxSlop), x, y);
  }

  pointerMove(input: PointerInput): void {
    this.latest = input;
    this.moved = true;
    const world = this.world(input);
    this.core.presence.update({ cursor: { x: world.x, y: world.y } });
    this.core.requestFrame();
  }

  pointerUp(input: PointerInput): void {
    this.latest = input;
    this.moved = true;
    this.flush();
    const target = this.target;
    switch (this.state) {
      case 'pressing':
        this.applyPendingSelection();
        this.click(target, input);
        break;
      case 'dragging':
      case 'resizing':
      case 'rotating':
        if (this.matrix && this.moveIds.length) {
          const drop = this.state === 'dragging' ? this.world(input) : undefined;
          this.core.commands.commitTransform(this.moveIds, this.matrix, drop ? { drop } : {});
        }
        this.core.setGesture(null);
        break;
      case 'marquee':
        this.core.setMarquee(null);
        break;
      case 'creating':
        this.finishCreate(input);
        break;
      case 'point':
        if (target?.kind === 'point' && this.pointPreview) this.core.commands.setLinePoints(target.id, this.pointPreview);
        if (target?.kind === 'point' && this.endPreview) this.core.commands.setConnectorEnd(target.id, this.endPreview.which, this.endPreview.end);
        this.core.setStylePreview(null);
        break;
    }
    this.reset();
  }

  // El puntero sale del lienzo sin botones: se descarta el último movimiento pendiente, que si no volvería a marcar
  // el hover en el frame siguiente.
  pointerLeave(): void {
    if (this.state !== 'idle') return;
    this.moved = false;
    this.latest = null;
    this.core.setHover(null);
  }

  // Quita las vistas previas del gesto sin escribir nada en el documento.
  cancel(): void {
    if (this.state === 'dragging' || this.state === 'resizing' || this.state === 'rotating') this.core.setGesture(null);
    if (this.state === 'marquee') this.core.setMarquee(null);
    if (this.state === 'creating') this.core.setCreating(null);
    if (this.state === 'point') this.core.setStylePreview(null);
    this.reset();
  }

  private reset(): void {
    this.state = 'idle';
    this.down = null;
    this.target = null;
    this.matrix = null;
    this.moveIds = [];
    this.startBox = null;
    this.candidates = null;
    this.pointPreview = null;
    this.endPreview = null;
    this.lastPan = null;
    this.pendingSelect = null;
    this.cursor.set(this.idleCursor());
  }

  // Clic derecho: lo que hay debajo pasa a ser la selección (si no lo era ya) y el menú actúa sobre ella. En vacío,
  // la selección se vacía. Devuelve el punto de la página donde se abrió.
  contextMenu(input: { x: number; y: number }): Point {
    if (this.state !== 'idle') this.cancel();
    const world = this.world(input);
    if (this.tool !== 'select') this.core.commands.setTool('select');
    const hit = this.core.pick(input.x, input.y, { includeLocked: true });
    const selection = this.core.selection.get();
    if (!hit) this.core.setSelection([]);
    else if (!selection.includes(hit)) this.core.setSelection([hit]);
    return world;
  }

  // Devuelve true si la tecla se ha usado (para evitar la acción por defecto del navegador).
  keyDown(input: KeyInput): boolean {
    if (input.key === ' ') {
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        if (this.state === 'idle') this.cursor.set('grab');
      }
      return true;
    }
    if (input.key === 'Escape') {
      if (this.state !== 'idle') {
        this.cancel();
        return true;
      }
      if (this.tool !== 'select') {
        this.core.commands.setTool('select');
        return true;
      }
    }
    const shortcut = findShortcut(input);
    if (!shortcut) return false;
    if (shortcut.edit && this.readOnly) return true;
    if (this.state !== 'idle' && shortcut.edit) return true;
    shortcut.run(this.core.commands);
    return true;
  }

  keyUp(input: KeyInput): void {
    if (input.key === ' ') {
      this.spaceHeld = false;
      if (this.state === 'idle') this.cursor.set(this.idleCursor());
    }
  }

  blur(): void {
    this.spaceHeld = false;
    if (this.state !== 'idle') this.cancel();
  }

  private idleCursor(): string {
    if (this.spaceHeld || this.tool === 'hand') return 'grab';
    if (this.tool !== 'select') return 'crosshair';
    return 'default';
  }

  // ── Trabajo por frame ──

  flush(): void {
    const input = this.latest;
    if (!input || !this.moved) return;
    this.moved = false;
    switch (this.state) {
      case 'idle':
        this.updateHover(input);
        return;
      case 'pressing':
        if (!this.down || Math.hypot(input.x - this.down.x, input.y - this.down.y) < this.profile.dragThreshold) return;
        this.applyPendingSelection();
        this.start();
        this.continue(input);
        return;
      default:
        this.continue(input);
    }
  }

  private updateHover(input: PointerInput): void {
    if (this.tool !== 'select' || this.spaceHeld) {
      this.core.setHover(null);
      this.cursor.set(this.idleCursor());
      return;
    }
    const handle = this.handleAt(input.x, input.y);
    if (handle?.kind === 'handle') this.cursor.set(resizeCursor(handle.handle, handle.frame.angle));
    else if (handle?.kind === 'rotate') this.cursor.set('grab');
    else if (handle?.kind === 'point') this.cursor.set('move');
    else this.cursor.set('default');
    this.core.setHover(handle ? null : this.core.pick(input.x, input.y));
  }

  private handleAt(x: number, y: number): PressTarget | null {
    const ids = this.core.selection.get();
    if (!ids.length || this.readOnly || this.core.anyLocked(ids)) return null;
    const profile = this.profile;
    const half = profile.handleHit / 2;
    if (ids.length === 1) {
      const record = this.core.renderable(ids[0]!);
      if (record?.type === 'line') {
        const world = this.core.worldMatrix(record);
        for (let i = 0; i < record.points.length; i++) {
          const [px, py] = record.points[i]!;
          const p = apply(world, px, py);
          const s = this.core.camera.worldToScreen(p.x, p.y);
          if (Math.abs(s.x - x) <= half && Math.abs(s.y - y) <= half) return { kind: 'point', id: record.id, index: i };
        }
        return null;
      }
      if (record?.type === 'connector') {
        const route = this.core.routeOf(record.id);
        if (!route || route.length < 4) return null;
        const ends = [routeStart(route), routeEnd(route)];
        for (let i = 0; i < ends.length; i++) {
          const s = this.core.camera.worldToScreen(ends[i]!.x, ends[i]!.y);
          if (Math.abs(s.x - x) <= half && Math.abs(s.y - y) <= half) return { kind: 'point', id: record.id, index: i };
        }
        return null;
      }
    }
    const frame = this.core.selectionFrame(ids);
    if (!frame) return null;
    const hit = hitHandle(this.core.screenCorners(frame), x, y, profile);
    if (!hit) return null;
    if (hit.kind === 'rotate') return { kind: 'rotate', frame };
    return { kind: 'handle', handle: hit.kind, frame };
  }

  private start(): void {
    const target = this.target;
    if (!target) return;
    switch (target.kind) {
      case 'node': {
        const ids = this.core.selection.get().filter((id) => !this.core.isLocked(id));
        if (this.readOnly || !ids.length) {
          this.state = 'idle';
          this.target = null;
          return;
        }
        this.state = 'dragging';
        this.moveIds = [...ids];
        this.startBox = this.core.boundsOf(ids);
        this.buildCandidates();
        this.cursor.set('default');
        return;
      }
      case 'empty':
        this.state = 'marquee';
        return;
      case 'handle':
        this.state = 'resizing';
        this.moveIds = [...this.core.selection.get()];
        return;
      case 'rotate':
        this.state = 'rotating';
        this.moveIds = [...this.core.selection.get()];
        this.startAngle = this.angleFrom(target.frame, this.world(this.down!));
        this.cursor.set('grabbing');
        return;
      case 'point':
        this.state = 'point';
        return;
      case 'create':
        this.state = 'creating';
        return;
      case 'pan':
        return;
    }
  }

  private buildCandidates(): void {
    this.candidates = this.core.snapCandidates(new Set(this.moveIds));
    this.candidatesCamera = this.core.camera.version;
  }

  private continue(input: PointerInput): void {
    const down = this.down;
    if (!down) return;
    switch (this.state) {
      case 'panning': {
        const last = this.lastPan ?? down;
        this.core.camera.panBy(input.x - last.x, input.y - last.y);
        this.lastPan = { x: input.x, y: input.y };
        this.core.requestFrame();
        return;
      }
      case 'dragging':
        return this.drag(input, down);
      case 'marquee':
        return this.updateMarquee(input, down);
      case 'resizing':
        return this.resize(input);
      case 'rotating':
        return this.rotate(input);
      case 'creating':
        return this.previewCreate(input, down);
      case 'point':
        return this.movePoint(input);
    }
  }

  private drag(input: PointerInput, down: PointerInput): void {
    const zoom = this.core.camera.zoom;
    let dx = (input.x - down.x) / zoom;
    let dy = (input.y - down.y) / zoom;
    if (input.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    let guides: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    if (!input.ctrl && this.startBox) {
      if (this.candidatesCamera !== this.core.camera.version) this.buildCandidates();
      const box = { minX: this.startBox.minX + dx, minY: this.startBox.minY + dy, maxX: this.startBox.maxX + dx, maxY: this.startBox.maxY + dy };
      const snap = snapBox(box, this.candidates!, SNAP_THRESHOLD_PX / zoom);
      if (!(input.shift && dx === 0)) dx += snap.dx;
      if (!(input.shift && dy === 0)) dy += snap.dy;
      guides = snap.guides.map((guide) =>
        guide.axis === 'x' ? { x1: guide.value, y1: guide.from, x2: guide.value, y2: guide.to } : { x1: guide.from, y1: guide.value, x2: guide.to, y2: guide.value },
      );
    }
    this.matrix = translation(dx, dy);
    this.core.setGesture({ ids: this.moveIds, matrix: this.matrix, snapGuides: guides });
  }

  private updateMarquee(input: PointerInput, down: PointerInput): void {
    const a = this.world(down);
    const b = this.world(input);
    const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    this.core.setMarquee({ x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY });
    const base = this.target?.kind === 'empty' ? this.target.base : [];
    this.core.setSelection([...base, ...this.core.targetsIn(box, { includeLocked: input.alt })]);
  }

  private resize(input: PointerInput): void {
    const target = this.target;
    if (target?.kind !== 'handle') return;
    const { frame, handle } = target;
    const [hx, hy] = HANDLE_SIDES[handle];
    const p = this.toFrame(frame, this.world(input));
    const axis = (side: number, value: number, size: number, alt: boolean): [number, number] => {
      if (side === 0 || size === 0) return [1, size / 2];
      const anchor = alt ? size / 2 : side === 1 ? 0 : size;
      const span = side === 1 ? size - anchor : anchor;
      const scale = side === 1 ? (value - anchor) / span : (anchor - value) / span;
      return [scale, anchor];
    };
    const [scaleX, ax] = axis(hx, p.x, frame.w, input.alt);
    const [scaleY, ay] = axis(hy, p.y, frame.h, input.alt);
    let sx = scaleX;
    let sy = scaleY;
    if (input.shift) {
      if (hx !== 0 && hy !== 0) {
        const s = Math.max(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx || 1) * s;
        sy = Math.sign(sy || 1) * s;
      } else if (hx === 0) {
        sx = Math.abs(sy);
      } else {
        sy = Math.abs(sx);
      }
    }
    if (frame.w > 0 && Math.abs(sx * frame.w) < 1) sx = Math.sign(sx || 1) / frame.w;
    if (frame.h > 0 && Math.abs(sy * frame.h) < 1) sy = Math.sign(sy || 1) / frame.h;
    this.matrix = compose(
      translation(frame.x, frame.y),
      rotation(frame.angle),
      translation(ax, ay),
      scaling(sx, sy),
      translation(-ax, -ay),
      rotation(-frame.angle),
      translation(-frame.x, -frame.y),
    );
    this.core.setGesture({ ids: this.moveIds, matrix: this.matrix });
  }

  private toFrame(frame: SelectionFrame, world: Point): Point {
    return apply(invert(compose(translation(frame.x, frame.y), rotation(frame.angle))), world.x, world.y);
  }

  private frameCenter(frame: SelectionFrame): Point {
    return apply(compose(translation(frame.x, frame.y), rotation(frame.angle)), frame.w / 2, frame.h / 2);
  }

  private angleFrom(frame: SelectionFrame, world: Point): number {
    const center = this.frameCenter(frame);
    return Math.atan2(world.y - center.y, world.x - center.x);
  }

  private rotate(input: PointerInput): void {
    const target = this.target;
    if (target?.kind !== 'rotate') return;
    const { frame } = target;
    const raw = this.angleFrom(frame, this.world(input)) - this.startAngle;
    const snap = snapRotation(toDeg(frame.angle + raw), { shift: input.shift, ctrl: input.ctrl, thresholdDeg: this.profile.rotateSnapDeg });
    // Se gira por el camino corto hasta el ángulo imantado, que viene normalizado a (−180°, 180°].
    const delta = Math.atan2(Math.sin(toRad(snap.angle) - frame.angle), Math.cos(toRad(snap.angle) - frame.angle));
    const center = this.frameCenter(frame);
    this.matrix = rotateAround(center.x, center.y, delta);
    this.core.setGesture({ ids: this.moveIds, matrix: this.matrix });
  }

  private createBox(input: PointerInput, down: PointerInput): { x: number; y: number; w: number; h: number } {
    const a = this.world(down);
    const b = this.world(input);
    let w = b.x - a.x;
    let h = b.y - a.y;
    if (input.shift) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * size;
      h = Math.sign(h || 1) * size;
    }
    if (input.alt) return { x: a.x - Math.abs(w), y: a.y - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
    return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
  }

  private lineEnd(input: PointerInput, down: PointerInput): { from: Point; to: Point } {
    const from = this.world(down);
    let to = this.world(input);
    if (input.shift) to = snapAngle(from, to);
    return { from, to };
  }

  private previewCreate(input: PointerInput, down: PointerInput): void {
    const tool = this.target?.kind === 'create' ? this.target.tool : null;
    const page = this.core.activePage;
    if (!tool || !page) return;
    if (tool === 'text') {
      const box = this.createBox({ ...input, shift: false, alt: false }, down);
      this.core.setMarquee(box);
      return;
    }
    const base = { id: '__creating', pageId: page, parentId: null, index: 'a0', createdBy: this.core.user.id };
    if (tool === 'connector') {
      const { from, to } = this.connectorEnds(input, down);
      this.core.setCreating(newConnector(base, from, to, { x: 0, y: 0, w: 0, h: 0, flipX: false, flipY: false }));
      return;
    }
    if (tool === 'line' || tool === 'arrow') {
      const { from, to } = this.lineEnd(input, down);
      this.core.setCreating(newLine(base, from, to, tool === 'arrow'));
    } else if (tool === 'frame') {
      const box = this.createBox(input, down);
      this.core.setCreating(newFrame(base, { ...box, w: Math.max(1, box.w), h: Math.max(1, box.h) }));
    } else if (SHAPE_TOOLS.has(tool)) {
      const box = this.createBox(input, down);
      this.core.setCreating(newShape(tool as BasicShapeType, base, { ...box, w: Math.max(1, box.w), h: Math.max(1, box.h) }));
    }
  }

  private finishCreate(input: PointerInput): void {
    const down = this.down;
    const tool = this.target?.kind === 'create' ? this.target.tool : null;
    this.core.setCreating(null);
    if (!down || !tool) return;
    if (tool === 'text') {
      this.core.setMarquee(null);
      const box = this.createBox({ ...input, shift: false, alt: false }, down);
      this.createText({ x: box.x, y: box.y }, box.w);
      return;
    }
    if (tool === 'connector') {
      const { from, to } = this.connectorEnds(input, down);
      this.core.commands.createConnector(from, to);
      this.core.commands.setTool('select');
      return;
    }
    if (tool === 'line' || tool === 'arrow') {
      const { from, to } = this.lineEnd(input, down);
      this.core.commands.createLine(from, to, tool === 'arrow');
    } else if (tool === 'frame') {
      this.core.commands.createFrame(this.createBox(input, down));
    } else if (SHAPE_TOOLS.has(tool)) {
      this.core.commands.createShape(tool as BasicShapeType, this.createBox(input, down));
    }
    this.core.commands.setTool('select');
  }

  // Crea el texto, vuelve a la herramienta de selección y abre el editor.
  private createText(at: Point, width: number | null): void {
    const id = this.core.commands.createText(at, width);
    this.core.commands.setTool('select');
    if (id) this.core.startTextEdit(id);
  }

  private click(target: PressTarget | null, input: PointerInput): void {
    if (!target) return;
    const now = performance.now();
    if (target.kind === 'node' && target.viaBox) {
      this.core.setSelection([]);
      // Cuenta como clic en vacío: el segundo clic de un doble clic llega ya sin selección, por la rama de vacío.
      this.lastClick = { id: null, x: input.x, y: input.y, time: now };
      return;
    }
    if (target.kind === 'node' && !input.shift && target.wasSelected && this.core.selection.get().length > 1) {
      this.core.setSelection([target.id]);
    }
    const last = this.lastClick;
    if (target.kind === 'node' && !input.shift) {
      // Doble clic: abre el texto del nodo (o el interior de la forma).
      this.lastClick = { id: target.id, x: input.x, y: input.y, time: now };
      if (last?.id === target.id && this.isDoubleClick(last, input, now)) {
        this.lastClick = null;
        // En un grupo entra y selecciona lo que hay debajo; en un texto o una forma abre su texto.
        if (!this.core.enter(target.id, input.x, input.y)) this.core.startTextEdit(target.id);
      }
    } else if (target.kind === 'empty' && !input.shift) {
      this.lastClick = { id: null, x: input.x, y: input.y, time: now };
    } else {
      this.lastClick = null;
    }
    if (target.kind === 'create') {
      const at = this.world(input);
      if (target.tool === 'text') {
        this.createText(at, null);
        return;
      }
      if (target.tool === 'connector') {
        this.core.commands.createConnector(this.endAt(input, new Set()), roundEnd({ x: at.x + DEFAULT_SIZE, y: at.y }));
      } else if (target.tool === 'line' || target.tool === 'arrow') {
        this.core.commands.createLine(at, { x: at.x + DEFAULT_SIZE, y: at.y }, target.tool === 'arrow');
      } else if (target.tool === 'frame') {
        // Un clic con la herramienta de frame lo crea con el tamaño elegido, centrado donde se pulsa.
        this.core.commands.createFrameFromPreset(this.core.framePreset.get(), at);
      } else if (SHAPE_TOOLS.has(target.tool)) {
        this.core.commands.createShape(target.tool as BasicShapeType, { x: at.x - DEFAULT_SIZE / 2, y: at.y - DEFAULT_SIZE / 2, w: DEFAULT_SIZE, h: DEFAULT_SIZE });
      }
      this.core.commands.setTool('select');
    }
  }

  private isDoubleClick(last: { x: number; y: number; time: number }, input: PointerInput, now: number): boolean {
    const { doubleMs, doublePx } = this.profile;
    return now - last.time <= doubleMs && Math.hypot(input.x - last.x, input.y - last.y) <= doublePx;
  }

  // Extremo de conector bajo el puntero: anclado al nodo que haya debajo (sin contar conectores) o libre. Los
  // extremos libres se guardan en el sistema del padre del conector.
  private endAt(input: PointerInput, exclude: ReadonlySet<string>, connectorId?: string): ConnectorEnd {
    const world = this.world(input);
    const hit = this.core.hitTest(input.x, input.y, { exclude, skipConnectors: true, includeLocked: true });
    const record = hit ? this.core.record(hit) : undefined;
    if (record && isAnchorable(record)) {
      const anchor = anchorAt(this.core.worldMatrix(record), record.w, record.h, world, ANCHOR_SNAP_PX / this.core.camera.zoom);
      return { nodeId: record.id, anchor };
    }
    const parentWorld = connectorId ? this.core.tree.parentWorld(this.core.tree.parent(connectorId)) : null;
    return roundEnd(parentWorld ? apply(invert(parentWorld), world.x, world.y) : world);
  }

  private connectorEnds(input: PointerInput, down: PointerInput): { from: ConnectorEnd; to: ConnectorEnd } {
    const from = this.endAt(down, new Set());
    const to = this.endAt(input, 'nodeId' in from ? new Set([from.nodeId]) : new Set());
    return { from, to };
  }

  private movePoint(input: PointerInput): void {
    const target = this.target;
    if (target?.kind !== 'point') return;
    const connector = this.core.record(target.id);
    if (connector?.type === 'connector') {
      const which = target.index === 0 ? 'from' : 'to';
      const end = this.endAt(input, new Set([connector.id]), connector.id);
      this.endPreview = { which, end };
      this.core.setStylePreview({ ids: [connector.id], patch: { [which]: end } });
      return;
    }
    const record = connector as LineRecord | undefined;
    if (!record || record.type !== 'line') return;
    const parentWorld = this.core.tree.parentWorld(this.core.tree.parent(record.id));
    const toParent = parentWorld ? invert(parentWorld) : null;
    const local = localMatrix(record);
    const absolute = record.points.map(([px, py]) => {
      const p = apply(local, px, py);
      return [p.x, p.y] as [number, number];
    });
    let world = this.world(input);
    if (input.shift) {
      const neighbor = absolute[target.index === 0 ? 1 : target.index - 1]!;
      world = snapAngle({ x: neighbor[0], y: neighbor[1] }, world);
    }
    const inParent = toParent ? apply(toParent, world.x, world.y) : world;
    absolute[target.index] = [inParent.x, inParent.y];
    this.pointPreview = absolute;
    const minX = Math.min(...absolute.map(([x]) => x));
    const minY = Math.min(...absolute.map(([, y]) => y));
    const maxX = Math.max(...absolute.map(([x]) => x));
    const maxY = Math.max(...absolute.map(([, y]) => y));
    this.core.setStylePreview({
      ids: [record.id],
      patch: { x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0, points: absolute.map(([x, y]) => [x - minX, y - minY]) },
    });
  }
}

function roundEnd(p: Point): ConnectorEnd {
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
}

function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}
