export type Point = { x: number; y: number };

export type TwoFingerState = 'unknown' | 'panning' | 'pinching';

// zoomFactor y pan son incrementales respecto al move anterior. Aplicar primero el pan y después el zoom en `center`
// deja bajo el punto medio de los dedos lo mismo que había al empezar.
export type TwoFingerStep = { state: TwoFingerState; zoomFactor: number; pan: Point; center: Point };

// Cambio de distancia entre dedos que delata un pellizco antes de saber qué gesto es.
export const PINCH_START_PX = 24;
// Movimiento del punto medio que delata un pan.
export const PAN_START_PX = 16;
// Ya en pan, hace falta separar mucho los dedos para pasar a pellizco: si no, un pan con los dedos poco firmes hace zoom.
export const PAN_TO_PINCH_PX = 64;
// Ventana de las muestras de velocidad para la inercia.
export const VELOCITY_WINDOW_MS = 80;

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Máquina de estados de dos dedos sin DOM: decide si el gesto es un pan o un pellizco y cuánto mueve en cada paso.
export class TwoFingerTracker {
  state: TwoFingerState = 'unknown';
  private startGap = 0;
  private startCenter: Point = { x: 0, y: 0 };
  private lastGap = 0;
  private lastCenter: Point = { x: 0, y: 0 };
  private samples: Array<{ t: number; x: number; y: number }> = [];

  start(a: Point, b: Point, time = now()): void {
    this.state = 'unknown';
    this.startGap = this.lastGap = gap(a, b);
    this.startCenter = this.lastCenter = mid(a, b);
    this.samples = [{ t: time, x: this.lastCenter.x, y: this.lastCenter.y }];
  }

  move(a: Point, b: Point, time = now()): TwoFingerStep {
    const center = mid(a, b);
    const distance = gap(a, b);
    const spread = Math.abs(distance - this.startGap);
    if (this.state === 'unknown') {
      if (spread > PINCH_START_PX) this.state = 'pinching';
      else if (Math.hypot(center.x - this.startCenter.x, center.y - this.startCenter.y) > PAN_START_PX) this.state = 'panning';
    } else if (this.state === 'panning' && spread > PAN_TO_PINCH_PX) {
      this.state = 'pinching';
    }
    const pan = this.state === 'unknown' ? { x: 0, y: 0 } : { x: center.x - this.lastCenter.x, y: center.y - this.lastCenter.y };
    const zoomFactor = this.state === 'pinching' && this.lastGap > 0 && distance > 0 ? distance / this.lastGap : 1;
    this.lastCenter = center;
    this.lastGap = distance;
    this.samples.push({ t: time, x: center.x, y: center.y });
    while (this.samples.length > 2 && time - this.samples[0]!.t > VELOCITY_WINDOW_MS) this.samples.shift();
    return { state: this.state, zoomFactor, pan, center };
  }

  // Velocidad del punto medio en px/ms durante los últimos VELOCITY_WINDOW_MS.
  velocity(time = now()): Point {
    const recent = this.samples.filter((sample) => time - sample.t <= VELOCITY_WINDOW_MS);
    if (recent.length < 2) return { x: 0, y: 0 };
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const dt = last.t - first.t;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}
