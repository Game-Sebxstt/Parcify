// Clasificación de los eventos wheel: pellizco del touchpad, dos dedos, rueda del ratón y Shift+rueda llegan todos
// como wheel y solo se distinguen por los modificadores, el modo y la forma de los deltas.

// x, y: coordenadas del contenedor.
export type WheelSample = { deltaX: number; deltaY: number; deltaMode: 0 | 1 | 2; ctrl: boolean; meta: boolean; shift: boolean; x: number; y: number };
// Qué hace la rueda del ratón sin modificadores. El touchpad desplaza siempre.
export type WheelPreference = 'pan' | 'zoom';
// gestureActive: hay un gesto de Safari en marcha, que ya mueve la cámara.
export type WheelContext = { isMac: boolean; pref: WheelPreference; gestureActive: boolean; viewportHeight: number };
// pan lleva el desplazamiento de pantalla tal cual lo espera Camera.panBy.
export type WheelAction = { kind: 'zoom'; factor: number; x: number; y: number } | { kind: 'pan'; dx: number; dy: number } | { kind: 'ignore' };

const LINE_PX = 16;
// Como mucho ×1,105 por evento: el pellizco llega con deltas de 1 a 10 y una muesca de Ctrl+rueda, con 100.
const MAX_ZOOM_DELTA = 10;
const ZOOM_GAIN = 0.01;

const zoomFactor = (dy: number) => Math.exp(-Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, dy)) * ZOOM_GAIN);
// Sin −0, para que un pan nulo compare igual a 0.
const negate = (value: number) => -value || 0;

// Una rueda de ratón da líneas, o muescas enteras y grandes en un solo eje; el touchpad da deltas pequeños o decimales.
export function looksLikeMouseWheel(sample: Pick<WheelSample, 'deltaMode' | 'deltaX' | 'deltaY'>): boolean {
  if (sample.deltaMode === 1) return true;
  return sample.deltaX === 0 && Number.isInteger(sample.deltaY) && Math.abs(sample.deltaY) >= 50;
}

export function classifyWheel(sample: WheelSample, ctx: WheelContext): WheelAction {
  if (!Number.isFinite(sample.deltaX) || !Number.isFinite(sample.deltaY)) return { kind: 'ignore' };
  const scale = sample.deltaMode === 1 ? LINE_PX : sample.deltaMode === 2 ? ctx.viewportHeight : 1;
  const dx = sample.deltaX * scale;
  const dy = sample.deltaY * scale;
  // El pellizco del touchpad llega como wheel con ctrlKey; en Safari ya lo lleva el gesto.
  if (sample.ctrl || sample.meta) {
    if (ctx.gestureActive) return { kind: 'ignore' };
    return { kind: 'zoom', factor: zoomFactor(dy), x: sample.x, y: sample.y };
  }
  // En Mac el sistema ya convierte Shift+rueda en deltaX. Va antes de la preferencia: Shift+rueda desplaza siempre.
  if (sample.shift && !ctx.isMac && dx === 0) return { kind: 'pan', dx: negate(dy), dy: 0 };
  if (ctx.pref === 'zoom' && looksLikeMouseWheel(sample)) return { kind: 'zoom', factor: zoomFactor(dy), x: sample.x, y: sample.y };
  return { kind: 'pan', dx: negate(dx), dy: negate(dy) };
}
