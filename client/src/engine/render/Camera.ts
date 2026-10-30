import type { AABB } from '../types.ts';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export type CameraState = { x: number; y: number; zoom: number };

// Lo que tapan los paneles flotantes en cada borde, en px de pantalla.
export type ViewInsets = { top: number; right: number; bottom: number; left: number };

export const NO_INSETS: ViewInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

// (x, y) es el punto de mundo que queda en la esquina superior izquierda de la pantalla.
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  width = 0;
  height = 0;
  version = 0;

  set(state: Partial<CameraState>): void {
    if (state.x !== undefined) this.x = state.x;
    if (state.y !== undefined) this.y = state.y;
    if (state.zoom !== undefined) this.zoom = clampZoom(state.zoom);
    this.version++;
  }

  // Como set, sin crear un objeto: lo usa la interpolación de «Seguir a» en cada frame.
  moveTo(x: number, y: number, zoom: number): void {
    this.x = x;
    this.y = y;
    this.zoom = clampZoom(zoom);
    this.version++;
  }

  state(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.version++;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  viewport(): AABB {
    return { minX: this.x, minY: this.y, maxX: this.x + this.width / this.zoom, maxY: this.y + this.height / this.zoom };
  }

  // Zoom manteniendo fijo el punto de pantalla (sx, sy).
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    const zoom = clampZoom(this.zoom * factor);
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.x = before.x - sx / zoom;
    this.y = before.y - sy / zoom;
    this.version++;
  }

  panBy(dxScreen: number, dyScreen: number): void {
    if (dxScreen === 0 && dyScreen === 0) return;
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.version++;
  }

  // Rectángulo de pantalla que no tapan los paneles: [left, top, width − right, height − bottom]. Si los márgenes no
  // dejan sitio en un eje, en ese eje cuenta la pantalla entera.
  visibleRect(insets: ViewInsets = NO_INSETS): { x: number; y: number; width: number; height: number } {
    const width = this.width - insets.left - insets.right;
    const height = this.height - insets.top - insets.bottom;
    return {
      x: width >= 1 ? insets.left : 0,
      y: height >= 1 ? insets.top : 0,
      width: width >= 1 ? width : this.width,
      height: height >= 1 ? height : this.height,
    };
  }

  // Encaja la caja en el área visible. El margen no pasa del 10 % de ese área: en un móvil, 2 × 64 px de margen
  // dejaban un ancho útil negativo y el zoom caía al mínimo. Sin tamaño todavía no hace nada y devuelve false.
  fit(box: AABB, padding = 48, maxZoom = 1, insets: ViewInsets = NO_INSETS): boolean {
    if (this.width <= 0 || this.height <= 0) return false;
    const view = this.visibleRect(insets);
    const padX = Math.min(padding, Math.max(0, view.width * 0.1));
    const padY = Math.min(padding, Math.max(0, view.height * 0.1));
    const availW = Math.max(1, view.width - padX * 2);
    const availH = Math.max(1, view.height - padY * 2);
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    this.zoom = clampZoom(Math.min(availW / w, availH / h, maxZoom));
    this.x = (box.minX + box.maxX) / 2 - (view.x + view.width / 2) / this.zoom;
    this.y = (box.minY + box.maxY) / 2 - (view.y + view.height / 2) / this.zoom;
    this.version++;
    return true;
  }

  zoomTo(zoom: number): void {
    this.zoomAt(this.width / 2, this.height / 2, zoom / this.zoom);
  }
}
