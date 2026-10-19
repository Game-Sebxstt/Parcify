import type { ActivityCounters } from '../../shared/api/activity.js';

export type Metric = keyof ActivityCounters;

export type DayPart = { userId: string; value: number };
export type DayBucket = { day: string; total: number; parts: DayPart[] };
export type Scale = { max: number; ticks: number[] };

type Point = ActivityCounters & { userId: string; day: string };

const DAY_MS = 86_400_000;

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// Días UTC inclusivos que terminan hoy.
export function rangeFor(days: number, now: Date = new Date()): { from: string; to: string } {
  return { from: utcDay(new Date(now.getTime() - (days - 1) * DAY_MS)), to: utcDay(now) };
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= end; time += DAY_MS) days.push(utcDay(new Date(time)));
  return days;
}

// Un cubo por día del rango (los días sin datos quedan a cero), con las partes en el orden de userOrder.
export function bucketByDay(from: string, to: string, series: Point[], metric: Metric, userOrder: string[]): DayBucket[] {
  const byDay = new Map<string, Map<string, number>>();
  for (const point of series) {
    if (point[metric] === 0) continue;
    let users = byDay.get(point.day);
    if (!users) byDay.set(point.day, (users = new Map()));
    users.set(point.userId, (users.get(point.userId) ?? 0) + point[metric]);
  }
  return daysBetween(from, to).map((day) => {
    const users = byDay.get(day);
    const parts = users ? userOrder.flatMap((userId) => (users.has(userId) ? [{ userId, value: users.get(userId)! }] : [])) : [];
    return { day, total: parts.reduce((sum, part) => sum + part.value, 0), parts };
  });
}

// Máximo redondeado a 1, 2 o 5 × 10^n y marcas enteras desde cero.
export function niceScale(max: number, count = 4): Scale {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, ([1, 2, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top; tick += step) ticks.push(tick);
  return { max: top, ticks };
}

// Paso entre etiquetas del eje X para que haya como mucho `count`.
export function labelEvery(length: number, count = 6): number {
  return Math.max(1, Math.ceil(length / count));
}
