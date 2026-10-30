import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { Point } from '../geometry/matrix.ts';
import type { OverlayModel } from '../render/sink.ts';

export const ACCENT = 0xfb8f5a;
const SAGE = 0xaad696;
const WHITE = 0xffffff;
const SURFACE = 0x0a1628;
const RADIUS_HANDLE_PX = 8;
const ROTATE_HANDLE_PX = 14;
const MID_PX = 6;
const ANCHOR_PX = 6;
const ACTIVE_ANCHOR_PX = 10;

// Capa en espacio de pantalla: tamaño constante con cualquier zoom. Cada parte se redibuja solo si cambia;
// al arrastrar, la selección no se vuelve a teselar: se desplaza.
export class OverlayLayer {
  readonly container = new Container({ isRenderGroup: true });
  private readonly selection = new Container();
  private readonly frame = new Graphics();
  private readonly handles = new Container();
  private readonly marks = new Graphics();
  private readonly guides = new Graphics();
  private readonly extras = new Graphics();
  private readonly anchor = new Graphics();
  // Un contexto por tamaño de tirador: todos los cuadrados de un tamaño comparten la misma geometría.
  private readonly handleContexts = new Map<number, GraphicsContext>();
  private readonly handlePool: Graphics[] = [];
  private selectionKey: string | null = null;
  private drawnGuides: OverlayModel['guides'] | null = null;
  private drawnHover: OverlayModel['hover'] | undefined = undefined;
  private drawnMarquee: OverlayModel['marquee'] | undefined = undefined;
  private drawnAnchor: OverlayModel['anchorTarget'] | undefined = undefined;

  constructor() {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
    this.selection.addChild(this.frame, this.handles, this.marks);
    this.container.addChild(this.guides, this.extras, this.anchor, this.selection);
  }

  draw(model: OverlayModel): void {
    if (!this.drawnGuides || !sameGuides(this.drawnGuides, model.guides)) {
      this.drawnGuides = model.guides.map((guide) => ({ x1: guide.x1, y1: guide.y1, x2: guide.x2, y2: guide.y2 }));
      const g = this.guides.clear();
      for (const guide of model.guides) g.moveTo(guide.x1, guide.y1).lineTo(guide.x2, guide.y2);
      if (model.guides.length) g.stroke({ width: 1, color: SAGE, alpha: 1, pixelLine: true });
    }

    if (this.drawnHover === undefined || !samePoints(this.drawnHover, model.hover) || !sameBox(this.drawnMarquee ?? null, model.marquee)) {
      this.drawnHover = model.hover && model.hover.map((p) => ({ x: p.x, y: p.y }));
      this.drawnMarquee = model.marquee && { ...model.marquee };
      const g = this.extras.clear();
      if (model.hover) g.poly(flat(model.hover), true).stroke({ width: 1, color: ACCENT, alpha: 1, pixelLine: true });
      if (model.marquee) {
        const { x, y, w, h } = model.marquee;
        g.rect(x, y, w, h).fill({ color: ACCENT, alpha: 0.08 }).stroke({ width: 1, color: ACCENT, alpha: 1, pixelLine: true });
      }
    }

    if (this.drawnAnchor === undefined || !sameAnchor(this.drawnAnchor, model.anchorTarget)) {
      this.drawnAnchor = model.anchorTarget && structuredClone(model.anchorTarget);
      this.drawAnchor(model.anchorTarget);
    }

    this.selection.position.set(model.selectionOffset.x, model.selectionOffset.y);
    if (model.selectionKey !== null && model.selectionKey === this.selectionKey) return;
    this.selectionKey = model.selectionKey;
    this.drawSelection(model);
  }

  private drawAnchor(target: OverlayModel['anchorTarget']): void {
    const g = this.anchor.clear();
    if (!target) return;
    if (target.outline.length) g.poly(flat(target.outline), true).stroke({ width: 1.5, color: SAGE, alpha: 1 });
    target.anchors.forEach((p, i) => {
      g.circle(p.x, p.y, (i === target.active ? ACTIVE_ANCHOR_PX : ANCHOR_PX) / 2);
    });
    if (target.anchors.length) g.fill({ color: SAGE, alpha: 1 }).stroke({ width: 1, color: SURFACE, alpha: 1 });
  }

  private drawSelection(model: OverlayModel): void {
    const selection = model.selection;
    const g = this.frame.clear();
    const marks = this.marks.clear();
    this.placeHandles([], model.profile.handleDraw, 0);
    if (!selection) return;
    for (const outline of selection.outlines) g.poly(flat(outline), true);
    if (selection.outlines.length) g.stroke({ width: 1, color: ACCENT, alpha: 0.5, pixelLine: true });
    if (selection.box) g.poly(flat(selection.corners), true).stroke({ width: 1, color: ACCENT, alpha: 1, pixelLine: true });

    const rotate = selection.rotateHandle;
    if (rotate) {
      const [nw, ne] = selection.corners;
      g.moveTo((nw.x + ne.x) / 2, (nw.y + ne.y) / 2).lineTo(rotate.x, rotate.y).stroke({ width: 1, color: ACCENT, alpha: 1, pixelLine: true });
      marks.circle(rotate.x, rotate.y, ROTATE_HANDLE_PX / 2).fill({ color: WHITE, alpha: 1 }).stroke({ width: 1, color: ACCENT, alpha: 1 });
    }

    const [nw, ne] = selection.corners;
    this.placeHandles(selection.handles, model.profile.handleDraw, Math.atan2(ne.y - nw.y, ne.x - nw.x));

    for (const p of selection.radiusHandles) marks.circle(p.x, p.y, RADIUS_HANDLE_PX / 2);
    if (selection.radiusHandles.length) marks.fill({ color: WHITE, alpha: 1 }).stroke({ width: 1, color: ACCENT, alpha: 1 });

    const line = selection.lineHandles;
    if (!line) return;
    for (const { a, b, axis } of line.segments) {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      // `axis` es hacia donde se arrastra el tramo; el tirador va en ese eje, perpendicular al tramo.
      const [w, h] = axis === 'y' ? [4, 12] : [12, 4];
      marks.roundRect(cx - w / 2, cy - h / 2, w, h, 2);
    }
    if (line.segments.length) marks.fill({ color: WHITE, alpha: 1 }).stroke({ width: 1, color: ACCENT, alpha: 1 });
    line.mids.forEach((p, i) => {
      if (i !== line.hoverMid) marks.circle(p.x, p.y, MID_PX / 2);
    });
    if (line.mids.length > (line.hoverMid === null ? 0 : 1)) marks.fill({ color: SURFACE, alpha: 1 }).stroke({ width: 1, color: ACCENT, alpha: 0.6 });
    const hovered = line.hoverMid === null ? undefined : line.mids[line.hoverMid];
    if (hovered) marks.circle(hovered.x, hovered.y, MID_PX / 2).fill({ color: SURFACE, alpha: 1 }).stroke({ width: 1, color: ACCENT, alpha: 1 });
    const vertex = model.profile.handleDraw / 2;
    line.vertices.forEach((p, i) => {
      const fill = i === line.activeVertex ? ACCENT : line.anchored.includes(i) ? SAGE : WHITE;
      marks.circle(p.x, p.y, vertex).fill({ color: fill, alpha: 1 }).stroke({ width: 1.5, color: ACCENT, alpha: 1 });
    });
  }

  // Los tiradores cuadrados son vistas de un mismo GraphicsContext: moverlos o cambiar cuántos hay no tesela nada.
  private placeHandles(points: ReadonlyArray<Point>, size: number, angle: number): void {
    const context = this.handleContext(size);
    while (this.handlePool.length < points.length) {
      const handle = new Graphics(context);
      this.handlePool.push(handle);
      this.handles.addChild(handle);
    }
    const straight = Math.abs(Math.sin(angle * 2)) < 1e-6;
    this.handlePool.forEach((handle, i) => {
      const p = points[i];
      handle.visible = !!p;
      if (!p) return;
      if (handle.context !== context) handle.context = context;
      // Sin giro, el centro en un píxel entero deja los bordes de 1 px nítidos.
      handle.position.set(straight ? Math.round(p.x) : p.x, straight ? Math.round(p.y) : p.y);
      handle.rotation = straight ? 0 : angle;
    });
  }

  private handleContext(size: number): GraphicsContext {
    let context = this.handleContexts.get(size);
    if (!context) {
      context = new GraphicsContext()
        .rect(-size / 2, -size / 2, size, size)
        .fill({ color: WHITE, alpha: 1 })
        .stroke({ width: 1, color: ACCENT, alpha: 1, alignment: 1 });
      this.handleContexts.set(size, context);
    }
    return context;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    for (const context of this.handleContexts.values()) context.destroy();
    this.handleContexts.clear();
  }
}

function flat(points: readonly Point[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y);
  return out;
}

// Se compara número a número: serializar en cada frame del gesto crea basura.
function sameGuides(a: OverlayModel['guides'], b: OverlayModel['guides']): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p.x1 !== q.x1 || p.y1 !== q.y1 || p.x2 !== q.x2 || p.y2 !== q.y2) return false;
  }
  return true;
}

function samePoints(a: readonly Point[] | null, b: readonly Point[] | null): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.x !== b[i]!.x || a[i]!.y !== b[i]!.y) return false;
  return true;
}

function sameBox(a: OverlayModel['marquee'], b: OverlayModel['marquee']): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sameAnchor(a: OverlayModel['anchorTarget'], b: OverlayModel['anchorTarget']): boolean {
  if (!a || !b) return a === b;
  return a.active === b.active && samePoints(a.outline, b.outline) && samePoints(a.anchors, b.anchors);
}
