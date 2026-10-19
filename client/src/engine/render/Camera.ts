import type { AABB } from '../types.ts';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export type CameraState = { x: number; y: number; zoom: number };

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

  fit(box: AABB, padding = 48, maxZoom = 1): void {
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    const zoom = clampZoom(Math.min((this.width - padding * 2) / w, (this.height - padding * 2) / h, maxZoom));
    this.zoom = zoom > 0 ? zoom : 1;
    this.x = (box.minX + box.maxX) / 2 - this.width / 2 / this.zoom;
    this.y = (box.minY + box.maxY) / 2 - this.height / 2 / this.zoom;
    this.version++;
  }

  zoomTo(zoom: number): void {
    this.zoomAt(this.width / 2, this.height / 2, zoom / this.zoom);
  }
}
