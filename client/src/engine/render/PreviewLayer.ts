import { Container, Graphics } from 'pixi.js';
import { AI_PREVIEW_COLOR, AI_PREVIEW_DELETE_COLOR, AI_PREVIEW_NEW_ALPHA, type PreviewItem, type PreviewModel } from '../ai/preview.ts';
import { dashSegments } from '../geometry/shapes.ts';
import { hasTextContent, isContainer, type ContainerRecord, type RenderableRecord } from '../types.ts';
import { parseColor } from './color.ts';
import { FrameView } from './views/FrameView.ts';
import { ShapeView } from './views/ShapeView.ts';

const AI = parseColor(`${AI_PREVIEW_COLOR}FF`).color;
const DELETE = parseColor(`${AI_PREVIEW_DELETE_COLOR}FF`).color;

// Capa de la vista previa del asistente, dentro de `world` y encima del contenido. Se rehace entera: son pocos
// nodos y solo cambia al llegar un plan o al cambiar el zoom (los trazos tienen grosor de pantalla).
export class PreviewLayer {
  readonly container = new Container();
  private views: Array<{ destroy(): void }> = [];
  private readonly marks = new Graphics();

  constructor() {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
    this.marks.eventMode = 'none';
  }

  draw(model: PreviewModel | null, zoom: number, textResolution: number): void {
    this.clear();
    if (!model) return;
    for (const item of model.edited) this.paint(item, 1, textResolution);
    for (const item of model.created) this.paint(item, AI_PREVIEW_NEW_ALPHA, textResolution);
    this.container.addChild(this.marks);
    const width = 1.5 / zoom;
    const g = this.marks;
    for (const item of model.edited) g.poly(item.outline, true);
    if (model.edited.length) g.stroke({ width, color: AI, alpha: 0.9 });
    g.beginPath();
    for (const item of model.created) for (const segment of dashSegments(item.outline, true, 6 / zoom, 4 / zoom)) polyline(g, segment);
    if (model.created.length) g.stroke({ width, color: AI, alpha: 1 });
    for (const outline of model.deleted) {
      g.poly(outline, true);
      // Tachado: las dos diagonales de la caja.
      if (outline.length >= 8) {
        g.moveTo(outline[0]!, outline[1]!).lineTo(outline[4]!, outline[5]!);
        g.moveTo(outline[2]!, outline[3]!).lineTo(outline[6]!, outline[7]!);
      }
    }
    if (model.deleted.length) g.stroke({ width: width * 1.5, color: DELETE, alpha: 0.95 });
  }

  private paint(item: PreviewItem, alpha: number, textResolution: number): void {
    const record = item.record;
    if (isContainer(record)) {
      if (record.type !== 'frame') return;
      const view = new FrameView('frame');
      view.draw(record as ContainerRecord, item.world, record.opacity * alpha);
      this.container.addChild(view.root);
      this.views.push(view);
      return;
    }
    const view = new ShapeView();
    view.draw(record as RenderableRecord);
    if (item.text && hasTextContent(record)) void view.drawText(record as RenderableRecord, item.text, textResolution, false);
    view.setWorld(item.world, record.opacity * alpha);
    this.container.addChild(view.root);
    this.views.push(view);
  }

  private clear(): void {
    for (const view of this.views) view.destroy();
    this.views = [];
    this.marks.clear();
    this.marks.removeFromParent();
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}

function polyline(g: Graphics, points: readonly number[]): void {
  g.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
}
