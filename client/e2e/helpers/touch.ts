import type { CDPSession, Page } from '@playwright/test';

// Gestos de uno y dos dedos con Input.dispatchTouchEvent de CDP (solo Chromium): Chromium los convierte en Pointer
// Events con pointerType 'touch', como un dedo real. Cada paso espera un frame para que el lienzo procese el anterior.

type Point = { x: number; y: number };
type TouchPoint = Point & { id: number };

const FRAME_MS = 16;

const sessions = new WeakMap<Page, CDPSession>();

async function session(page: Page): Promise<CDPSession> {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  return cdp;
}

async function send(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: TouchPoint[]) {
  const cdp = await session(page);
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: touchPoints.map((point) => ({ ...point, radiusX: 4, radiusY: 4, force: 1 })) });
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Dos dedos de `from` a `to` (cada uno con su recorrido), en `steps` pasos.
export async function twoFingers(page: Page, from: [Point, Point], to: [Point, Point], steps = 10) {
  await send(page, 'touchStart', [
    { ...from[0], id: 1 },
    { ...from[1], id: 2 },
  ]);
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(FRAME_MS);
    const t = i / steps;
    await send(page, 'touchMove', [
      { ...lerp(from[0], to[0], t), id: 1 },
      { ...lerp(from[1], to[1], t), id: 2 },
    ]);
  }
  await page.waitForTimeout(FRAME_MS);
  await send(page, 'touchEnd', []);
}

// Pellizco centrado en `center`: la distancia entre los dedos pasa de `startGap` a `endGap` (más = acercar).
export async function pinch(page: Page, center: Point, startGap: number, endGap: number, steps = 10) {
  const half = (gap: number): [Point, Point] => [
    { x: center.x - gap / 2, y: center.y },
    { x: center.x + gap / 2, y: center.y },
  ];
  await twoFingers(page, half(startGap), half(endGap), steps);
}

// Pan con dos dedos separados 60 px que se mueven juntos `delta`.
export async function twoFingerPan(page: Page, center: Point, delta: Point, steps = 10) {
  const a = { x: center.x - 30, y: center.y };
  const b = { x: center.x + 30, y: center.y };
  const move = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  await twoFingers(page, [a, b], [move(a), move(b)], steps);
}

// Un dedo en `first` que se mueve 3 px (menos que el umbral de arrastre) y, después, un segundo dedo en `second`;
// los dos se separan `spread` px en total a lo largo de la línea que los une.
export async function touchThenPinch(page: Page, first: Point, second: Point, spread: number, steps = 10) {
  const nudged = { x: first.x + 3, y: first.y };
  await send(page, 'touchStart', [{ ...first, id: 1 }]);
  await page.waitForTimeout(FRAME_MS);
  await send(page, 'touchMove', [{ ...nudged, id: 1 }]);
  await page.waitForTimeout(FRAME_MS);
  await send(page, 'touchStart', [
    { ...nudged, id: 1 },
    { ...second, id: 2 },
  ]);
  const length = Math.hypot(second.x - nudged.x, second.y - nudged.y) || 1;
  const away = { x: ((second.x - nudged.x) / length) * (spread / 2), y: ((second.y - nudged.y) / length) * (spread / 2) };
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(FRAME_MS);
    const t = i / steps;
    await send(page, 'touchMove', [
      { x: nudged.x - away.x * t, y: nudged.y - away.y * t, id: 1 },
      { x: second.x + away.x * t, y: second.y + away.y * t, id: 2 },
    ]);
  }
  await page.waitForTimeout(FRAME_MS);
  await send(page, 'touchEnd', []);
}

// Un dedo quieto en `at` durante `ms`. Con `drift`, se desplaza eso antes de esperar (para probar la tolerancia).
export async function longPress(page: Page, at: Point, ms = 650, drift: Point = { x: 0, y: 0 }) {
  await send(page, 'touchStart', [{ ...at, id: 1 }]);
  if (drift.x !== 0 || drift.y !== 0) {
    for (let i = 1; i <= 4; i++) {
      await page.waitForTimeout(FRAME_MS);
      await send(page, 'touchMove', [{ ...lerp(at, { x: at.x + drift.x, y: at.y + drift.y }, i / 4), id: 1 }]);
    }
  }
  await page.waitForTimeout(ms);
  await send(page, 'touchEnd', []);
}

// Un dedo que arrastra de `from` a `to`.
export async function touchDrag(page: Page, from: Point, to: Point, steps = 10) {
  await send(page, 'touchStart', [{ ...from, id: 1 }]);
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(FRAME_MS);
    await send(page, 'touchMove', [{ ...lerp(from, to, i / steps), id: 1 }]);
  }
  await page.waitForTimeout(FRAME_MS);
  await send(page, 'touchEnd', []);
}

// Dos toques seguidos en el mismo punto, dentro del margen del doble toque (300 ms).
export async function doubleTap(page: Page, at: Point) {
  for (let i = 0; i < 2; i++) {
    await send(page, 'touchStart', [{ ...at, id: 1 }]);
    await page.waitForTimeout(40);
    await send(page, 'touchEnd', []);
    if (i === 0) await page.waitForTimeout(80);
  }
}
