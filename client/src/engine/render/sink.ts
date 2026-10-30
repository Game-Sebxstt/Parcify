import type { Mat, Point } from '../geometry/matrix.ts';
import type { Box, SceneRecord } from '../types.ts';
import type { PreviewModel } from '../ai/preview.ts';
import type { CameraState } from './Camera.ts';

// Lo que el motor le pide a la capa de dibujo. La implementación real es Pixi; las pruebas usan una vacía.

export type ViewOverride = {
  record: SceneRecord;
  world: Mat;
  // false: se conserva el dibujo y la matriz deforma la vista (gestos con muchos nodos).
  redraw: boolean;
  // Gesto que mueve el dibujo sin cambiarlo (world = matrix · matriz propia). Las vistas con la misma clave
  // se pueden pintar juntas en un grupo con esa matriz.
  gesture?: { key: string; matrix: Mat };
};

export type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

// Tiradores de una línea o un conector seleccionado solo, en pantalla. `anchored`: índices de los vértices que son
// extremos pegados a un nodo. Cada punto medio lleva el vano en el que inserta (`segment`, entre los vértices
// `segment` y `segment + 1`) y cada tramo de codo su índice en el recorrido (`index`), porque los vanos y tramos
// demasiado cortos no llevan tirador. `hoverMid`: punto medio bajo el puntero.
export type LineHandles = {
  vertices: Point[];
  mids: Array<Point & { segment: number }>;
  segments: Array<{ a: Point; b: Point; axis: 'x' | 'y'; index: number }>;
  activeVertex: number | null;
  hoverMid: number | null;
  anchored: number[];
};

export type OverlayProfile = { handleDraw: number; showHoverOnly: boolean };

export type OverlayModel = {
  profile: OverlayProfile;
  selection: null | {
    corners: [Point, Point, Point, Point];
    handles: Array<{ kind: HandleKind; x: number; y: number }>;
    // Sin caja: las líneas y los conectores solo llevan sus tiradores.
    box: boolean;
    radiusHandles: Point[];
    rotateHandle: Point | null;
    lineHandles: LineHandles | null;
    outlines: Point[][];
  };
  // Nodo al que se va a pegar el extremo de un conector: su contorno y sus anclas.
  anchorTarget: { outline: Point[]; anchors: Point[]; active: number | null } | null;
  // Puntos fijados de la línea que dibuja la Pluma; `closing`: un clic en el último terminaría la línea.
  pen: { points: Point[]; closing: boolean } | null;
  // Mientras la selección solo se traslada, la clave no cambia y el dibujo se desplaza con este offset.
  selectionKey: string | null;
  selectionOffset: Point;
  hover: Point[] | null;
  marquee: Box | null;
  guides: Array<{ x1: number; y1: number; x2: number; y2: number }>;
};

export type RemoteModel = {
  selections: Array<{ color: string; polygons: Point[][] }>;
  marquees: Array<{ color: string; box: Box }>;
  cursors: Array<{ key: string; name: string; color: string; x: number; y: number }>;
};

export type TextRefresh = { changed: number; remaining: number };

export interface RenderSink {
  // sameDrawing: respecto al registro anterior del nodo solo cambian propiedades que no afectan al dibujo.
  // text: contenido de texts[id], que se compara aparte.
  upsert(id: string, record: SceneRecord, world: Mat, visible: boolean, sameDrawing?: boolean, text?: string): void;
  // Nodo cuyo texto se está editando en el DOM: su texto de lienzo se oculta.
  setEditing(id: string | null): void;
  // Pasa los textos visibles a otra resolución, como mucho `budget` por llamada.
  refreshText(resolution: number, budget: number): TextRefresh;
  remove(id: string): void;
  // Orden de pintado de la página y contenedor de cada nodo (null en la raíz). Las vistas de los hijos de un grupo
  // o un frame se pintan dentro del suyo.
  setOrder(order: readonly string[], parentOf?: (id: string) => string | null): void;
  setOverride(id: string, override: ViewOverride | null): void;
  // Actualiza solo la matriz de un gesto cuyos nodos y dibujos no cambian.
  setGroupMatrix(key: string, matrix: Mat): void;
  // Nodos que entran y salen del viewport ampliado.
  setInView(enter: Iterable<string>, leave: Iterable<string>): void;
  setCamera(camera: CameraState): void;
  setBackground(color: string): void;
  drawOverlay(model: OverlayModel): void;
  drawRemote(model: RemoteModel, camera: CameraState): void;
  // Vista previa de un plan del asistente (null la quita). El zoom fija el grosor de los trazos.
  drawPreview(model: PreviewModel | null, zoom: number): void;
  // La cámara lleva un rato quieta tras un zoom o un pan: momento de decidir el nivel de detalle de las imágenes.
  settleCamera(camera: CameraState): void;
  // Trabajo de las imágenes en cada frame (cargas, liberaciones, texturas que llegaron). Devuelve si hay que pintar.
  flushAssets(): boolean;
  render(): void;
  destroy(): void;
}

export class NullSink implements RenderSink {
  renders = 0;
  readonly records = new Map<string, SceneRecord>();
  readonly overrides = new Map<string, ViewOverride>();
  inView = new Set<string>();
  overlay: OverlayModel | null = null;
  remote: RemoteModel | null = null;
  order: readonly string[] = [];

  readonly texts = new Map<string, string>();
  editing: string | null = null;
  textResolution = 1;

  upsert(id: string, record: SceneRecord, _world?: Mat, _visible?: boolean, _sameDrawing?: boolean, text = ''): void {
    this.records.set(id, record);
    this.texts.set(id, text);
  }
  setEditing(id: string | null): void {
    this.editing = id;
  }
  refreshText(resolution: number): TextRefresh {
    this.textResolution = resolution;
    return { changed: 0, remaining: 0 };
  }
  remove(id: string): void {
    this.records.delete(id);
    this.texts.delete(id);
    this.overrides.delete(id);
  }
  readonly parents = new Map<string, string | null>();
  setOrder(order: readonly string[], parentOf?: (id: string) => string | null): void {
    this.order = order;
    this.parents.clear();
    if (parentOf) for (const id of order) this.parents.set(id, parentOf(id));
  }
  setOverride(id: string, override: ViewOverride | null): void {
    if (override) this.overrides.set(id, override);
    else this.overrides.delete(id);
  }
  setGroupMatrix(key: string, matrix: Mat): void {
    for (const [id, override] of this.overrides) {
      if (override.gesture?.key === key) this.overrides.set(id, { ...override, gesture: { key, matrix } });
    }
  }
  setInView(enter: Iterable<string>, leave: Iterable<string>): void {
    for (const id of enter) this.inView.add(id);
    for (const id of leave) this.inView.delete(id);
  }
  setCamera(): void {}
  settles = 0;
  settleCamera(): void {
    this.settles++;
  }
  flushAssets(): boolean {
    return false;
  }
  readonly backgrounds: string[] = [];
  setBackground(color: string): void {
    this.backgrounds.push(color);
  }
  drawOverlay(model: OverlayModel): void {
    this.overlay = model;
  }
  drawRemote(model: RemoteModel): void {
    this.remote = model;
  }
  preview: PreviewModel | null = null;
  drawPreview(model: PreviewModel | null): void {
    this.preview = model;
  }
  render(): void {
    this.renders++;
  }
  destroy(): void {}
}
