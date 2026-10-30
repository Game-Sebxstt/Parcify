// Canvas nuevo para un motor, al principio del contenedor (detrás del editor de texto). Cada montaje necesita el suyo:
// al destruirse, Pixi pierde a propósito el contexto WebGL del canvas, y otro renderer sobre él se queda colgado.
// Quien lo crea lo quita con remove() después de destruir el motor.
export function createEngineCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'block h-full w-full';
  container.prepend(canvas);
  return canvas;
}
