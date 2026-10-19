import { describe, expect, it } from 'vitest';
import { SpatialIndex } from './SpatialIndex.ts';

const box = (x: number, y: number, size = 10) => ({ minX: x, minY: y, maxX: x + size, maxY: y + size });

describe('SpatialIndex', () => {
  it('carga con bulkLoad y consulta rectángulos y puntos con tolerancia', () => {
    const index = new SpatialIndex();
    index.load(Array.from({ length: 100 }, (_, i) => [`n${i}`, box((i % 10) * 20, Math.floor(i / 10) * 20)] as [string, ReturnType<typeof box>]));
    expect(index.size).toBe(100);
    expect(index.search({ minX: 0, minY: 0, maxX: 15, maxY: 15 })).toEqual(['n0']);
    expect(index.searchPoint(12, 5, 0)).toEqual([]);
    expect(index.searchPoint(12, 5, 3)).toEqual(['n0']);
    expect(index.bounds()).toEqual({ minX: 0, minY: 0, maxX: 190, maxY: 190 });
  });

  it('actualiza con remove + insert y borra con null', () => {
    const index = new SpatialIndex();
    index.load([['a', box(0, 0)], ['b', box(100, 100)]]);
    const rebuilt = index.update(new Map([['a', box(500, 500)], ['b', null]]));
    expect(rebuilt).toBe(false);
    expect(index.search(box(0, 0, 200))).toEqual([]);
    expect(index.search(box(495, 495))).toEqual(['a']);
    expect(index.has('b')).toBe(false);
  });

  it('un movimiento pequeño no toca el árbol y las consultas usan la caja real', () => {
    const index = new SpatialIndex();
    index.load([['a', box(0, 0, 100)], ['b', box(300, 0, 100)]]);
    expect(index.update(new Map([['a', box(10, 10, 100)]]))).toBe(false);
    expect(index.reinserts).toBe(0);
    expect(index.get('a')).toEqual(box(10, 10, 100));
    expect(index.searchPoint(5, 5, 0)).toEqual([]);
    expect(index.searchPoint(105, 105, 0)).toEqual(['a']);
    expect(index.bounds()).toEqual({ minX: 10, minY: 0, maxX: 400, maxY: 110 });
    // Fuera de la caja ampliada, o si encoge mucho, se reinserta; varios saltos antes de consultar cuentan una vez.
    index.update(new Map([['a', box(1000, 1000, 100)]]));
    index.update(new Map([['a', box(200, 200, 100)]]));
    index.update(new Map([['b', box(300, 0, 10)]]));
    expect(index.get('a')).toEqual(box(200, 200, 100));
    expect(index.reinserts).toBe(0);
    expect(index.search(box(195, 195, 10))).toEqual(['a']);
    expect(index.reinserts).toBe(2);
    expect(index.search(box(995, 995, 10))).toEqual([]);
    expect(index.searchPoint(390, 90, 0)).toEqual([]);
    expect(index.searchPoint(305, 5, 0)).toEqual(['b']);
    index.update(new Map([['b', null]]));
    expect(index.searchPoint(305, 5, 0)).toEqual([]);
    expect(index.size).toBe(1);
  });

  it('reconstruye entero si cambia más del 30 % en un frame', () => {
    const index = new SpatialIndex();
    index.load(Array.from({ length: 100 }, (_, i) => [`n${i}`, box(i * 20, 0)] as [string, ReturnType<typeof box>]));
    const before = index.rebuilds;
    const changes = new Map(Array.from({ length: 40 }, (_, i) => [`n${i}`, box(i * 20, 1000)] as [string, ReturnType<typeof box>]));
    expect(index.update(changes)).toBe(true);
    expect(index.rebuilds).toBe(before + 1);
    expect(index.search({ minX: 0, minY: 1000, maxX: 10_000, maxY: 1010 })).toHaveLength(40);
    expect(index.size).toBe(100);
  });
});
