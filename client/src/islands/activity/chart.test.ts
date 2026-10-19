import { describe, expect, it } from 'vitest';
import { bucketByDay, daysBetween, niceScale, rangeFor } from './chart.ts';

const zero = { editOps: 0, activeMinutes: 0, sessions: 0, nodesCreated: 0, nodesDeleted: 0, chatMessages: 0, versionsCreated: 0, aiActions: 0 };

describe('escalas de actividad', () => {
  it('redondea el máximo y da marcas enteras desde cero', () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(3)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(niceScale(37)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(niceScale(1234).max).toBeGreaterThanOrEqual(1234);
    for (const max of [1, 7, 19, 101, 999]) {
      const scale = niceScale(max);
      expect(scale.max).toBeGreaterThanOrEqual(max);
      expect(scale.ticks.every(Number.isInteger)).toBe(true);
    }
  });

  it('cuenta los días UTC del rango, inclusivos', () => {
    expect(rangeFor(30, new Date('2025-03-10T23:30:00Z'))).toEqual({ from: '2025-02-09', to: '2025-03-10' });
    expect(daysBetween('2025-02-27', '2025-03-01')).toEqual(['2025-02-27', '2025-02-28', '2025-03-01']);
  });

  it('los cubos suman lo mismo que la serie y rellenan los días vacíos', () => {
    const series = [
      { ...zero, userId: 'a', day: '2025-03-01', editOps: 4 },
      { ...zero, userId: 'b', day: '2025-03-01', editOps: 2 },
      { ...zero, userId: 'b', day: '2025-03-03', editOps: 5, activeMinutes: 3 },
    ];
    const buckets = bucketByDay('2025-03-01', '2025-03-03', series, 'editOps', ['b', 'a']);
    expect(buckets.map((bucket) => bucket.total)).toEqual([6, 0, 5]);
    expect(buckets[0]!.parts).toEqual([{ userId: 'b', value: 2 }, { userId: 'a', value: 4 }]);
    expect(buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(11);
    expect(bucketByDay('2025-03-01', '2025-03-03', series, 'activeMinutes', ['a', 'b']).map((bucket) => bucket.total)).toEqual([0, 0, 3]);
  });
});
