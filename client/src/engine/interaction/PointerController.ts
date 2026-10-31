import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import type { TextBoxChange } from '../commands/Commands.ts';
import { newConnector, newFrame, newLine, newShape, DEFAULT_SIZE } from '../commands/defaults.ts';
import { linePointsInParent, linePointsPatch, polylineRecord, storedWaypoints, waypointPoints } from '../commands/paths.ts';
import type { AnchorTarget, EditorCore, Tool } from '../EditorCore.ts';
import { isAnchorable, SNAP_THRESHOLD_PX } from '../EditorCore.ts';
import { anchorAt, anchorTerminal, dragElbowSegment, insertWaypoint, moveWaypoint, NAMED_ANCHORS, routeStart, type ConnectorEnd } from '../geometry/connectors.ts';
import { apply, compose, invert, rotateAround, rotation, scaling, translation, type Mat, type Point } from '../geometry/matrix.ts';
import { snapBox, type SnapCandidates } from '../geometry/snapping.ts';
import { snapRotation, toDeg, toRad } from '../geometry/angles.ts';
import { rotateCursor } from '../overlay/cursors.ts';
import {
  expandQuad,
  HANDLE_SIDES,
  hitHandle,
  hitLineHandle,
  hitRadius,
  insideQuad,
  nearCorner,
  radiusVisible,
  resizeCursor,
  type CornerName,
  type SelectionFrame,
} from '../overlay/handles.ts';
import type { HandleKind } from '../render/sink.ts';
import { Store } from '../store.ts';
import { containsAABB, type AABB, type BasicShapeType, type NodeRecord } from '../types.ts';
import type { InputProfile, PointerKind } from './input/profile.ts';
import { findShortcut, type KeyInput } from './shortcuts.ts';
import { TEXT_FONT_MAX, TEXT_FONT_MIN } from '../text/resize.ts';

// Con la herramienta T, un arrastre que deja una caja de al menos tanto ancho en pantalla crea un texto de ancho fijo.
export const TEXT_MIN_DRAG_PX = 24;

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

// pen: pulsación con la Pluma; al soltar añade un punto (o termina la línea). La línea en curso dura entre pulsaciones.
export type PointerState =
  | 'idle'
  | 'pressing'
  | 'dragging'
  | 'marquee'
  | 'resizing'
  | 'rotating'
  | 'creating'
  | 'panning'
  | 'point'
  | 'segment'
  | 'radius'
  | 'pen';

// viaBox: se pulsó en un hueco dentro de la caja de la selección; arrastrar mueve la selección y un clic es un clic en vacío.
// rotate: `corner` es la esquina de la zona de giro (null con el tirador del dedo), para orientar el cursor.
// radius: `toLocal` lleva el mundo a la caja del nodo y `start` es la pulsación ahí; `inward` es hacia dónde crece el
// radio desde esa esquina en cada eje.
// point: vértice `index` de los `vertices` tiradores de una línea o un conector (en un conector, el primero y el
// último son sus extremos y los de en medio, sus waypoints).
// insert: punto medio `mid` del vano `segment`; al pasar el umbral se inserta ahí un vértice y sigue como `point`.
// segment: tramo `index` del recorrido en codo `route` (en mundo, tal como estaba al pulsar).
type PressTarget =
  | { kind: 'node'; id: string; wasSelected: boolean; viaBox?: boolean }
  | { kind: 'empty'; base: readonly string[] }
  | { kind: 'handle'; handle: HandleKind; frame: SelectionFrame }
  | { kind: 'rotate'; frame: SelectionFrame; corner: CornerName | null }
  | { kind: 'radius'; id: string; r0: number; max: number; toLocal: Mat; start: Point; inward: [number, number] }
  | { kind: 'point'; id: string; index: number; vertices: number }
  | { kind: 'insert'; id: string; segment: number; mid: number; vertices: number }
  | { kind: 'segment'; id: string; index: number; route: readonly number[]; horizontal: boolean }
  | { kind: 'create'; tool: Tool }
  | { kind: 'pen' }
  | { kind: 'pan' };

export type PressKind = PressTarget['kind'];

// Fuera de un nodo, a menos de esta distancia de pantalla de una de sus anclas, el extremo de un conector también se
// pega a él. Con el dedo es media zona de impacto.
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
  private radiusPreview: number | null = null;
  // Puntos de la línea o waypoints del conector al empezar a arrastrar un vértice (con el insertado, si lo hay), en el
  // sistema del padre, y waypoints de la vista previa.
  private pathBase: { points: Array<[number, number]> } | { waypoints: Point[] } | null = null;
  private waypointPreview: Array<[number, number]> | null = null;
  private lastVertexClick: { key: string; x: number; y: number; time: number } | null = null;
  private startAngle = 0;
  // id null: el clic fue en vacío (o en el hueco de la selección).
  private lastClick: { id: string | null; x: number; y: number; time: number } | null = null;
  // Con el dedo, la selección que dejaría la pulsación se aplica al pasar el umbral o al soltar, no al tocar.
  private pendingSelect: string[] | null = null;
  // Línea de la Pluma: puntos fijados en mundo, el siguiente (que sigue al puntero) y si el puntero está sobre el último.
  private pen: { points: Point[]; next: Point | null; closing: boolean } | null = null;
  private lastPenClick: { x: number; y: number; time: number } | null = null;
  // Un texto solo que se redimensiona: los lados cambian su ancho de reflujo (width), arriba y abajo dejan la caja fija
  // (height) y las esquinas escalan la fuente (corner). Los lados se ven con la vista previa de estilo (`textChange`)
  // y las esquinas con la matriz del gesto y la escala `textScale`.
  private textResize: { id: string; mode: 'width' | 'height' | 'corner' } | null = null;
  private textChange: TextBoxChange | null = null;
  private textScale = 1;

  constructor(private readonly core: EditorCore) {
    // Al dejar la Pluma (también al pasar a solo lectura) o cambiar de página, lo que quede de la línea se descarta;
    // setTool ya la ha creado si tenía 2 puntos o más.
    core.tool.subscribe((tool) => {
      if (tool !== 'pen') this.discardPen();
    });
    core.pageId.subscribe(() => this.discardPen());
  }

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

    if (this.tool === 'pen') {
      if (this.readOnly) return;
      this.target = { kind: 'pen' };
      this.state = 'pen';
      this.penMove(input);
      return;
    }

    if (this.tool !== 'select') {
      if (this.readOnly) return;
      this.target = { kind: 'create', tool: this.tool };
      this.state = 'pressing';
      return;
    }

    const handle = this.handleAt(input.x, input.y);
    // Cualquier pulsación que no sea en un vértice lo desmarca.
    if (handle?.kind !== 'point') this.core.setActiveVertex(null);
    if (handle) {
      this.target = handle;
      this.state = 'pressing';
      return;
    }

    if (this.core.canvasTouchModifiers.get() && this.core.touchModifiers.get().additive) input = { ...input, shift: true };
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

  pointerUp(raw: PointerInput): void {
    this.latest = raw;
    this.moved = true;
    this.flush();
    const input = this.withModifiers(raw);
    const target = this.target;
    switch (this.state) {
      case 'pressing':
        this.applyPendingSelection();
        this.click(target, input);
        break;
      case 'resizing':
        if (this.textResize) {
          this.commitTextResize(this.textResize.id);
          break;
        }
      // falls through
      case 'dragging':
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
      case 'pen':
        this.penClick(input);
        break;
      case 'point':
      case 'segment':
        if (target?.kind === 'point' || target?.kind === 'segment') {
          if (this.pointPreview) this.core.commands.setLinePoints(target.id, this.pointPreview);
          if (this.waypointPreview) this.core.commands.setConnectorPath(target.id, { waypoints: this.waypointPreview });
          if (this.endPreview) this.core.commands.setConnectorEnd(target.id, this.endPreview.which, this.endPreview.end);
        }
        this.core.setStylePreview(null);
        break;
      case 'radius':
        if (target?.kind === 'radius' && this.radiusPreview !== null) this.core.commands.setStyle({ cornerRadius: this.radiusPreview }, [target.id]);
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
    this.core.setRadiusHover(false);
    this.core.setLineHover(null);
  }

  // Quita las vistas previas del gesto sin escribir nada en el documento.
  cancel(): void {
    if (this.state === 'dragging' || this.state === 'resizing' || this.state === 'rotating') this.core.setGesture(null);
    if (this.state === 'marquee') this.core.setMarquee(null);
    if (this.state === 'creating') this.core.setCreating(null);
    if (this.state === 'point' || this.state === 'segment' || this.state === 'radius' || this.textChange) this.core.setStylePreview(null);
    // Una pulsación anulada (dos dedos, pointercancel) no deja el tramo que seguía al puntero.
    if (this.state === 'pen' && this.pen) {
      this.pen.next = null;
      this.pen.closing = false;
      this.showPen();
    }
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
    this.radiusPreview = null;
    this.pathBase = null;
    this.waypointPreview = null;
    this.textResize = null;
    this.textChange = null;
    this.textScale = 1;
    this.lastPan = null;
    this.pendingSelect = null;
    this.core.setRotationReadout(null);
    this.core.setAnchorTarget(null);
    this.cursor.set(this.idleCursor());
  }

  // Clic derecho: lo que hay debajo pasa a ser la selección (si no lo era ya) y el menú actúa sobre ella. En vacío,
  // la selección se vacía. Devuelve el punto de la página donde se abrió.
  // Sobre un vértice que se puede quitar (también con una pulsación larga), la selección no cambia y el vértice queda
  // marcado: el menú ofrece «Eliminar punto».
  contextMenu(input: { x: number; y: number }): Point {
    if (this.state !== 'idle') this.cancel();
    const world = this.world(input);
    if (this.tool === 'select') {
      const handle = this.handleAt(input.x, input.y);
      if (handle?.kind === 'point' && this.core.commands.canRemoveVertex(handle.id, handle.index)) {
        this.core.setActiveVertex({ id: handle.id, index: handle.index });
        return world;
      }
    }
    this.core.setActiveVertex(null);
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
    if (input.key === 'Escape' && this.core.anim.previewActive) {
      this.core.anim.preview(null);
      return true;
    }
    if (this.pen && this.penKey(input)) return true;
    if (input.key === 'Escape') {
      if (this.state !== 'idle') {
        this.cancel();
        return true;
      }
      if (this.core.activeVertex.get()) {
        this.core.setActiveVertex(null);
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
        if (this.pen) this.penMove(input);
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
    this.core.setRadiusHover(this.nearRadiusCorner(input.x, input.y));
    const picked = this.core.pick(input.x, input.y);
    // Con el puntero sobre la línea o el conector seleccionado aparecen sus puntos medios; se marcan antes de buscar
    // el tirador para que el punto medio que hay debajo cuente.
    const path = this.selectedPath();
    if (path && picked === path) this.core.setLineHover(path);
    const handle = this.handleAt(input.x, input.y);
    if (path) {
      const onPath = picked === path || handle?.kind === 'point' || handle?.kind === 'insert' || handle?.kind === 'segment';
      this.core.setLineHover(onPath ? path : null, handle?.kind === 'insert' ? handle.mid : null);
    }
    if (handle?.kind === 'handle') this.cursor.set(resizeCursor(handle.handle, handle.frame.angle));
    else if (handle?.kind === 'rotate') this.cursor.set(handle.corner ? rotateCursor(handle.corner, handle.frame.angle) : 'grab');
    else if (handle?.kind === 'point') this.cursor.set('move');
    else if (handle?.kind === 'insert') this.cursor.set('copy');
    else if (handle?.kind === 'segment') this.cursor.set(handle.horizontal ? 'ns-resize' : 'ew-resize');
    else this.cursor.set('default');
    this.core.setHover(handle ? null : picked);
  }

  // La línea o el conector seleccionado solo, si se puede editar.
  private selectedPath(): string | null {
    const ids = this.core.selection.get();
    if (ids.length !== 1 || this.readOnly || this.core.anyLocked(ids)) return null;
    const type = this.core.record(ids[0]!)?.type;
    return type === 'line' || type === 'connector' ? ids[0]! : null;
  }

  // Un rectángulo o una imagen solos, editables, con el puntero cerca de una de sus esquinas o de un tirador de radio
  // (con un radio grande el tirador queda lejos de la esquina).
  private nearRadiusCorner(x: number, y: number): boolean {
    const ids = this.core.selection.get();
    if (ids.length !== 1 || this.readOnly || this.core.anyLocked(ids)) return false;
    const points = this.core.radiusHandlePoints(ids[0]!);
    const frame = points && this.core.selectionFrame(ids);
    return !!frame && (nearCorner(this.core.screenCorners(frame), x, y) || nearCorner(points, x, y));
  }

  private handleAt(x: number, y: number): PressTarget | null {
    const ids = this.core.selection.get();
    if (!ids.length || this.readOnly || this.core.anyLocked(ids)) return null;
    const profile = this.profile;
    if (ids.length === 1) {
      const id = ids[0]!;
      const handles = this.core.lineHandles(id);
      if (handles) {
        const hit = hitLineHandle(handles, x, y, profile);
        const vertices = handles.vertices.length;
        if (hit?.kind === 'vertex') return { kind: 'point', id, index: hit.index, vertices };
        if (hit?.kind === 'mid') return { kind: 'insert', id, segment: handles.mids[hit.index]!.segment, mid: hit.index, vertices };
        const route = hit?.kind === 'segment' ? this.core.routeOf(id) : null;
        if (hit?.kind === 'segment' && route) {
          const segment = handles.segments[hit.index]!;
          return { kind: 'segment', id, index: segment.index, route: [...route], horizontal: segment.axis === 'y' };
        }
        return null;
      }
    }
    const frame = this.core.selectionFrame(ids);
    if (!frame) return null;
    const corners = this.core.screenCorners(frame);
    const hit = hitHandle(corners, x, y, profile, { sideEdges: ids.length === 1 && this.core.record(ids[0]!)?.type === 'text' });
    const radius = ids.length === 1 && radiusVisible(corners, profile, this.nearRadiusCorner(x, y)) ? this.radiusAt(ids[0]!, corners, x, y) : null;
    // Un tirador de radio y uno de escala pueden solaparse cerca de la esquina: gana el más cercano.
    if (radius && (!hit || hit.kind === 'rotate' || radius.distance < Math.hypot(hit.x - x, hit.y - y))) return radius.target;
    if (!hit) return null;
    if (hit.kind === 'rotate') return { kind: 'rotate', frame, corner: hit.corner };
    return { kind: 'handle', handle: hit.kind, frame };
  }

  private radiusAt(id: string, corners: readonly [Point, Point, Point, Point], x: number, y: number): { target: PressTarget; distance: number } | null {
    const points = this.core.radiusHandlePoints(id);
    const record = this.core.record(id);
    if (!points || (record?.type !== 'rect' && record?.type !== 'image')) return null;
    const hit = hitRadius(points, corners, x, y, this.profile);
    if (!hit) return null;
    const world = this.core.worldMatrix(record);
    const toLocal = invert(world);
    const pressed = this.world({ x, y });
    const start = apply(toLocal, pressed.x, pressed.y);
    // Esquinas nw, ne, se, sw: hacia dentro es +x en las izquierdas y +y en las de arriba.
    const inward: [number, number] = [hit.index === 0 || hit.index === 3 ? 1 : -1, hit.index < 2 ? 1 : -1];
    return {
      target: { kind: 'radius', id, r0: record.cornerRadius, max: Math.min(record.w, record.h) / 2, toLocal, start, inward },
      distance: hit.distance,
    };
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
      case 'handle': {
        this.state = 'resizing';
        this.moveIds = [...this.core.selection.get()];
        const id = this.moveIds.length === 1 ? this.moveIds[0]! : null;
        if (id && this.core.record(id)?.type === 'text') {
          const [hx, hy] = HANDLE_SIDES[target.handle];
          this.textResize = { id, mode: hy === 0 ? 'width' : hx === 0 ? 'height' : 'corner' };
        }
        return;
      }
      case 'rotate':
        this.state = 'rotating';
        this.moveIds = [...this.core.selection.get()];
        this.startAngle = this.angleFrom(target.frame, this.world(this.down!));
        this.cursor.set(target.corner ? rotateCursor(target.corner, target.frame.angle) : 'grabbing');
        return;
      case 'point':
        this.state = 'point';
        this.pathBase = this.pathPoints(target.id);
        return;
      case 'insert': {
        const index = this.insertAtPress(target);
        if (index === null) {
          this.state = 'idle';
          this.target = null;
          return;
        }
        this.target = { kind: 'point', id: target.id, index, vertices: target.vertices + 1 };
        this.state = 'point';
        this.cursor.set('move');
        return;
      }
      case 'segment':
        this.state = 'segment';
        return;
      case 'radius':
        this.state = 'radius';
        // Los tiradores siguen visibles aunque el puntero se aleje de la esquina mientras se arrastra.
        this.core.setRadiusHover(true);
        return;
      case 'create':
        this.state = 'creating';
        return;
      case 'pen':
      case 'pan':
        return;
    }
  }

  private buildCandidates(): void {
    this.candidates = this.core.snapCandidates(new Set(this.moveIds));
    this.candidatesCamera = this.core.camera.version;
  }

  // Los conmutadores táctiles de la barra contextual hacen de Shift y Alt según el gesto: proporción y desde el centro
  // al redimensionar o al crear un marco o una forma, de 15 en 15 al girar y sumar a la selección al tocar.
  private withModifiers(input: PointerInput): PointerInput {
    if (!this.core.canvasTouchModifiers.get()) return input;
    const mods = this.core.touchModifiers.get();
    const target = this.target;
    const creating = target?.kind === 'create' && (target.tool === 'frame' || SHAPE_TOOLS.has(target.tool));
    if (this.state === 'resizing' || ((this.state === 'creating' || this.state === 'pressing') && creating)) {
      return mods.proportional || mods.fromCenter ? { ...input, shift: input.shift || mods.proportional, alt: input.alt || mods.fromCenter } : input;
    }
    if (this.state === 'rotating') return mods.step15 ? { ...input, shift: true } : input;
    if (this.state === 'pressing' && (target?.kind === 'node' || target?.kind === 'empty')) return mods.additive ? { ...input, shift: true } : input;
    return input;
  }

  private continue(raw: PointerInput): void {
    const down = this.down;
    if (!down) return;
    const input = this.withModifiers(raw);
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
      case 'segment':
        return this.moveSegment(input);
      case 'radius':
        return this.moveRadius(input);
      case 'pen':
        return this.penMove(input);
    }
  }

  // El radio crece con la media de lo que el puntero avanza hacia dentro en cada eje local, desde el radio que tenía:
  // pulsar sin mover no lo cambia.
  private moveRadius(input: PointerInput): void {
    const target = this.target;
    if (target?.kind !== 'radius') return;
    const world = this.world(input);
    const p = apply(target.toLocal, world.x, world.y);
    const dx = (p.x - target.start.x) * target.inward[0];
    const dy = (p.y - target.start.y) * target.inward[1];
    const radius = Math.round(Math.max(0, Math.min(target.r0 + (dx + dy) / 2, target.max)) * 100) / 100;
    this.radiusPreview = radius;
    this.core.setStylePreview({ ids: [target.id], patch: { cornerRadius: radius } });
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
    const text = this.textResize;
    if (text?.mode === 'width') {
      sx = Math.max(sx, frame.w > 0 ? 1 / frame.w : 1);
      sy = 1;
    } else if (text?.mode === 'height') {
      sx = 1;
      sy = Math.max(sy, frame.h > 0 ? 1 / frame.h : 1);
    } else if (text?.mode === 'corner') {
      sx = sy = this.textCornerScale(text.id, frame, scaleX, scaleY);
    } else if (input.shift) {
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
    if (text && text.mode !== 'corner') {
      // Los lados de un texto no lo estiran: la vista previa es la caja que se escribirá, y con el ancho nuevo el
      // texto se reparte en líneas en cada frame.
      const box = this.core.commands.textBoxUnder(text.id, this.matrix);
      this.matrix = null;
      if (!box) return;
      this.textChange = text.mode === 'width' ? { kind: 'width', x: box.x, y: box.y, w: box.w } : { kind: 'fixed', x: box.x, y: box.y, h: box.h };
      const patch = this.core.commands.textResizePatch(text.id, this.textChange);
      if (patch) this.core.setStylePreview({ ids: [text.id], patch });
      return;
    }
    if (text) this.textScale = sx;
    this.core.setGesture({ ids: this.moveIds, matrix: this.matrix });
  }

  // Escala uniforme de una esquina de texto: la proyección del puntero sobre la diagonal (sirve para agrandar y para
  // achicar), sin voltear y sin sacar la fuente de [4, 800].
  private textCornerScale(id: string, frame: SelectionFrame, scaleX: number, scaleY: number): number {
    const w2 = frame.w * frame.w;
    const h2 = frame.h * frame.h;
    const s = w2 + h2 > 0 ? (scaleX * w2 + scaleY * h2) / (w2 + h2) : 1;
    const record = this.core.record(id);
    const fontSize = record?.type === 'text' ? record.fontSize : 16;
    const min = Math.max(TEXT_FONT_MIN / fontSize, frame.w > 0 ? 1 / frame.w : 0, frame.h > 0 ? 1 / frame.h : 0);
    return Math.min(Math.max(s, min), TEXT_FONT_MAX / fontSize);
  }

  // Al soltar un tirador de un texto solo: los lados escriben la caja de la vista previa y las esquinas, la escala.
  private commitTextResize(id: string): void {
    const change = this.textChange;
    if (change?.kind === 'width') this.core.commands.resizeText(id, change);
    else if (change?.kind === 'fixed') this.core.commands.fixTextSize(id, change);
    else if (this.matrix) this.core.commands.scaleText(id, this.textScale, this.matrix);
    if (change) this.core.setStylePreview(null);
    this.core.setGesture(null);
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
    this.core.setRotationReadout({ angle: snap.angle, snapped: snap.snapped });
    if (target.corner) this.cursor.set(rotateCursor(target.corner, frame.angle + delta));
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
      const { from, to, target } = this.connectorEnds(input, down);
      this.core.setAnchorTarget(target);
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
      // Una caja estrecha en pantalla es un clic que se ha movido: auto-ancho donde empezó.
      const fixed = Math.abs(input.x - down.x) >= TEXT_MIN_DRAG_PX;
      if (fixed) this.createText({ x: box.x, y: box.y }, box.w);
      else this.createText(this.world(down), null);
      return;
    }
    if (tool === 'connector') {
      const { from, to } = this.connectorEnds(input, down);
      this.core.commands.createConnector(from, to);
      this.core.commands.finishTool();
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
    this.core.commands.finishTool();
  }

  // ── Pluma ──

  // Teclas con una línea de la Pluma en curso. Enter termina (con 2 puntos o más); Esc termina con 2 o más y descarta
  // con 1; Supr y Retroceso quitan el último punto en vez de borrar la selección.
  private penKey(input: KeyInput): boolean {
    const plain = !input.ctrl && !input.alt;
    if (input.key === 'Escape') {
      if (this.state !== 'idle') this.cancel();
      if ((this.pen?.points.length ?? 0) >= 2) this.finishPen();
      else this.discardPen();
      return true;
    }
    if (input.key === 'Enter' && plain) {
      if (this.state === 'idle') this.finishPen();
      return true;
    }
    if ((input.key === 'Backspace' || input.key === 'Delete') && plain) {
      if (this.state === 'idle') this.removeLastPenPoint();
      return true;
    }
    return false;
  }

  // Punto de la Pluma bajo el puntero; con Shift, a 45° del último fijado.
  private penAt(input: PointerInput): Point {
    const world = this.world(input);
    const last = this.pen?.points.at(-1);
    return input.shift && last ? snapAngle(last, world) : world;
  }

  // El puntero está sobre el último punto fijado: un clic ahí termina la línea.
  private onLastPenPoint(input: PointerInput): boolean {
    const last = this.pen?.points.at(-1);
    if (!last) return false;
    const screen = this.core.camera.worldToScreen(last.x, last.y);
    return Math.hypot(screen.x - input.x, screen.y - input.y) <= this.profile.handleHit / 2;
  }

  private penMove(input: PointerInput): void {
    const pen = this.pen;
    if (!pen) return;
    const closing = this.onLastPenPoint(input);
    pen.next = closing ? null : this.penAt(input);
    pen.closing = closing;
    this.showPen();
  }

  // Cada clic (o toque) fija un punto. Un doble clic o un clic sobre el último punto terminan la línea; llegar al
  // máximo de puntos también.
  private penClick(input: PointerInput): void {
    const now = performance.now();
    const last = this.lastPenClick;
    this.lastPenClick = { x: input.x, y: input.y, time: now };
    if (this.pen && (this.onLastPenPoint(input) || (last && this.isDoubleClick(last, input, now)))) {
      this.lastPenClick = null;
      this.finishPen();
      return;
    }
    if (!this.pen) {
      this.core.setSelection([]);
      this.pen = { points: [], next: null, closing: false };
    }
    const pen = this.pen;
    pen.points.push(this.penAt(input));
    pen.next = null;
    pen.closing = true;
    if (pen.points.length >= DOCUMENT_LIMITS.maxPoints) {
      this.finishPen();
      return;
    }
    this.showPen();
  }

  private removeLastPenPoint(): void {
    const pen = this.pen;
    if (!pen) return;
    pen.points.pop();
    if (!pen.points.length) {
      this.discardPen();
      return;
    }
    pen.closing = false;
    this.showPen();
  }

  // La línea se ve como una línea en creación, con el tramo que sigue al puntero; sus puntos, en el overlay.
  private showPen(): void {
    const pen = this.pen;
    const page = this.core.activePage;
    if (!pen || !page) return;
    const points = pen.next ? [...pen.points, pen.next] : pen.points;
    if (points.length >= 2) {
      const base = { id: '__creating', pageId: page, parentId: null, index: 'a0', createdBy: this.core.user.id };
      this.core.setCreating(polylineRecord(base, points.map((p) => [p.x, p.y] as const)));
    } else {
      this.core.setCreating(null);
    }
    this.core.setPenDraft({ points: pen.points, closing: pen.closing });
  }

  // Termina la línea de la Pluma si tiene 2 puntos o más y vuelve a Seleccionar (salvo herramienta bloqueada). Con
  // menos, no hace nada y la línea sigue en curso.
  finishPen(): boolean {
    if ((this.pen?.points.length ?? 0) < 2) return false;
    const id = this.commitPen();
    this.core.commands.finishTool();
    return id !== null;
  }

  // Crea la línea en curso si tiene 2 puntos o más y la quita; no cambia de herramienta.
  commitPen(): string | null {
    const pen = this.pen;
    if (!pen) return null;
    this.discardPen();
    return pen.points.length >= 2 ? this.core.commands.createPolyline(pen.points) : null;
  }

  discardPen(): void {
    if (!this.pen) return;
    this.pen = null;
    this.lastPenClick = null;
    this.core.setCreating(null);
    this.core.setPenDraft(null);
  }

  // Crea el texto, vuelve a la herramienta de selección (salvo bloqueo) y abre el editor.
  private createText(at: Point, width: number | null): void {
    const id = this.core.commands.createText(at, width);
    this.core.commands.finishTool();
    if (id) this.core.startTextEdit(id);
  }

  private click(target: PressTarget | null, input: PointerInput): void {
    if (!target) return;
    const now = performance.now();
    if (target.kind === 'point') {
      this.clickVertex(target.id, target.index, input, now);
      return;
    }
    this.lastVertexClick = null;
    if (target.kind === 'insert' || target.kind === 'segment') {
      this.lastClick = null;
      return;
    }
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
      // Doble clic en vacío (también el segundo clic tras uno en el hueco de la selección): un texto en ese punto.
      if (last?.id === null && this.isDoubleClick(last, input, now) && !this.readOnly) {
        this.lastClick = null;
        this.createText(this.world(input), null);
        return;
      }
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
        this.core.commands.createConnector(this.endAt(input, new Set()).end, roundEnd({ x: at.x + DEFAULT_SIZE, y: at.y }));
      } else if (target.tool === 'line' || target.tool === 'arrow') {
        this.core.commands.createLine(at, { x: at.x + DEFAULT_SIZE, y: at.y }, target.tool === 'arrow');
      } else if (target.tool === 'frame') {
        // Un clic con la herramienta de frame lo crea con el tamaño elegido, centrado donde se pulsa.
        this.core.commands.createFrameFromPreset(this.core.framePreset.get(), at);
      } else if (SHAPE_TOOLS.has(target.tool)) {
        this.core.commands.createShape(target.tool as BasicShapeType, { x: at.x - DEFAULT_SIZE / 2, y: at.y - DEFAULT_SIZE / 2, w: DEFAULT_SIZE, h: DEFAULT_SIZE });
      }
      this.core.commands.finishTool();
    }
  }

  private isDoubleClick(last: { x: number; y: number; time: number }, input: PointerInput, now: number): boolean {
    const { doubleMs, doublePx } = this.profile;
    return now - last.time <= doubleMs && Math.hypot(input.x - last.x, input.y - last.y) <= doublePx;
  }

  // Extremo de conector bajo el puntero: anclado al nodo que haya debajo (sin contar conectores), al nodo con un ancla
  // a menos de ANCHOR_SNAP_PX o libre. Anclado, va al ancla con nombre más cercana; con Ctrl/⌘, al punto exacto
  // ({u, v}). Los extremos libres se guardan en el sistema del padre del conector. `target` es el nodo que se resalta.
  private endAt(input: PointerInput, exclude: ReadonlySet<string>, connectorId?: string): { end: ConnectorEnd; target: AnchorTarget | null } {
    const world = this.world(input);
    const snap = (this.profile.kind === 'touch' ? this.profile.handleHit / 2 : ANCHOR_SNAP_PX) / this.core.camera.zoom;
    const hit = this.core.hitTest(input.x, input.y, { exclude, skipConnectors: true, includeLocked: true });
    const under = hit ? this.core.record(hit) : undefined;
    const record = under && isAnchorable(under) ? under : this.nodeNearAnchor(world, snap, exclude);
    if (record) {
      const anchor = anchorAt(this.core.worldMatrix(record), record.w, record.h, world, input.ctrl ? -1 : Infinity);
      return { end: { nodeId: record.id, anchor }, target: { nodeId: record.id, anchor } };
    }
    const parentWorld = connectorId ? this.core.tree.parentWorld(this.core.tree.parent(connectorId)) : null;
    return { end: roundEnd(parentWorld ? apply(invert(parentWorld), world.x, world.y) : world), target: null };
  }

  // Nodo con un ancla con nombre a menos de `snap` (en mundo) del punto; el más cercano.
  private nodeNearAnchor(world: Point, snap: number, exclude: ReadonlySet<string>): NodeRecord | null {
    const box = { minX: world.x - snap, minY: world.y - snap, maxX: world.x + snap, maxY: world.y + snap };
    let best: NodeRecord | null = null;
    let bestDistance = snap;
    for (const id of this.core.queryBox(box, { includeLocked: true })) {
      const record = this.core.record(id);
      if (!record || exclude.has(id) || !isAnchorable(record)) continue;
      const matrix = this.core.worldMatrix(record);
      for (const name of NAMED_ANCHORS) {
        const p = anchorTerminal(matrix, record.w, record.h, name);
        const distance = Math.hypot(p.x - world.x, p.y - world.y);
        if (distance <= bestDistance) {
          best = record;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  private connectorEnds(input: PointerInput, down: PointerInput): { from: ConnectorEnd; to: ConnectorEnd; target: AnchorTarget | null } {
    const from = this.endAt(down, new Set()).end;
    const to = this.endAt(input, 'nodeId' in from ? new Set([from.nodeId]) : new Set());
    return { from, to: to.end, target: to.target };
  }

  // Puntos de la línea o waypoints del conector al empezar a arrastrar, en el sistema del padre.
  private pathPoints(id: string): PointerController['pathBase'] {
    const record = this.core.record(id);
    if (record?.type === 'line') return { points: linePointsInParent(record) };
    if (record?.type === 'connector') return { waypoints: waypointPoints(record) };
    return null;
  }

  // Inserta un vértice en el punto medio pulsado; devuelve su índice de tirador o null si ya no caben más.
  private insertAtPress(target: Extract<PressTarget, { kind: 'insert' }>): number | null {
    const base = this.pathPoints(target.id);
    const at = this.toParentOf(target.id, this.world(this.down!));
    if (base && 'points' in base) {
      if (base.points.length >= DOCUMENT_LIMITS.maxPoints) return null;
      base.points.splice(target.segment + 1, 0, [at.x, at.y]);
    } else if (base) {
      if (base.waypoints.length >= DOCUMENT_LIMITS.maxWaypoints) return null;
      base.waypoints = insertWaypoint(base.waypoints, target.segment, at);
    } else {
      return null;
    }
    this.pathBase = base;
    return target.segment + 1;
  }

  private toParentOf(id: string, world: Point): Point {
    const parentWorld = this.core.tree.parentWorld(this.core.tree.parent(id));
    return parentWorld ? apply(invert(parentWorld), world.x, world.y) : world;
  }

  private toWorldOf(id: string, local: Point): Point {
    const parentWorld = this.core.tree.parentWorld(this.core.tree.parent(id));
    return parentWorld ? apply(parentWorld, local.x, local.y) : local;
  }

  // Clic en un vértice: lo marca (si se puede quitar) y un doble clic lo quita.
  private clickVertex(id: string, index: number, input: PointerInput, now: number): void {
    this.lastClick = null;
    const key = `${id}:${index}`;
    const last = this.lastVertexClick;
    if (last?.key === key && this.isDoubleClick(last, input, now)) {
      this.lastVertexClick = null;
      this.core.commands.removeVertex(id, index);
      return;
    }
    this.lastVertexClick = { key, x: input.x, y: input.y, time: now };
    this.core.setActiveVertex(this.core.commands.canRemoveVertex(id, index) ? { id, index } : null);
  }

  // Vértice de una línea, extremo de un conector (que se reancla) o waypoint, con Shift a 45° del vértice anterior.
  private movePoint(input: PointerInput): void {
    const target = this.target;
    if (target?.kind !== 'point') return;
    const record = this.core.record(target.id);
    const base = this.pathBase;
    let world = this.world(input);
    if (record?.type === 'connector') {
      const which = target.index === 0 ? 'from' : target.index === target.vertices - 1 ? 'to' : null;
      if (which) {
        const found = this.endAt(input, new Set([record.id]), record.id);
        this.endPreview = { which, end: found.end };
        this.core.setAnchorTarget(found.target);
        this.core.setStylePreview({ ids: [record.id], patch: { [which]: found.end } });
        return;
      }
      const waypoints = base && 'waypoints' in base ? base.waypoints : waypointPoints(record);
      const index = target.index - 1;
      if (index < 0 || index >= waypoints.length) return;
      if (input.shift) {
        const route = this.core.routeOf(record.id);
        const previous = index === 0 ? (route ? routeStart(route) : null) : this.toWorldOf(record.id, waypoints[index - 1]!);
        if (previous) world = snapAngle(previous, world);
      }
      this.waypointPreview = storedWaypoints(moveWaypoint(waypoints, index, this.toParentOf(record.id, world)));
      this.core.setStylePreview({ ids: [record.id], patch: { waypoints: this.waypointPreview } });
      return;
    }
    if (record?.type !== 'line') return;
    const absolute = (base && 'points' in base ? base.points : linePointsInParent(record)).map(([x, y]) => [x, y] as [number, number]);
    if (target.index >= absolute.length) return;
    if (input.shift) {
      const neighbor = absolute[target.index === 0 ? 1 : target.index - 1]!;
      world = snapAngle(this.toWorldOf(record.id, { x: neighbor[0], y: neighbor[1] }), world);
    }
    const inParent = this.toParentOf(record.id, world);
    absolute[target.index] = [inParent.x, inParent.y];
    this.pointPreview = absolute;
    this.core.setStylePreview({ ids: [record.id], patch: linePointsPatch(absolute) });
  }

  // Tramo de un codo arrastrado en perpendicular: los waypoints nuevos son los vértices interiores del recorrido.
  private moveSegment(input: PointerInput): void {
    const target = this.target;
    if (target?.kind !== 'segment' || !this.down) return;
    const from = this.world(this.down);
    const to = this.world(input);
    const delta = target.horizontal ? to.y - from.y : to.x - from.x;
    const world = dragElbowSegment(target.route, target.index, delta);
    // Sin cambio (o bloqueado por los extremos) no se escribe nada.
    if (world.length > DOCUMENT_LIMITS.maxWaypoints || sameInterior(world, target.route)) {
      if (this.waypointPreview) this.core.setStylePreview(null);
      this.waypointPreview = null;
      return;
    }
    this.waypointPreview = storedWaypoints(world.map((p) => this.toParentOf(target.id, p)));
    this.core.setStylePreview({ ids: [target.id], patch: { waypoints: this.waypointPreview } });
  }
}

// Los puntos son los vértices interiores del recorrido plano `route`.
function sameInterior(points: readonly Point[], route: readonly number[]): boolean {
  if (points.length !== route.length / 2 - 2) return false;
  return points.every((p, i) => Math.abs(p.x - route[i * 2 + 2]!) < 1e-6 && Math.abs(p.y - route[i * 2 + 3]!) < 1e-6);
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
