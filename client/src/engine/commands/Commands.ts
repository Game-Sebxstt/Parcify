import { newNodeId } from '../../shared/document/ids.js';
import { DOCUMENT_LIMITS } from '../../shared/document/limits.js';
import { NodeSchema, PageSchema, type FontFamily } from '../../shared/document/schema.js';
import type { EditorCore, Tool } from '../EditorCore.ts';
import { EDIT_TOOLS } from '../EditorCore.ts';
import { localMatrix } from '../geometry/bounds.ts';
import { endpointBox, endpointsFromBox, type ConnectorEnd, type ConnectorRoute } from '../geometry/connectors.ts';
import { apply, compose, invert as invertMat, isRigid, isTranslation, multiply, normalizeAngle, translation, type Mat, type Point } from '../geometry/matrix.ts';
import { applyPatch, transformPatch, type TransformPatch } from '../geometry/transform.ts';
import { compareOrder, keysBetween, keysOnTop, needsReindex, reindex, zOrderIndexes, type ZMove } from '../model/order.ts';
import type { OpBuilder } from '../doc/DocWriter.ts';
import { parseClipboard, serializeClipboard } from '../interaction/clipboard.ts';
import {
  emptyAABB,
  hasLabel,
  hasTextContent,
  intersects,
  isContainer,
  isEmptyAABB,
  unionAABB,
  type BasicShapeType,
  type Box,
  type ConnectorRecord,
  type ContainerRecord,
  type FrameRecord,
  type NodeRecord,
} from '../types.ts';
import { DEFAULT_SIZE, DEFAULT_TEXT, framePreset, imageSize, newConnector, newFrame, newGroup, newImage, newLine, newShape, newText, type FramePresetId } from './defaults.ts';
import type { RecordedChange } from './animation.ts';
import { changeOfBasis, groupPatch, reexpressPatch } from './group.ts';
import type { AssistantPlan } from '../../shared/ai/assistant.js';
import { resolvePlan, type PlanView } from '../ai/plan.ts';

export const TEXT_STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'italic', 'underline', 'strike', 'color', 'align', 'lineHeight', 'autoWidth'] as const;
export const LABEL_STYLE_KEYS = ['labelFontSize', 'labelColor', 'labelAlign', 'labelVAlign'] as const;
// Claves opcionales del esquema: se pueden añadir aunque el registro aún no las tenga.
const OPTIONAL_KEYS = new Set<string>(['visible', 'opacity', 'alt', ...LABEL_STYLE_KEYS]);
export const STYLE_KEYS = [
  'fill',
  'stroke',
  'strokeWidth',
  'strokeDash',
  'shadow',
  'cornerRadius',
  'opacity',
  'visible',
  'route',
  'startCap',
  'endCap',
  'fit',
  'alt',
  'clip',
  ...TEXT_STYLE_KEYS,
  ...LABEL_STYLE_KEYS,
] as const;
type Cap = 'none' | 'arrow' | 'triangle' | 'circle' | 'bar';
export type StyleKey = (typeof STYLE_KEYS)[number];
export type StylePatch = Partial<{
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  strokeDash: 'solid' | 'dashed' | 'dotted';
  shadow: { x: number; y: number; blur: number; color: string } | null;
  cornerRadius: number;
  opacity: number;
  visible: boolean;
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  autoWidth: boolean;
  labelFontSize: number;
  labelColor: string;
  labelAlign: 'left' | 'center' | 'right';
  labelVAlign: 'top' | 'middle' | 'bottom';
  route: ConnectorRoute;
  startCap: Cap;
  endCap: Cap;
  fit: 'fill' | 'contain' | 'cover';
  alt: string | undefined;
  clip: boolean;
}>;

// Imagen ya subida y procesada por el servidor.
export type InsertableImage = { assetId: string; width: number | null; height: number | null; alt?: string };

type Patches = Map<string, Record<string, unknown>>;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const roundPoint = (p: Point): Point => ({ x: round3(p.x), y: round3(p.y) });

// Los deslizadores y el selector de color escriben al soltar o tras 250 ms quietos.
export const DEFERRED_STYLE_MS = 250;
const PASTE_OFFSET = 16;
// Texto pegado: por encima de tantos caracteres en una línea se parte a un ancho fijo.
const PASTE_WRAP_CHARS = 60;
const PASTE_TEXT_WIDTH = 480;
// Ancho medio de un carácter respecto al tamaño de la fuente, para estimar la caja antes de pintarlo.
const TEXT_CHAR_RATIO = 0.55;

export class Commands {
  private styleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStyle: { ids: string[]; patch: StylePatch } | null = null;

  // Ops de la transacción en curso.
  private ops: OpBuilder | null = null;

  // Modo «Grabar»: mover, girar y cambiar opacidad, relleno o trazo escriben keyframes en vez de cambiar el nodo.
  recorder: ((changes: RecordedChange[]) => void) | null = null;

  constructor(private readonly core: EditorCore) {}

  get canEdit(): boolean {
    return !this.core.readOnly.get();
  }

  // Cada comando es un paso de deshacer y una sola transacción. 'merge' se funde con el paso anterior (ajustes de
  // la escritura de texto).
  private transact(run: () => void, step: 'new' | 'merge' = 'new', origin: 'local' | 'ai' = 'local'): void {
    this.core.writer.transact({ step, origin }, (builder) => {
      this.ops = builder;
      try {
        run();
      } finally {
        this.ops = null;
      }
    });
  }

  private get w(): OpBuilder {
    if (!this.ops) throw new Error('Escritura fuera de una transacción');
    return this.ops;
  }

  private writeNode(record: NodeRecord): void {
    this.w.setNode(record);
  }

  // El host solo escribe las claves que cambian: reescribir valores iguales hace crecer el documento.
  private patchNode(id: string, patch: Record<string, unknown>): void {
    this.w.patchNode(id, patch);
  }

  private deleteNode(id: string): void {
    this.w.deleteNode(id);
    if (this.core.store.hasText(id)) this.w.deleteText(id);
  }

  private siblingsOf(parentId: string | null): NodeRecord[] {
    const page = this.core.activePage;
    if (!page) return [];
    return this.core.tree
      .childrenOf(page, parentId)
      .map((id) => this.core.record(id))
      .filter((r): r is NodeRecord => !!r)
      .sort(compareOrder);
  }

  private creationAllowed(count = 1): boolean {
    return this.canEdit && !!this.core.activePage && this.core.store.size + count <= DOCUMENT_LIMITS.createDisabledAtNodes;
  }

  // Dónde entra un nodo nuevo creado en `at` (coordenadas de la página): dentro del frame que haya debajo, con sus
  // coordenadas en el sistema de ese frame.
  private placeAt(at: Point): { parentId: string | null; toLocal: (p: Point) => Point; index: string; reindexed: Map<string, string> | null } {
    const parentId = this.core.frameAt(at.x, at.y);
    const parentWorld = this.core.tree.parentWorld(parentId);
    const back = parentWorld ? invertMat(parentWorld) : null;
    const { keys, reindexed } = keysOnTop(this.siblingsOf(parentId), 1);
    return { parentId, toLocal: (p) => (back ? apply(back, p.x, p.y) : p), index: keys[0]!, reindexed };
  }

  private writeCreated(record: NodeRecord, reindexed: Map<string, string> | null, text?: string): void {
    this.transact(() => {
      if (reindexed) for (const [sibling, index] of reindexed) this.patchNode(sibling, { index });
      this.writeNode(record);
      if (text !== undefined) this.w.setText(record.id, text);
    });
    this.core.setSelection([record.id]);
    this.core.writer.setSelectionAfter(this.core.selection.get());
  }

  private base(id: string, parentId: string | null, index: string) {
    return { id, pageId: this.core.activePage!, parentId, index, createdBy: this.core.user.id };
  }

  // ── Herramientas y selección ──

  // `locked` deja la herramienta activa después de crear; cualquier otro cambio de herramienta la desbloquea.
  setTool(tool: Tool, opts: { locked?: boolean } = {}): void {
    if (!this.canEdit && EDIT_TOOLS.has(tool)) return;
    this.core.toolLocked.set(tool !== 'select' && tool !== 'hand' && opts.locked === true);
    this.core.tool.set(tool);
    this.core.controller.cancel();
  }

  // Al terminar de crear: vuelve a Seleccionar salvo que la herramienta esté bloqueada.
  finishTool(): void {
    if (!this.core.toolLocked.get()) this.setTool('select');
  }

  // Enter con un solo texto o forma seleccionada abre su texto para editar.
  editSelectedText(): boolean {
    const ids = this.core.selection.get();
    return ids.length === 1 && this.core.startTextEdit(ids[0]!);
  }

  // Enter: en un grupo o un frame selecciona sus hijos; en un texto o una forma abre su texto.
  enterSelection(): boolean {
    const ids = this.core.selection.get();
    const page = this.core.activePage;
    if (ids.length !== 1 || !page) return false;
    const record = this.core.record(ids[0]!);
    if (!isContainer(record)) return this.editSelectedText();
    const children = this.core.tree.childrenOf(page, record.id).filter((id) => this.core.selectable(id)?.visible);
    if (!children.length) return false;
    if (record.type === 'group') this.core.scope = record.id;
    this.core.setSelection(children);
    return true;
  }

  // Shift+Enter (y Escape dentro de un contenedor): selecciona el contenedor.
  selectParent(): boolean {
    const ids = this.core.selection.get();
    const parent = ids.length ? this.core.tree.parent(ids[0]!) : null;
    if (!parent) return false;
    this.core.setSelection([parent]);
    return true;
  }

  escape(): void {
    if (!this.selectParent()) this.clearSelection();
  }

  // Tab y Shift+Tab con el foco en el lienzo: el siguiente o el anterior en orden z entre los hermanos de la
  // selección. Al pasar del último (o del primero) devuelve false y el foco sale del lienzo.
  focusNext(step: 1 | -1): boolean {
    const page = this.core.activePage;
    if (!page) return false;
    const ids = this.core.selection.get();
    const parent = ids.length ? this.core.tree.parent(ids[0]!) : this.core.scope;
    const list = this.core.tree.childrenOf(page, parent).filter((id) => this.core.selectable(id)?.visible && !this.core.tree.hiddenAbove(id));
    if (!list.length) return false;
    const current = ids.length === 1 ? list.indexOf(ids[0]!) : -1;
    const next = current === -1 ? (step > 0 ? 0 : list.length - 1) : current + step;
    if (next < 0 || next >= list.length) return false;
    this.core.setSelection([list[next]!]);
    this.core.revealSelection();
    return true;
  }

  select(ids: readonly string[]): void {
    this.core.setSelection(ids);
  }

  selectAll(): void {
    this.core.setSelection(this.core.selectableIds());
  }

  clearSelection(): void {
    this.core.setSelection([]);
  }

  // ── Crear ──

  createShape(type: BasicShapeType, box: Box): string | null {
    if (!this.creationAllowed()) return null;
    const id = newNodeId();
    const size = normalizeBox(box);
    const place = this.placeAt({ x: size.x + size.w / 2, y: size.y + size.h / 2 });
    const center = place.toLocal({ x: size.x + size.w / 2, y: size.y + size.h / 2 });
    const local = { x: round3(center.x - size.w / 2), y: round3(center.y - size.h / 2), w: size.w, h: size.h };
    const record = newShape(type, this.base(id, place.parentId, place.index), local);
    this.writeCreated(record, place.reindexed);
    return id;
  }

  createLine(from: { x: number; y: number }, to: { x: number; y: number }, arrow: boolean): string | null {
    if (!this.creationAllowed()) return null;
    const id = newNodeId();
    const place = this.placeAt({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    const record = newLine(this.base(id, place.parentId, place.index), place.toLocal(from), place.toLocal(to), arrow);
    this.writeCreated(record, place.reindexed);
    return id;
  }

  // Frame en una caja arrastrada o, sin caja, centrado en `at` con el tamaño de un preset.
  createFrame(box: Box, presetName?: string): string | null {
    if (!this.creationAllowed()) return null;
    const id = newNodeId();
    const size = normalizeBox(box);
    const place = this.placeAt({ x: size.x + size.w / 2, y: size.y + size.h / 2 });
    const center = place.toLocal({ x: size.x + size.w / 2, y: size.y + size.h / 2 });
    const record = newFrame(this.base(id, place.parentId, place.index), { x: center.x - size.w / 2, y: center.y - size.h / 2, w: size.w, h: size.h }, presetName);
    if (!NodeSchema.safeParse(record).success) return null;
    this.writeCreated(record, place.reindexed);
    return id;
  }

  createFrameFromPreset(presetId: FramePresetId, at: Point): string | null {
    const preset = framePreset(presetId);
    if (!preset) return null;
    return this.createFrame({ x: at.x - preset.w / 2, y: at.y - preset.h / 2, w: preset.w, h: preset.h }, preset.id);
  }

  // Cambia al tamaño de un preset los frames seleccionados (sus hijos se quedan donde están).
  applyFramePreset(presetId: FramePresetId): void {
    const preset = framePreset(presetId);
    if (!this.canEdit || !preset) return;
    const patches: Patches = new Map();
    const changed = new Map<string, NodeRecord>();
    for (const id of this.editableSelection()) {
      const record = this.core.record(id);
      if (record?.type !== 'frame') continue;
      const values = { w: preset.w, h: preset.h, presetName: preset.id };
      merge(patches, id, values);
      this.keepChildrenInPlace(record, values, patches);
      changed.set(id, { ...record, ...values });
    }
    if (!patches.size) return;
    for (const [connector, box] of this.connectorBoxPatches(changed)) merge(patches, connector, box);
    this.transact(() => {
      for (const [id, patch] of patches) this.patchNode(id, patch);
    });
  }

  // Conector entre dos extremos (anclados a un nodo o libres en coordenadas de la página).
  createConnector(from: ConnectorEnd, to: ConnectorEnd, route: ConnectorRoute = 'elbow'): string | null {
    if (!this.creationAllowed()) return null;
    const id = newNodeId();
    const { keys, reindexed } = keysOnTop(this.siblingsOf(null), 1);
    const base = this.base(id, null, keys[0]!);
    const draft = newConnector(base, from, to, { x: 0, y: 0, w: 0, h: 0, flipX: false, flipY: false }, route);
    const route0 = this.core.computeRoute(draft);
    const box = endpointBox(roundPoint({ x: route0[0]!, y: route0[1]! }), roundPoint({ x: route0[route0.length - 2]!, y: route0[route0.length - 1]! }));
    const record = newConnector(base, from, to, box, route);
    if (!NodeSchema.safeParse(record).success) return null;
    this.writeCreated(record, reindexed);
    return id;
  }

  // Cambia un extremo de un conector (al soltar su handle) y actualiza la caja de sus extremos.
  setConnectorEnd(id: string, which: 'from' | 'to', end: ConnectorEnd): void {
    const record = this.core.record(id);
    if (!this.canEdit || record?.type !== 'connector' || this.core.isLocked(id)) return;
    const next = { ...record, [which]: end } as ConnectorRecord;
    if (!NodeSchema.safeParse(next).success) return;
    this.transact(() => this.patchNode(id, { [which]: end, ...this.cacheFor(next) }));
  }

  // Caja de los extremos de un conector en el sistema de su padre (lo que lee la normalización del servidor).
  // `parentAfter`: matriz de mundo que tendrá el sistema del padre si también cambia en la misma transacción.
  private cacheFor(
    record: ConnectorRecord,
    moving?: (id: string) => Readonly<Mat> | null,
    replaced?: ReadonlyMap<string, NodeRecord>,
    parentAfter?: Readonly<Mat> | null,
  ): Record<string, unknown> {
    const route = this.core.computeRoute(record, moving, replaced);
    const parent = parentAfter ?? this.core.tree.parentWorld(this.core.tree.parent(record.id));
    const back = parent ? invertMat(parent) : null;
    const local = (x: number, y: number) => roundPoint(back ? apply(back, x, y) : { x, y });
    const box = endpointBox(local(route[0]!, route[1]!), local(route[route.length - 2]!, route[route.length - 1]!));
    return { x: box.x, y: box.y, w: box.w, h: box.h, flipX: box.flipX ? true : undefined, flipY: box.flipY ? true : undefined };
  }

  // Cajas de los extremos de los conectores anclados a nodos cuya caja cambia fuera de commitTransform; se
  // escriben en la misma transacción que el cambio.
  private connectorBoxPatches(changed: ReadonlyMap<string, NodeRecord>): Array<[string, Record<string, unknown>]> {
    const result: Array<[string, Record<string, unknown>]> = [];
    const seen = new Set<string>();
    for (const id of changed.keys()) {
      for (const connector of this.core.connectorsOf(id)) {
        if (seen.has(connector) || changed.has(connector)) continue;
        seen.add(connector);
        const record = this.core.record(connector);
        if (record?.type === 'connector' && !record.locked) result.push([connector, this.cacheFor(record, undefined, changed)]);
      }
    }
    return result;
  }

  // Un conector que pasa a medirse en otro sistema (`change` lleva el viejo al nuevo): sus extremos libres y la
  // caja de sus extremos.
  private reexpressConnector(record: ConnectorRecord, change: Readonly<Mat>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const which of ['from', 'to'] as const) {
      const end = record[which];
      if (!('nodeId' in end)) patch[which] = roundPoint(apply(change, end.x, end.y));
    }
    const ends = this.core.connectorEndpoints(record.id);
    if (ends) {
      const box = endpointBox(roundPoint(apply(change, ends.from.x, ends.from.y)), roundPoint(apply(change, ends.to.x, ends.to.y)));
      Object.assign(patch, { x: box.x, y: box.y, w: box.w, h: box.h, flipX: box.flipX ? true : undefined, flipY: box.flipY ? true : undefined });
    }
    return patch;
  }

  private reexpress(record: NodeRecord, change: Readonly<Mat>): Record<string, unknown> {
    return record.type === 'connector' ? this.reexpressConnector(record, change) : reexpressPatch(record, change);
  }

  // Al cambiar la caja de un frame, sus hijos se vuelven a expresar en la caja nueva para quedarse donde están.
  private keepChildrenInPlace(record: FrameRecord, values: Record<string, unknown>, patches: Patches): void {
    const page = this.core.activePage;
    if (!page) return;
    const before = localMatrix(record);
    const after = localMatrix(applyPatch(record, values as TransformPatch));
    const change = compose(invertMat(after), before);
    for (const childId of this.core.tree.childrenOf(page, record.id)) {
      const child = this.core.record(childId);
      if (child) merge(patches, childId, this.reexpress(child, change));
    }
  }

  // Imagen nueva centrada en `at` (coordenadas de la página), con el tamaño natural reducido si es grande.
  insertImage(image: InsertableImage, at: Point): string | null {
    if (!this.creationAllowed()) return null;
    const id = newNodeId();
    const place = this.placeAt(at);
    const center = place.toLocal(at);
    const size = imageSize(image.width, image.height);
    const alt = image.alt?.trim().slice(0, DOCUMENT_LIMITS.maxAltLength);
    const record = newImage(this.base(id, place.parentId, place.index), image.assetId, { x: center.x - size.w / 2, y: center.y - size.h / 2, ...size }, alt || undefined);
    if (!NodeSchema.safeParse(record).success) return null;
    this.writeCreated(record, place.reindexed);
    return id;
  }

  // Texto nuevo en un punto (ancho automático) o en una caja arrastrada (ancho fijo), con su Y.Text vacío.
  createText(at: { x: number; y: number }, width: number | null = null): string | null {
    if (!this.creationAllowed()) return null;
    const id = newNodeId();
    const place = this.placeAt(at);
    const record = newText(this.base(id, place.parentId, place.index), place.toLocal(at), width);
    this.writeCreated(record, place.reindexed, '');
    return id;
  }

  // Garantiza que el nodo tiene su texto (el texto interior de una forma se crea al editarlo por primera vez).
  ensureText(id: string): boolean {
    const record = this.core.record(id);
    if (!this.canEdit || !hasTextContent(record)) return false;
    if (this.core.store.hasText(id)) return true;
    this.transact(() => this.w.setText(id, ''));
    return true;
  }

  // Al salir del editor: un texto vacío se borra; una forma solo pierde su texto interior vacío.
  discardEmptyText(id: string): void {
    if (!this.canEdit) return;
    const record = this.core.record(id);
    const store = this.core.store;
    const hasText = store.hasText(id);
    if (!record) {
      if (hasText) this.transact(() => this.w.deleteText(id), 'merge');
      return;
    }
    const empty = !hasText || store.text(id).trim() === '';
    if (!empty) return;
    // Si otra persona lo está editando, lo que escriba iría a un texto borrado: se queda para ella.
    for (const state of this.core.presence.remote().values()) {
      if (state.editingText?.nodeId === id) return;
    }
    if (record.type === 'text') {
      const detach = this.detachPatches(new Set([id]));
      this.transact(() => {
        for (const [connector, patch] of detach) this.patchNode(connector, patch);
        this.w.deleteNode(id);
        this.w.deleteText(id);
      }, 'merge');
      this.core.setSelection(this.core.selection.get().filter((selected) => selected !== id));
    } else if (hasText) {
      this.transact(() => this.w.deleteText(id), 'merge');
    }
  }

  // Ajusta la caja de un texto a lo que ocupa mientras se escribe; se funde con el paso de deshacer de la escritura.
  fitText(id: string, size: { w?: number; h: number }): void {
    const record = this.core.record(id);
    if (!this.canEdit || record?.type !== 'text') return;
    const patch: Record<string, unknown> = {};
    const round = (value: number) => Math.max(1, Math.min(DOCUMENT_LIMITS.maxSize, Math.ceil(value)));
    if (size.w !== undefined && Math.abs(round(size.w) - record.w) >= 1) patch.w = round(size.w);
    if (Math.abs(round(size.h) - record.h) >= 1) patch.h = round(size.h);
    if (!Object.keys(patch).length) return;
    const connectors = this.connectorBoxPatches(new Map([[id, { ...record, ...patch } as NodeRecord]]));
    this.transact(() => {
      this.patchNode(id, patch);
      for (const [connector, box] of connectors) this.patchNode(connector, box);
    }, 'merge');
  }

  // ── Transformar ──

  // Traduce la matriz del gesto (en mundo) a x, y, w, h, rotation (y puntos) de cada nodo, en una transacción.
  // Un grupo que se mueve o gira cambia solo su origen; al redimensionarlo se transforman sus miembros. Un frame
  // que se redimensiona cambia su caja y sus hijos se quedan donde están. `drop`: punto donde se soltó un
  // arrastre; lo que cae sobre un frame entra en él y lo que sale de su frame vuelve a la página.
  commitTransform(ids: readonly string[], matrix: Readonly<Mat>, options: { drop?: Point } = {}): void {
    if (!this.canEdit) return;
    const core = this.core;
    const tree = core.tree;
    const page = core.activePage;
    if (!page) return;
    const selected = new Set(ids);
    const roots = ids.filter((id) => {
      for (let parent = tree.parent(id); parent; parent = tree.parent(parent)) if (selected.has(parent)) return false;
      return true;
    });
    const patches: Patches = new Map();
    // Matriz de mundo con la que se mueve cada nodo afectado, y matriz de mundo que tendrá el sistema de los hijos
    // de cada contenedor que cambia.
    const delta = new Map<string, Mat>();
    const systems = new Map<string, Mat>();
    // Conectores cuyos extremos libres se transforman con la matriz.
    const freeEnds = new Set<string>();
    const rigid = isRigid(matrix);
    const parentWorldOf = (id: string) => tree.parentWorld(tree.parent(id));
    const carry = (id: string, m: Readonly<Mat>) => {
      for (const child of tree.descendants(id)) {
        delta.set(child, m as Mat);
        const record = core.record(child);
        if (isContainer(record)) systems.set(child, multiply(m, tree.worldMatrix(record)));
      }
    };
    const moveLeaf = (record: NodeRecord) => {
      delta.set(record.id, matrix as Mat);
      if (record.type === 'connector') freeEnds.add(record.id);
      else merge(patches, record.id, transformPatch(record, matrix, parentWorldOf(record.id)));
    };
    const resizeFrame = (record: FrameRecord, keepChildren: boolean) => {
      const values: Record<string, unknown> = { ...transformPatch(record, matrix, parentWorldOf(record.id)), presetName: undefined };
      merge(patches, record.id, values);
      delta.set(record.id, matrix as Mat);
      const after = tree.parentWorld(tree.parent(record.id));
      const local = localMatrix(applyPatch(record, values as TransformPatch));
      const world = after ? multiply(after, local) : local;
      systems.set(record.id, world);
      if (keepChildren) {
        this.keepChildrenInPlace(record, values, patches);
      } else {
        // Dentro de un grupo que se escala, lo que hay en el frame se mueve con él sin escalarse.
        carry(record.id, multiply(world, invertMat(tree.worldMatrix(record))));
      }
    };
    const scaleMembers = (groupId: string) => {
      for (const childId of tree.childrenOf(page, groupId)) {
        const child = core.record(childId);
        if (!child) continue;
        if (child.type === 'group') scaleMembers(childId);
        else if (child.type === 'frame') resizeFrame(child, false);
        else moveLeaf(child);
      }
    };

    if (this.recorder && rigid) {
      this.recordTransform(roots, matrix);
      return;
    }

    for (const id of roots) {
      const record = core.record(id);
      if (!record || core.isLocked(id)) continue;
      if (record.type === 'group') {
        if (rigid) {
          const parentWorld = parentWorldOf(id);
          const inParent = parentWorld ? compose(invertMat(parentWorld), matrix, parentWorld) : matrix;
          merge(patches, id, groupPatch(record, inParent));
          delta.set(id, matrix as Mat);
          systems.set(id, multiply(matrix, tree.worldMatrix(record)));
          carry(id, matrix);
        } else {
          scaleMembers(id);
        }
        continue;
      }
      if (record.type === 'frame') {
        if (rigid) {
          merge(patches, id, transformPatch(record, matrix, parentWorldOf(id)));
          delta.set(id, matrix as Mat);
          systems.set(id, multiply(matrix, tree.worldMatrix(record)));
          carry(id, matrix);
        } else {
          resizeFrame(record, true);
        }
        continue;
      }
      moveLeaf(record);
    }

    // Conectores: los extremos libres se transforman con el conector; los anclados siguen a su nodo, también
    // cuando ese nodo cuelga de un contenedor movido. La caja de los extremos se pone al día en todos.
    const moving = (id: string) => delta.get(id) ?? null;
    const connectors = new Set<string>();
    for (const id of delta.keys()) {
      if (core.record(id)?.type === 'connector') connectors.add(id);
      for (const connector of core.connectorsOf(id)) connectors.add(connector);
    }
    for (const id of connectors) {
      const record = core.record(id);
      if (record?.type !== 'connector' || (core.isLocked(id) && !delta.has(id))) continue;
      const patch: Record<string, unknown> = {};
      if (freeEnds.has(id)) {
        const parentWorld = parentWorldOf(id);
        const toParent = parentWorld ? invertMat(parentWorld) : null;
        for (const which of ['from', 'to'] as const) {
          const end = record[which];
          if ('nodeId' in end) continue;
          const world = parentWorld ? apply(parentWorld, end.x, end.y) : end;
          const next = apply(matrix, world.x, world.y);
          patch[which] = roundPoint(toParent ? apply(toParent, next.x, next.y) : next);
        }
      }
      const parent = tree.parent(id);
      Object.assign(patch, this.cacheFor(record, moving, undefined, parent ? systems.get(parent) : undefined));
      merge(patches, id, patch);
    }

    if (options.drop && rigid) this.dropInto(roots, options.drop, patches);
    if (!patches.size) return;
    this.transact(() => {
      for (const [id, patch] of patches) this.patchNode(id, patch);
    });
  }

  // Un movimiento o giro en modo «Grabar»: el desplazamiento y el giro de cada nodo, en el sistema de su padre.
  private recordTransform(roots: readonly string[], matrix: Readonly<Mat>): void {
    const core = this.core;
    const changes: RecordedChange[] = [];
    for (const id of roots) {
      const record = core.record(id);
      if (!record || record.type === 'connector' || core.isLocked(id)) continue;
      const parentWorld = core.tree.parentWorld(core.tree.parent(id));
      const inParent = parentWorld ? compose(invertMat(parentWorld), matrix, parentWorld) : ([...matrix] as Mat);
      // Una línea guarda el giro en sus puntos: solo se graba su desplazamiento.
      if (record.type === 'line' && !isTranslation(inParent)) continue;
      const next = record.type === 'group' ? groupPatch(record, inParent) : transformPatch(record, matrix, parentWorld);
      const dx = round3((next.x ?? record.x) - record.x);
      const dy = round3((next.y ?? record.y) - record.y);
      const rotation = record.type === 'line' ? 0 : normalizeAngle((next.rotation ?? record.rotation) - record.rotation);
      if (dx) changes.push({ id, prop: 'offsetX', value: dx, relative: true });
      if (dy) changes.push({ id, prop: 'offsetY', value: dy, relative: true });
      if (Math.abs(rotation) > 1e-6) changes.push({ id, prop: 'rotation', value: rotation, relative: true });
    }
    if (changes.length) this.recorder?.(changes);
  }

  // Los nodos soltados sobre un frame entran en él; los que salen de su frame vuelven a la página. Los hijos de un
  // grupo y los conectores se quedan en su sitio.
  private dropInto(roots: readonly string[], drop: Point, patches: Patches): void {
    const core = this.core;
    const tree = core.tree;
    const page = core.activePage!;
    const exclude = new Set<string>();
    for (const id of roots) {
      exclude.add(id);
      for (const child of tree.descendants(id)) exclude.add(child);
    }
    const target = core.frameAt(drop.x, drop.y, exclude);
    const order = tree.paintOrder(page);
    const moving = roots
      .filter((id) => {
        const record = core.record(id);
        if (!record || record.type === 'connector' || core.isLocked(id)) return false;
        const parent = tree.parent(id);
        if (parent === target) return false;
        return !parent || core.record(parent)?.type === 'frame';
      })
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!moving.length) return;
    const targetWorld = tree.parentWorld(target);
    const { keys, reindexed } = keysOnTop(this.siblingsOf(target), moving.length);
    if (reindexed) for (const [sibling, index] of reindexed) merge(patches, sibling, { index });
    moving.forEach((id, i) => {
      const record = core.record(id)!;
      const moved = applyPatch(record, (patches.get(id) ?? {}) as TransformPatch);
      const change = changeOfBasis(tree.parentWorld(tree.parent(id)), targetWorld);
      merge(patches, id, { ...reexpressPatch(moved, change), parentId: target, index: keys[i]! });
    });
  }

  setLinePoints(id: string, absolute: Array<[number, number]>): void {
    const record = this.core.record(id);
    if (!this.canEdit || !record || record.type !== 'line' || this.core.isLocked(id)) return;
    const minX = Math.min(...absolute.map(([x]) => x));
    const minY = Math.min(...absolute.map(([, y]) => y));
    const maxX = Math.max(...absolute.map(([x]) => x));
    const maxY = Math.max(...absolute.map(([, y]) => y));
    const patch = {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      rotation: 0,
      points: absolute.map(([x, y]) => [x - minX, y - minY]),
    };
    const connectors = this.connectorBoxPatches(new Map([[id, { ...record, ...patch } as NodeRecord]]));
    this.transact(() => {
      this.patchNode(id, patch);
      for (const [connector, box] of connectors) this.patchNode(connector, box);
    });
  }

  nudge(dx: number, dy: number): void {
    const ids = this.editableSelection();
    if (ids.length) this.commitTransform(ids, [1, 0, 0, 1, dx, dy]);
  }

  private editableSelection(): string[] {
    return this.core.selection.get().filter((id) => !this.core.isLocked(id));
  }

  // Un contenedor se borra con todo lo que cuelga de él.
  deleteSelection(): void {
    if (!this.canEdit) return;
    const ids = this.editableSelection();
    if (!ids.length) return;
    const all = new Set<string>();
    for (const id of ids) {
      all.add(id);
      for (const child of this.core.tree.descendants(id)) all.add(child);
    }
    const detach = this.detachPatches(all);
    this.transact(() => {
      for (const [id, patch] of detach) this.patchNode(id, patch);
      for (const id of all) this.deleteNode(id);
    });
    this.core.setSelection([]);
  }

  // Los conectores que se quedan sin el nodo de un extremo conservan su último punto como coordenada libre; se
  // escribe en la misma transacción que el borrado.
  private detachPatches(deleted: ReadonlySet<string>): Array<[string, Record<string, unknown>]> {
    const result: Array<[string, Record<string, unknown>]> = [];
    const seen = new Set<string>();
    for (const id of deleted) {
      for (const connector of this.core.connectorsOf(id)) {
        if (deleted.has(connector) || seen.has(connector)) continue;
        seen.add(connector);
        const record = this.core.record(connector);
        const ends = this.core.connectorEndpoints(connector);
        if (record?.type !== 'connector' || !ends) continue;
        const patch: Record<string, unknown> = {};
        for (const which of ['from', 'to'] as const) {
          const end = record[which];
          if ('nodeId' in end && deleted.has(end.nodeId)) patch[which] = roundPoint(ends[which]);
        }
        if (Object.keys(patch).length) result.push([connector, patch]);
      }
    }
    return result;
  }

  // ── Agrupar ──

  // Ctrl+G: un grupo nuevo en el sitio del elemento más alto de la selección, con los seleccionados dentro
  // (coordenadas convertidas al grupo e índices nuevos), en una sola transacción.
  groupSelection(): string | null {
    if (!this.creationAllowed()) return null;
    const core = this.core;
    const tree = core.tree;
    const page = core.activePage!;
    const order = tree.paintOrder(page);
    const ids = this.editableSelection().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!ids.length) return null;
    const top = core.record(ids.at(-1)!);
    if (!top) return null;
    const parentId = tree.parent(top.id);
    const parentWorld = tree.parentWorld(parentId);
    const bounds = core.boundsOf(ids);
    const corner = parentWorld ? apply(invertMat(parentWorld), bounds.minX, bounds.minY) : { x: bounds.minX, y: bounds.minY };
    const origin = roundPoint(Number.isFinite(corner.x) && Number.isFinite(corner.y) ? corner : { x: top.x, y: top.y });
    const id = newNodeId();
    const group = newGroup(this.base(id, parentId, top.index), origin);
    if (!NodeSchema.safeParse(group).success) return null;
    const groupWorld = parentWorld ? multiply(parentWorld, translation(origin.x, origin.y)) : translation(origin.x, origin.y);
    const keys = keysBetween(null, null, ids.length)!;
    const patches: Patches = new Map();
    ids.forEach((childId, i) => {
      const record = core.record(childId)!;
      const change = changeOfBasis(tree.parentWorld(tree.parent(childId)), groupWorld);
      merge(patches, childId, { ...this.reexpress(record, change), parentId: id, index: keys[i]! });
    });
    this.transact(() => {
      this.writeNode(group);
      for (const [nodeId, patch] of patches) this.patchNode(nodeId, patch);
    });
    core.setSelection([id]);
    core.writer.setSelectionAfter(core.selection.get());
    return id;
  }

  // Ctrl+Shift+G: los hijos de cada grupo (o frame) seleccionado pasan a su padre en el sitio del contenedor, que
  // se borra.
  ungroupSelection(): string[] {
    if (!this.canEdit) return [];
    const core = this.core;
    const tree = core.tree;
    const page = core.activePage;
    if (!page) return [];
    const containers = this.editableSelection()
      .map((id) => core.record(id))
      .filter((record): record is ContainerRecord => isContainer(record));
    if (!containers.length) return [];
    const patches: Patches = new Map();
    const removed = new Set<string>();
    const released: string[] = [];
    for (const container of containers) {
      const parentId = tree.parent(container.id);
      const children = this.siblingsOf(container.id);
      removed.add(container.id);
      if (!children.length) continue;
      const siblings = this.siblingsOf(parentId);
      const position = siblings.findIndex((record) => record.id === container.id);
      const before = siblings[position - 1]?.index ?? null;
      const after = siblings[position + 1]?.index ?? null;
      let keys = keysBetween(before, after, children.length);
      if (!keys || needsReindex(keys)) {
        const target = [...siblings.slice(0, position), ...children, ...siblings.slice(position + 1)];
        const indexes = reindex(target);
        for (const sibling of siblings) if (sibling.id !== container.id) merge(patches, sibling.id, { index: indexes.get(sibling.id)! });
        keys = children.map((child) => indexes.get(child.id)!);
      }
      const change = localMatrix(container);
      children.forEach((child, i) => {
        merge(patches, child.id, { ...this.reexpress(child, change), parentId, index: keys[i]! });
        released.push(child.id);
      });
    }
    const detach = this.detachPatches(removed);
    this.transact(() => {
      for (const [id, patch] of patches) this.patchNode(id, patch);
      for (const [id, patch] of detach) this.patchNode(id, patch);
      for (const id of removed) this.w.deleteNode(id);
    });
    core.setSelection(released);
    core.writer.setSelectionAfter(core.selection.get());
    return released;
  }

  // ── Copias ──

  // La selección con todo lo que cuelga de sus contenedores, de arriba abajo.
  private selectionWithDescendants(): NodeRecord[] {
    const records: NodeRecord[] = [];
    for (const id of this.core.selection.get()) {
      const record = this.core.record(id);
      if (!record) continue;
      records.push(record);
      for (const child of this.core.tree.descendants(id)) {
        const descendant = this.core.record(child);
        if (descendant) records.push(descendant);
      }
    }
    return records;
  }

  duplicateSelection(): void {
    const records = this.selectionWithDescendants();
    this.insertCopies(records, { x: PASTE_OFFSET, y: PASTE_OFFSET }, this.textsOf(records), true);
  }

  private textsOf(records: readonly NodeRecord[]): Record<string, string> {
    const texts: Record<string, string> = {};
    for (const record of records) {
      const content = hasTextContent(record) ? this.core.store.text(record.id) : '';
      if (content) texts[record.id] = content;
    }
    return texts;
  }

  // Los nodos cuyo padre va en la copia cuelgan de la copia de ese padre; los demás van encima de todo, en su
  // contenedor (al duplicar) o en la página.
  private insertCopies(records: readonly NodeRecord[], offset: Point, texts: Record<string, string> = {}, keepParents = false): string[] {
    if (!records.length || !this.creationAllowed(records.length)) return [];
    const page = this.core.activePage!;
    const byId = new Map(records.map((record) => [record.id, record]));
    const newIds = new Map(records.map((record) => [record.id, newNodeId()]));
    const isTop = (record: NodeRecord) => !record.parentId || !byId.has(record.parentId);
    const destination = (record: NodeRecord): string | null => {
      if (!keepParents || !this.core.record(record.id)) return null;
      return this.core.tree.parent(record.id);
    };
    const order = this.core.tree.paintOrder(page);
    const rank = (record: NodeRecord) => {
      const at = order.indexOf(record.id);
      return at === -1 ? Number.MAX_SAFE_INTEGER : at;
    };
    const tops = records.filter(isTop).sort((a, b) => rank(a) - rank(b) || compareOrder(a, b));
    const byParent = new Map<string | null, NodeRecord[]>();
    for (const record of tops) {
      const parent = destination(record);
      const list = byParent.get(parent) ?? [];
      list.push(record);
      byParent.set(parent, list);
    }
    const reindexedAll: Array<[string, string]> = [];
    const placed = new Map<string, { parentId: string | null; index: string }>();
    for (const [parent, list] of byParent) {
      const { keys, reindexed } = keysOnTop(this.siblingsOf(parent), list.length);
      if (reindexed) reindexedAll.push(...reindexed);
      list.forEach((record, i) => placed.set(record.id, { parentId: parent, index: keys[i]! }));
    }
    const copies: Array<{ record: NodeRecord; text: string }> = [];
    const still = { x: 0, y: 0 };
    for (const record of records) {
      const top = placed.get(record.id);
      const shift = top ? offset : still;
      const candidate: Record<string, unknown> = {
        ...record,
        id: newIds.get(record.id)!,
        pageId: page,
        parentId: top ? top.parentId : newIds.get(record.parentId!)!,
        index: top ? top.index : record.index,
        createdBy: this.core.user.id,
        x: round3(record.x + shift.x),
        y: round3(record.y + shift.y),
      };
      if (record.type === 'connector') Object.assign(candidate, this.copiedEnds(record, newIds, shift));
      const parsed = NodeSchema.safeParse(candidate);
      const text = texts[record.id];
      if (parsed.success) copies.push({ record: parsed.data, text: typeof text === 'string' ? text.slice(0, DOCUMENT_LIMITS.maxTextLength) : '' });
    }
    if (!copies.length) return [];
    this.transact(() => {
      for (const [sibling, index] of reindexedAll) this.patchNode(sibling, { index });
      for (const { record, text } of copies) {
        this.writeNode(record);
        if (text) this.w.setText(record.id, text);
      }
    });
    const written = new Set(copies.map((copy) => copy.record.id));
    const ids = tops.map((record) => newIds.get(record.id)!).filter((id) => written.has(id));
    this.core.setSelection(ids);
    this.core.writer.setSelectionAfter(this.core.selection.get());
    return ids;
  }

  // ── Asistente de IA ──

  // sync: false desde el propio frame, que ya sincronizó el modelo.
  planView(sync = true): PlanView {
    const core = this.core;
    if (sync) core.syncModel();
    return {
      pageId: core.activePage ?? '',
      userId: core.user.id,
      get: (id) => core.store.get(id),
      isLocked: (id) => core.isLocked(id),
      children: (parentId) => this.siblingsOf(parentId),
      descendants: (id) => core.tree.descendants(id),
    };
  }

  // Plan ya aceptado por el usuario: se revalida contra el documento actual y se escribe en una sola transacción
  // con origen IA, que es un único paso de deshacer.
  applyAiPlan(plan: AssistantPlan): { applied: number; skipped: number } {
    if (!this.canEdit || !this.core.activePage) return { applied: 0, skipped: plan.ops.length };
    const resolved = resolvePlan(plan, this.planView());
    if (resolved.creates.length && !this.creationAllowed(resolved.creates.length)) {
      resolved.skipped += resolved.creates.length;
      resolved.creates = [];
    }
    const removed = new Set<string>();
    for (const id of resolved.deletes) {
      removed.add(id);
      for (const child of this.core.tree.descendants(id)) removed.add(child);
    }
    const applied = resolved.creates.length + resolved.updates.length + resolved.deletes.length;
    if (!applied) return { applied: 0, skipped: resolved.skipped };
    const detach = this.detachPatches(removed);
    this.transact(
      () => {
        for (const [id, index] of resolved.reindexed) if (!removed.has(id)) this.patchNode(id, { index });
        for (const update of resolved.updates) {
          if (Object.keys(update.patch).length) this.patchNode(update.id, update.patch);
          if (update.text !== null) this.w.setText(update.id, update.text);
        }
        for (const [id, patch] of detach) this.patchNode(id, patch);
        for (const id of removed) this.deleteNode(id);
        for (const { record, text } of resolved.creates) {
          this.writeNode(record);
          if (text) this.w.setText(record.id, text);
        }
      },
      'new',
      'ai',
    );
    const created = resolved.creates.filter(({ record }) => !record.parentId || !resolved.creates.some((other) => other.record.id === record.parentId));
    const focus = created.length ? created.map(({ record }) => record.id) : resolved.updates.map((update) => update.id);
    this.core.setSelection(focus);
    this.core.writer.setSelectionAfter(this.core.selection.get());
    return { applied, skipped: resolved.skipped };
  }

  // Un extremo anclado a un nodo copiado pasa a la copia; anclado a otro nodo, se queda en su punto actual.
  private copiedEnds(record: ConnectorRecord, newIds: ReadonlyMap<string, string>, offset: Point): { from: ConnectorEnd; to: ConnectorEnd } {
    const tree = this.core.tree;
    let current = this.core.record(record.id)?.type === 'connector' ? this.core.connectorEndpoints(record.id) : null;
    const liveParent = current ? tree.parent(record.id) : null;
    // El portapapeles guarda en la página los conectores de arriba; los extremos vivos siguen en su padre.
    if (current && liveParent && !record.parentId) {
      const change = changeOfBasis(tree.parentWorld(liveParent), null);
      current = { from: apply(change, current.from.x, current.from.y), to: apply(change, current.to.x, current.to.y) };
    }
    const points = current ?? endpointsFromBox(record);
    const result = {} as { from: ConnectorEnd; to: ConnectorEnd };
    for (const which of ['from', 'to'] as const) {
      const end = record[which];
      if ('nodeId' in end) {
        const target = newIds.get(end.nodeId);
        result[which] = target ? { nodeId: target, anchor: end.anchor } : roundPoint({ x: points[which].x + offset.x, y: points[which].y + offset.y });
      } else {
        result[which] = roundPoint({ x: end.x + offset.x, y: end.y + offset.y });
      }
    }
    return result;
  }

  // ── Orden z, bloqueo y visibilidad ──

  zOrder(move: ZMove): void {
    if (!this.canEdit) return;
    const selected = new Set(this.core.selection.get());
    if (!selected.size) return;
    const byParent = new Map<string | null, NodeRecord[]>();
    const page = this.core.activePage;
    if (!page) return;
    for (const id of selected) {
      const parent = this.core.tree.parent(id);
      if (!byParent.has(parent)) {
        const siblings = this.core.tree
          .childrenOf(page, parent)
          .map((sibling) => this.core.record(sibling))
          .filter((r): r is NodeRecord => !!r);
        byParent.set(parent, siblings);
      }
    }
    const updates = new Map<string, string>();
    for (const siblings of byParent.values()) {
      for (const [id, index] of zOrderIndexes(siblings, selected, move)) {
        if (this.core.record(id)?.index !== index) updates.set(id, index);
      }
    }
    if (!updates.size) return;
    this.transact(() => {
      for (const [id, index] of updates) this.patchNode(id, { index });
    });
  }

  setLocked(locked: boolean): void {
    this.setFlag('locked', locked);
  }

  toggleLocked(): void {
    const records = this.core.selectionRecords.get();
    this.setLocked(!records.every((record) => record.locked));
  }

  setVisible(visible: boolean): void {
    this.setFlag('visible', visible);
  }

  toggleHidden(): void {
    const records = this.core.selectionRecords.get();
    this.setVisible(!records.every((record) => record.visible));
  }

  private setFlag(key: 'locked' | 'visible', value: boolean): void {
    this.setFlagFor(this.core.selection.get(), key, value);
  }

  // Desde el panel de capas: ocultar o bloquear un nodo concreto, esté seleccionado o no.
  setFlagFor(ids: readonly string[], key: 'locked' | 'visible', value: boolean): void {
    if (!this.canEdit) return;
    const changed = ids.filter((id) => {
      const record = this.core.record(id);
      return record && record[key] !== value;
    });
    if (!changed.length) return;
    this.transact(() => {
      for (const id of changed) this.patchNode(id, { [key]: value });
    });
    this.core.markOverlayDirty();
  }

  // Nombre en el panel de capas; vacío vuelve al nombre por tipo.
  renameNode(id: string, name: string): void {
    const record = this.core.record(id);
    if (!this.canEdit || !record) return;
    const next = name.trim().slice(0, DOCUMENT_LIMITS.maxNameLength);
    if ((record.name ?? '') === next) return;
    this.transact(() => this.patchNode(id, { name: next || undefined }));
  }

  // ── Páginas ──

  private sortedPages() {
    return [...this.core.store.pages()];
  }

  get canAddPage(): boolean {
    return this.canEdit && this.sortedPages().length < DOCUMENT_LIMITS.maxPages;
  }

  // Página nueva al final, que pasa a ser la activa.
  createPage(name: string): string | null {
    this.core.syncModel();
    const pages = this.sortedPages();
    if (!this.canAddPage) return null;
    const value = name.trim().slice(0, DOCUMENT_LIMITS.maxNameLength);
    let index = keysBetween(pages.at(-1)?.index ?? null, null, 1)?.[0] ?? null;
    let reindexed: Map<string, string> | null = null;
    if (!index || needsReindex([index]) || needsReindex(pages.map((page) => page.index))) {
      const keys = keysBetween(null, null, pages.length + 1)!;
      reindexed = new Map(pages.map((page, i) => [page.id, keys[i]!]));
      index = keys.at(-1)!;
    }
    if (!PageSchema.safeParse({ name: value, index }).success) return null;
    const id = newNodeId();
    this.transact(() => {
      if (reindexed) for (const [pageId, key] of reindexed) this.w.patchPage(pageId, { index: key });
      this.w.setPage(id, { name: value, index: index! });
    });
    this.core.syncModel();
    this.core.setPage(id);
    return id;
  }

  renamePage(id: string, name: string): void {
    const value = name.trim().slice(0, DOCUMENT_LIMITS.maxNameLength);
    const page = this.core.store.pages().find((item) => item.id === id);
    if (!this.canEdit || !value || !page || page.name === value) return;
    this.transact(() => this.w.patchPage(id, { name: value }));
  }

  // Sube o baja una página un puesto con un índice fraccional entre sus nuevos vecinos.
  movePage(id: string, step: -1 | 1): void {
    if (!this.canEdit) return;
    this.core.syncModel();
    const pages = this.sortedPages();
    const from = pages.findIndex((page) => page.id === id);
    const to = from + step;
    if (from === -1 || to < 0 || to >= pages.length) return;
    const rest = pages.filter((page) => page.id !== id);
    const before = rest[to - 1]?.index ?? null;
    const after = rest[to]?.index ?? null;
    const key = keysBetween(before, after, 1)?.[0] ?? null;
    const updates = new Map<string, string>();
    if (key && !needsReindex([key])) {
      updates.set(id, key);
    } else {
      const target = [...rest.slice(0, to), pages[from]!, ...rest.slice(to)];
      for (const [pageId, index] of reindex(target)) updates.set(pageId, index);
    }
    this.transact(() => {
      for (const [pageId, index] of updates) this.w.patchPage(pageId, { index });
    });
  }

  // Borra una página con todo lo que tiene. La última no se puede borrar.
  deletePage(id: string): boolean {
    if (!this.canEdit) return false;
    this.core.syncModel();
    const pages = this.sortedPages();
    if (pages.length <= 1 || !pages.some((page) => page.id === id)) return false;
    const doomed = [...this.core.store.all()].filter((record) => record.pageId === id).map((record) => record.id);
    if (this.core.activePage === id) {
      const next = pages.find((page) => page.id !== id)!;
      this.core.setPage(next.id);
    }
    this.transact(() => {
      for (const nodeId of doomed) {
        this.deleteNode(nodeId);
      }
      this.w.deletePage(id);
    });
    return true;
  }

  setPage(id: string): void {
    this.core.setPage(id);
  }

  // ── Estilo ──

  // Aplica el estilo a cada nodo que lo admite y descarta lo que dejaría un nodo inválido.
  private stylePatches(ids: readonly string[], patch: StylePatch): Array<[string, Record<string, unknown>]> {
    const result: Array<[string, Record<string, unknown>]> = [];
    for (const id of ids) {
      const record = this.core.record(id);
      if (!record || this.core.isLocked(id)) continue;
      const own: Record<string, unknown> = {};
      for (const key of STYLE_KEYS) {
        if (!(key in patch)) continue;
        if (!(key in record) && !OPTIONAL_KEYS.has(key)) continue;
        if (key.startsWith('label') && !hasLabel(record)) continue;
        if (key === 'fill' && (record.type === 'line' || record.type === 'connector')) continue;
        if (key === 'alt' && record.type !== 'image') continue;
        let value = patch[key] as unknown;
        if (key === 'cornerRadius' && typeof value === 'number') value = Math.max(0, Math.min(value, Math.min(record.w, record.h) / 2));
        own[key] = value;
      }
      if (!Object.keys(own).length) continue;
      if (NodeSchema.safeParse({ ...record, ...own }).success) result.push([id, own]);
    }
    return result;
  }

  setStyle(patch: StylePatch, ids: readonly string[] = this.core.selection.get()): void {
    if (!this.canEdit) return;
    this.cancelPreview();
    if (this.recorder) patch = this.recordStyle(patch, ids);
    const patches = this.stylePatches(ids, patch);
    if (!patches.length) return;
    this.transact(() => {
      for (const [id, own] of patches) this.patchNode(id, own);
    });
  }

  // En modo «Grabar», la opacidad, el relleno y el trazo van a keyframes; devuelve el resto del estilo.
  private recordStyle(patch: StylePatch, ids: readonly string[]): StylePatch {
    const changes: RecordedChange[] = [];
    for (const id of ids) {
      const record = this.core.record(id);
      if (!record || record.type === 'connector' || this.core.isLocked(id)) continue;
      if (typeof patch.opacity === 'number') changes.push({ id, prop: 'opacity', value: patch.opacity });
      if (typeof patch.fill === 'string' && typeof (record as { fill?: unknown }).fill === 'string' && record.type !== 'line') {
        changes.push({ id, prop: 'fill', value: patch.fill });
      }
      if (typeof patch.stroke === 'string' && typeof (record as { stroke?: unknown }).stroke === 'string') changes.push({ id, prop: 'stroke', value: patch.stroke });
    }
    if (changes.length) this.recorder?.(changes);
    const rest = { ...patch };
    if (typeof patch.opacity === 'number') delete rest.opacity;
    if (typeof patch.fill === 'string') delete rest.fill;
    if (typeof patch.stroke === 'string') delete rest.stroke;
    return rest;
  }

  // Vista local y Awareness durante el gesto; el documento se escribe al soltar o tras 250 ms quieto.
  previewStyle(patch: StylePatch): void {
    if (!this.canEdit) return;
    const ids = [...this.core.selection.get()];
    if (!ids.length) return;
    const merged = { ...(this.pendingStyle?.patch ?? {}), ...patch };
    this.pendingStyle = { ids, patch: merged };
    this.core.setStylePreview({ ids, patch: merged });
    const style: Record<string, unknown> = {};
    for (const key of ['fill', 'stroke', 'opacity', 'strokeWidth', 'cornerRadius'] as const) if (key in merged) style[key] = merged[key];
    this.core.presence.update({ gesture: { ids: 'selection', matrix: [1, 0, 0, 1, 0, 0], style } });
    if (this.styleTimer) clearTimeout(this.styleTimer);
    this.styleTimer = setTimeout(() => this.commitStyle(), DEFERRED_STYLE_MS);
  }

  commitStyle(): void {
    const pending = this.pendingStyle;
    this.cancelPreview();
    if (pending) this.setStyle(pending.patch, pending.ids);
  }

  private cancelPreview(): void {
    if (this.styleTimer) clearTimeout(this.styleTimer);
    this.styleTimer = null;
    if (this.pendingStyle) {
      this.pendingStyle = null;
      this.core.setStylePreview(null);
      this.core.presence.update({ gesture: null });
    }
  }

  // ── Historial ──

  // El host deshace y manda el resultado en un lote; sin worker llega en el acto.
  undo(): void {
    if (!this.canEdit) return;
    this.core.writer.undo();
    this.core.syncModel();
  }

  redo(): void {
    if (!this.canEdit) return;
    this.core.writer.redo();
    this.core.syncModel();
  }

  // ── Cámara ──

  // Mover la cámara a mano deja de seguir a quien se estuviera siguiendo.
  fitAll(): void {
    this.core.stopFollowing();
    this.core.fitAll();
  }

  zoomToSelection(): void {
    this.core.stopFollowing();
    this.core.markUserCamera();
    this.core.zoomToSelection();
  }

  zoomTo(zoom: number): void {
    this.core.stopFollowing();
    this.core.markUserCamera();
    this.core.zoomTo(zoom);
  }

  zoomIn(): void {
    this.zoomTo(this.core.camera.zoom * 1.25);
  }

  zoomOut(): void {
    this.zoomTo(this.core.camera.zoom / 1.25);
  }

  // ── Portapapeles ──

  // Los nodos de arriba del bloque copiado se guardan en coordenadas de la página, sin el padre de origen.
  copyPayload(): { nodes: NodeRecord[]; texts: Record<string, string> } | null {
    const records = this.selectionWithDescendants();
    if (!records.length) return null;
    const tree = this.core.tree;
    const ids = new Set(records.map((record) => record.id));
    const nodes = records.map((record) => {
      if (!record.parentId || ids.has(record.parentId)) return record;
      const parentWorld = tree.parentWorld(tree.parent(record.id));
      const patch = parentWorld ? this.reexpress(record, changeOfBasis(parentWorld, null)) : {};
      return { ...record, ...patch, parentId: null } as NodeRecord;
    });
    return { nodes, texts: this.textsOf(records) };
  }

  // Bloque text/html de la selección (sin origen: el que lo pega lo trata como del mismo espacio).
  copySelection(): string | null {
    const payload = this.copyPayload();
    return payload ? serializeClipboard({ ...payload, source: null }) : null;
  }

  cutSelection(): string | null {
    const html = this.copySelection();
    if (html) this.deleteSelection();
    return html;
  }

  paste(html: string): boolean {
    const payload = parseClipboard(html);
    return payload ? this.pasteNodes(payload.nodes, payload.texts) : false;
  }

  // Nodos con ids nuevos (y referencias internas remapeadas). Pegados en el mismo documento se desplazan un poco;
  // de otro, se quedan en su sitio si se ven y, si no, se llevan al centro de la vista.
  pasteNodes(nodes: readonly NodeRecord[], texts: Record<string, string>): boolean {
    if (!nodes.length) return false;
    const sameDocument = nodes.some((record) => this.core.record(record.id));
    let offset = { x: PASTE_OFFSET, y: PASTE_OFFSET };
    if (!sameDocument) {
      const ids = new Set(nodes.map((record) => record.id));
      const box = emptyAABB();
      for (const record of nodes) {
        if (record.parentId && ids.has(record.parentId)) continue;
        unionAABB(box, { minX: record.x, minY: record.y, maxX: record.x + record.w, maxY: record.y + record.h });
      }
      const center = this.core.viewCenter();
      offset =
        isEmptyAABB(box) || intersects(box, this.core.camera.viewport())
          ? { x: 0, y: 0 }
          : { x: round3(center.x - (box.minX + box.maxX) / 2), y: round3(center.y - (box.minY + box.maxY) / 2) };
    }
    return this.insertCopies(nodes, offset, texts).length > 0;
  }

  // Texto plano pegado: un nodo de texto centrado en `at`. Las líneas largas pasan a un ancho fijo que las parte.
  pasteText(text: string, at: Point): string | null {
    if (!this.creationAllowed()) return null;
    const content = text.slice(0, DOCUMENT_LIMITS.maxTextLength);
    if (!content.trim()) return null;
    const lines = content.split('\n');
    let longest = 0;
    for (const line of lines) longest = Math.max(longest, line.length);
    const charWidth = DEFAULT_TEXT.fontSize * TEXT_CHAR_RATIO;
    const wrap = longest > PASTE_WRAP_CHARS;
    const perLine = Math.max(1, Math.floor(PASTE_TEXT_WIDTH / charWidth));
    let rows = 0;
    for (const line of lines) rows += wrap ? Math.max(1, Math.ceil(line.length / perLine)) : 1;
    const w = wrap ? PASTE_TEXT_WIDTH : Math.max(8, Math.ceil(longest * charWidth));
    const h = Math.min(DOCUMENT_LIMITS.maxSize, Math.ceil(rows * DEFAULT_TEXT.fontSize * DEFAULT_TEXT.lineHeight));
    const id = newNodeId();
    const place = this.placeAt(at);
    const corner = place.toLocal({ x: at.x - w / 2, y: at.y - h / 2 });
    const record = { ...newText(this.base(id, place.parentId, place.index), corner, wrap ? w : null), w, h };
    if (!NodeSchema.safeParse(record).success) return null;
    this.writeCreated(record, place.reindexed, content);
    return id;
  }

  destroy(): void {
    if (this.styleTimer) clearTimeout(this.styleTimer);
    this.styleTimer = null;
  }
}

function merge(patches: Patches, id: string, values: Record<string, unknown>): void {
  const current = patches.get(id);
  patches.set(id, current ? Object.assign(current, values) : { ...values });
}

function normalizeBox(box: Box): Box {
  const w = Math.max(1, Math.round(Math.abs(box.w)) || DEFAULT_SIZE);
  const h = Math.max(1, Math.round(Math.abs(box.h)) || DEFAULT_SIZE);
  return { x: Math.round(box.w < 0 ? box.x + box.w : box.x), y: Math.round(box.h < 0 ? box.y + box.h : box.y), w, h };
}
