import { Container, Graphics } from 'pixi.js';
import type { OverlayModel } from '../render/sink.ts';

export const ACCENT = 0xfb8f5a;
const HANDLE_SIZE = 8;

// Capa en espacio de pantalla: tamaño constante con cualquier zoom. Cada parte se redibuja solo si cambia;
// al arrastrar, la selección no se vuelve a teselar: se desplaza.
export class OverlayLayer {
  readonly container = new Container({ isRenderGroup: true });
  private readonly selection = new Graphics();
  private readonly guides = new Graphics();
  private readonly extras = new Graphics();
  private selectionKey: string | null = null;
  private drawnGuides: OverlayModel['guides'] | null = null;
  private drawnHover: OverlayModel['hover'] | undefined = undefined;
  private drawnMarquee: OverlayModel['marquee'] | undefined = undefined;

  constructor() {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
    this.container.addChild(this.guides, this.extras, this.selection);
  }

  draw(model: OverlayModel): void {
    if (!this.drawnGuides || !sameGuides(this.drawnGuides, model.guides)) {
      this.drawnGuides = model.guides.map((guide) => ({ x1: guide.x1, y1: guide.y1, x2: guide.x2, y2: guide.y2 }));
      const g = this.guides.clear();
      for (const guide of model.guides) g.moveTo(guide.x1, guide.y1).lineTo(guide.x2, guide.y2);
      if (model.guides.length) g.stroke({ width: 1, color: 0xf07167, alpha: 1 });
    }

    if (this.drawnHover === undefined || !samePoints(this.drawnHover, model.hover) || !sameBox(this.drawnMarquee ?? null, model.marquee)) {
      this.drawnHover = model.hover && model.hover.map((p) => ({ x: p.x, y: p.y }));
      this.drawnMarquee = model.marquee && { ...model.marquee };
      const g = this.extras.clear();
      if (model.hover) g.poly(model.hover.flatMap((p) => [p.x, p.y]), true).stroke({ width: 1.5, color: ACCENT, alpha: 0.9 });
      if (model.marquee) {
        const { x, y, w, h } = model.marquee;
        g.rect(x, y, w, h).fill({ color: ACCENT, alpha: 0.08 }).stroke({ width: 1, color: ACCENT, alpha: 0.9 });
      }
    }

    this.selection.position.set(model.selectionOffset.x, model.selectionOffset.y);
    if (model.selectionKey !== null && model.selectionKey === this.selectionKey) return;
    this.selectionKey = model.selectionKey;
    this.drawSelection(model.selection);
  }

  private drawSelection(selection: OverlayModel['selection']): void {
    const g = this.selection.clear();
    if (!selection) return;
    for (const outline of selection.outlines) g.poly(outline.flatMap((p) => [p.x, p.y]), true);
    if (selection.outlines.length) g.stroke({ width: 1, color: ACCENT, alpha: 0.7 });
    if (selection.points.length === 0) {
      g.poly(selection.corners.flatMap((p) => [p.x, p.y]), true).stroke({ width: 1.5, color: ACCENT, alpha: 1 });
    }
    for (const point of selection.points) g.circle(point.x, point.y, HANDLE_SIZE / 2 + 1);
    if (selection.points.length) {
      g.fill({ color: 0xffffff, alpha: 1 });
      for (const point of selection.points) g.circle(point.x, point.y, HANDLE_SIZE / 2 + 1);
      g.stroke({ width: 1.5, color: ACCENT, alpha: 1 });
    }
    for (const handle of selection.handles) g.rect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    if (selection.handles.length) {
      g.fill({ color: 0xffffff, alpha: 1 });
      for (const handle of selection.handles) g.rect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      g.stroke({ width: 1.5, color: ACCENT, alpha: 1 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
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

function samePoints(a: OverlayModel['hover'], b: OverlayModel['hover']): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.x !== b[i]!.x || a[i]!.y !== b[i]!.y) return false;
  return true;
}

function sameBox(a: OverlayModel['marquee'], b: OverlayModel['marquee']): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
