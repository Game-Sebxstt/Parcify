import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_PIXELS, EXPORT_MAX_SIDE, EXPORT_TILE, exportFileName, planExport, tilesFor } from './raster.ts';

describe('planExport', () => {
  it('multiplica el tamaño por la escala sin reducir', () => {
    const plan = planExport({ w: 400, h: 300 }, 3, 8192);
    expect(plan).toMatchObject({ scale: 3, width: 1200, height: 900, reduced: false });
    expect(plan.tiles).toEqual([{ x: 0, y: 0, w: 1200, h: 900 }]);
  });

  it('redondea hacia arriba las fracciones', () => {
    expect(planExport({ w: 100.2, h: 50.5 }, 1, 4096)).toMatchObject({ width: 101, height: 51 });
  });

  it('reduce la escala al pasar de 16.384 px de lado', () => {
    const plan = planExport({ w: 10_000, h: 100 }, 2, 4096);
    expect(plan.reduced).toBe(true);
    expect(plan.width).toBeLessThanOrEqual(EXPORT_MAX_SIDE);
    expect(plan.width).toBeGreaterThan(EXPORT_MAX_SIDE - 2);
    expect(plan.scale).toBeCloseTo(EXPORT_MAX_SIDE / 10_000, 6);
  });

  it('reduce la escala al pasar de 64 MP', () => {
    const plan = planExport({ w: 5000, h: 5000 }, 3, 4096);
    expect(plan.reduced).toBe(true);
    expect(plan.width * plan.height).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    expect(plan.width * plan.height).toBeGreaterThan(EXPORT_MAX_PIXELS * 0.99);
  });

  it('nunca da un lado de 0 px', () => {
    expect(planExport({ w: 0, h: 0 }, 1, 4096)).toMatchObject({ width: 1, height: 1 });
  });
});

describe('tilesFor', () => {
  it('usa una sola pasada si cabe en la textura de la GPU', () => {
    expect(tilesFor(4000, 3000, 4096)).toEqual([{ x: 0, y: 0, w: 4000, h: 3000 }]);
  });

  it('parte en mosaicos de 2048 px que cubren todo sin solaparse', () => {
    const tiles = tilesFor(5000, 2100, 4096);
    expect(tiles).toHaveLength(6);
    expect(tiles.every((tile) => tile.w <= EXPORT_TILE && tile.h <= EXPORT_TILE)).toBe(true);
    expect(tiles.reduce((sum, tile) => sum + tile.w * tile.h, 0)).toBe(5000 * 2100);
    expect(tiles.at(-1)).toEqual({ x: 4096, y: 2048, w: 904, h: 52 });
  });

  it('usa mosaicos menores si la GPU no llega a 2048 px', () => {
    const tiles = tilesFor(3000, 1000, 1024);
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toEqual({ x: 0, y: 0, w: 1024, h: 1000 });
  });
});

describe('exportFileName', () => {
  it('quita los caracteres no válidos y pone la extensión', () => {
    expect(exportFileName('Plan: v1/final', 'jpeg')).toBe('Plan v1 final.jpg');
    expect(exportFileName('  ', 'png')).toBe('parcify.png');
  });
});
