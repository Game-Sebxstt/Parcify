import { describe, expect, it } from 'vitest';
import { PAN_START_PX, PAN_TO_PINCH_PX, PINCH_START_PX, TwoFingerTracker } from './pinch.ts';
import { classifyWheel, type WheelContext, type WheelSample } from './wheel.ts';

const sample = (overrides: Partial<WheelSample> = {}): WheelSample => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrl: false,
  meta: false,
  shift: false,
  x: 0,
  y: 0,
  ...overrides,
});
const ctx = (overrides: Partial<WheelContext> = {}): WheelContext => ({ isMac: false, pref: 'pan', gestureActive: false, viewportHeight: 800, ...overrides });

const zoomOf = (overrides: Partial<WheelSample>, context: Partial<WheelContext> = {}) => {
  const action = classifyWheel(sample(overrides), ctx(context));
  if (action.kind !== 'zoom') throw new Error(`se esperaba zoom y llegó ${action.kind}`);
  return action.factor;
};

describe('classifyWheel', () => {
  it('Ctrl o ⌘ hacen zoom con como mucho ×1,105 por evento', () => {
    expect(zoomOf({ ctrl: true, deltaY: -3 })).toBeCloseTo(1.03, 3);
    expect(zoomOf({ ctrl: true, deltaY: -100 })).toBeCloseTo(1.105, 3);
    expect(zoomOf({ ctrl: true, deltaY: 100 })).toBeCloseTo(0.905, 3);
    expect(zoomOf({ meta: true, deltaY: -100 })).toBeCloseTo(1.105, 3);
  });

  it('el zoom se centra en el puntero', () => {
    expect(classifyWheel(sample({ ctrl: true, deltaY: -4, x: 120, y: 80 }), ctx())).toMatchObject({ kind: 'zoom', x: 120, y: 80 });
  });

  it('sin modificadores desplaza, también con deltas grandes', () => {
    expect(classifyWheel(sample({ deltaY: 8 }), ctx())).toEqual({ kind: 'pan', dx: 0, dy: -8 });
    expect(classifyWheel(sample({ deltaX: 5, deltaY: -2 }), ctx())).toEqual({ kind: 'pan', dx: -5, dy: 2 });
    expect(classifyWheel(sample({ deltaY: 100 }), ctx())).toEqual({ kind: 'pan', dx: 0, dy: -100 });
  });

  it('con la preferencia de zoom, solo la rueda del ratón hace zoom', () => {
    expect(zoomOf({ deltaY: 100 }, { pref: 'zoom' })).toBeCloseTo(0.905, 3);
    expect(classifyWheel(sample({ deltaY: 7.5 }), ctx({ pref: 'zoom' }))).toEqual({ kind: 'pan', dx: 0, dy: -7.5 });
  });

  it('normaliza las líneas y las páginas', () => {
    expect(classifyWheel(sample({ deltaMode: 1, deltaY: 3 }), ctx())).toEqual({ kind: 'pan', dx: 0, dy: -48 });
    expect(classifyWheel(sample({ deltaMode: 2, deltaY: 1 }), ctx())).toEqual({ kind: 'pan', dx: 0, dy: -800 });
  });

  it('Shift+rueda desplaza en horizontal salvo en Mac, que ya lo convierte', () => {
    expect(classifyWheel(sample({ shift: true, deltaY: 30 }), ctx())).toEqual({ kind: 'pan', dx: -30, dy: 0 });
    expect(classifyWheel(sample({ shift: true, deltaY: 30 }), ctx({ isMac: true }))).toEqual({ kind: 'pan', dx: 0, dy: -30 });
    expect(classifyWheel(sample({ shift: true, deltaY: 100 }), ctx({ pref: 'zoom' }))).toEqual({ kind: 'pan', dx: -100, dy: 0 });
  });

  it('ignora el pellizco durante un gesto de Safari y los deltas no finitos', () => {
    expect(classifyWheel(sample({ ctrl: true, deltaY: -3 }), ctx({ gestureActive: true }))).toEqual({ kind: 'ignore' });
    expect(classifyWheel(sample({ deltaY: Number.NaN }), ctx())).toEqual({ kind: 'ignore' });
    expect(classifyWheel(sample({ deltaX: Number.POSITIVE_INFINITY }), ctx())).toEqual({ kind: 'ignore' });
  });

  it('quince pellizcos de −40 no pasan de ×1,105^15', () => {
    let zoom = 1;
    for (let i = 0; i < 15; i++) {
      const factor = zoomOf({ ctrl: true, deltaY: -40 });
      expect(factor).toBeLessThanOrEqual(1.1052);
      zoom *= factor;
    }
    expect(zoom).toBeCloseTo(1.105 ** 15, 0);
  });
});

describe('TwoFingerTracker', () => {
  const a0 = { x: 100, y: 300 };
  const b0 = { x: 300, y: 300 };

  it('sigue sin decidir por debajo de los umbrales y no mueve nada', () => {
    const tracker = new TwoFingerTracker();
    tracker.start(a0, b0, 0);
    const step = tracker.move({ x: 100 - PINCH_START_PX / 2 + 1, y: 300 + PAN_START_PX - 2 }, { x: 300 + PINCH_START_PX / 2 - 1, y: 300 + PAN_START_PX - 2 }, 16);
    expect(step.state).toBe('unknown');
    expect(step.zoomFactor).toBe(1);
    expect(step.pan).toEqual({ x: 0, y: 0 });
  });

  it('pasa a pellizco si la distancia cambia más de 24 px', () => {
    const tracker = new TwoFingerTracker();
    tracker.start(a0, b0, 0);
    const step = tracker.move({ x: 87, y: 300 }, { x: 313, y: 300 }, 16);
    expect(step.state).toBe('pinching');
    expect(step.zoomFactor).toBeCloseTo(226 / 200, 6);
    expect(step.center).toEqual({ x: 200, y: 300 });
  });

  it('pasa a pan si el punto medio se mueve más de 16 px', () => {
    const tracker = new TwoFingerTracker();
    tracker.start(a0, b0, 0);
    const step = tracker.move({ x: 100, y: 317 }, { x: 300, y: 317 }, 16);
    expect(step.state).toBe('panning');
    expect(step.zoomFactor).toBe(1);
    expect(step.pan).toEqual({ x: 0, y: 17 });
  });

  it('en pan solo pasa a pellizco al separar los dedos más de 64 px', () => {
    const tracker = new TwoFingerTracker();
    tracker.start(a0, b0, 0);
    tracker.move({ x: 100, y: 320 }, { x: 300, y: 320 }, 16);
    const still = tracker.move({ x: 80, y: 340 }, { x: 320, y: 340 }, 32);
    expect(still.state).toBe('panning');
    expect(still.zoomFactor).toBe(1);
    const half = PAN_TO_PINCH_PX / 2 + 1;
    const pinch = tracker.move({ x: 100 - half, y: 340 }, { x: 300 + half, y: 340 }, 48);
    expect(pinch.state).toBe('pinching');
    expect(pinch.zoomFactor).toBeCloseTo((200 + 2 * half) / 240, 6);
  });

  it('dos dedos que se mueven juntos 100 px hacen pan sin zoom', () => {
    const tracker = new TwoFingerTracker();
    tracker.start(a0, b0, 0);
    let zoom = 1;
    let panY = 0;
    for (let i = 1; i <= 10; i++) {
      const step = tracker.move({ x: 100, y: 300 + i * 10 }, { x: 300, y: 300 + i * 10 }, i * 16);
      zoom *= step.zoomFactor;
      panY += step.pan.y;
    }
    expect(zoom).toBe(1);
    expect(tracker.state).toBe('panning');
    expect(panY).toBeGreaterThan(80);
  });

  it('mide la velocidad del punto medio en los últimos 80 ms', () => {
    const tracker = new TwoFingerTracker();
    tracker.start(a0, b0, 0);
    for (let i = 1; i <= 10; i++) tracker.move({ x: 100 + i * 8, y: 300 }, { x: 300 + i * 8, y: 300 }, i * 16);
    const velocity = tracker.velocity(160);
    expect(velocity.x).toBeCloseTo(0.5, 6);
    expect(velocity.y).toBe(0);
    expect(tracker.velocity(400)).toEqual({ x: 0, y: 0 });
  });
});
