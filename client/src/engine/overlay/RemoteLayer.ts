import { Container, Graphics, Text } from 'pixi.js';
import type { CameraState } from '../render/Camera.ts';
import { parseColor } from '../render/color.ts';
import type { RemoteModel } from '../render/sink.ts';

type CursorView = { root: Container; arrow: Graphics; label: Text; color: string; name: string };

// Selecciones y marquees remotos en coordenadas de mundo; cursores con nombre en espacio de pantalla.
export class RemoteLayer {
  readonly world = new Container({ isRenderGroup: true });
  readonly screen = new Container();
  private readonly outlines = new Graphics();
  private readonly cursors = new Map<string, CursorView>();
  private outlinesEmpty = true;

  constructor() {
    for (const layer of [this.world, this.screen]) {
      layer.eventMode = 'none';
      layer.interactiveChildren = false;
    }
    this.world.addChild(this.outlines);
  }

  setCamera(camera: CameraState): void {
    this.world.position.set(-camera.x * camera.zoom, -camera.y * camera.zoom);
    this.world.scale.set(camera.zoom);
  }

  draw(model: RemoteModel, camera: CameraState): void {
    const g = this.outlines;
    // Vaciar un Graphics ya vacío también obliga a Pixi a rehacer su contexto: solo cuando hay algo que quitar.
    const empty = model.selections.length === 0 && model.marquees.length === 0;
    if (!empty || !this.outlinesEmpty) g.clear();
    this.outlinesEmpty = empty;
    const width = 1.5 / camera.zoom;
    for (const selection of model.selections) {
      const { color, alpha } = parseColor(selection.color);
      for (const polygon of selection.polygons) g.poly(polygon.flatMap((p) => [p.x, p.y]), true);
      if (selection.polygons.length) g.stroke({ width, color, alpha });
    }
    for (const marquee of model.marquees) {
      const { color } = parseColor(marquee.color);
      const { x, y, w, h } = marquee.box;
      g.rect(x, y, w, h).fill({ color, alpha: 0.08 }).stroke({ width, color, alpha: 0.9 });
    }

    const seen = new Set<string>();
    for (const cursor of model.cursors) {
      seen.add(cursor.key);
      let view = this.cursors.get(cursor.key);
      if (!view || view.color !== cursor.color || view.name !== cursor.name) {
        if (view) this.destroyCursor(cursor.key, view);
        view = this.createCursor(cursor.name, cursor.color);
        this.cursors.set(cursor.key, view);
      }
      view.root.position.set(cursor.x, cursor.y);
    }
    for (const [key, view] of this.cursors) if (!seen.has(key)) this.destroyCursor(key, view);
  }

  private createCursor(name: string, colorHex: string): CursorView {
    const { color } = parseColor(colorHex);
    const root = new Container();
    const arrow = new Graphics()
      .poly([0, 0, 0, 16, 4.5, 12, 8, 19, 10.5, 18, 7.5, 11, 13, 11], true)
      .fill({ color })
      .stroke({ width: 1, color: 0x000b1d, alpha: 0.6 });
    const label = new Text({ text: name, style: { fontFamily: 'Manrope Variable, system-ui, sans-serif', fontSize: 12, fontWeight: '600', fill: 0x000b1d } });
    label.resolution = 2;
    const pill = new Graphics().roundRect(0, 0, label.width + 12, label.height + 6, 9).fill({ color });
    pill.position.set(12, 18);
    label.position.set(18, 21);
    root.addChild(arrow, pill, label);
    this.screen.addChild(root);
    return { root, arrow, label, color: colorHex, name };
  }

  private destroyCursor(key: string, view: CursorView): void {
    this.screen.removeChild(view.root);
    view.root.destroy({ children: true });
    this.cursors.delete(key);
  }

  destroy(): void {
    for (const [key, view] of this.cursors) this.destroyCursor(key, view);
    this.world.destroy({ children: true });
    this.screen.destroy({ children: true });
  }
}
