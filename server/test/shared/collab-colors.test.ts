import { describe, expect, it } from 'vitest';
import { COLLAB_COLORS, pickCollabColor } from '../../src/shared/collab-colors.js';

describe('pickCollabColor', () => {
  it('tiene 12 tonos distintos en formato #RRGGBB', () => {
    expect(new Set(COLLAB_COLORS).size).toBe(12);
    for (const color of COLLAB_COLORS) expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('elige el primer tono libre del proyecto', () => {
    expect(pickCollabColor('u1', [])).toBe(COLLAB_COLORS[0]);
    expect(pickCollabColor('u1', [COLLAB_COLORS[0], COLLAB_COLORS[1].toLowerCase()])).toBe(COLLAB_COLORS[2]);
  });

  it('con los 12 ocupados rota de forma estable por usuario', () => {
    const all = [...COLLAB_COLORS];
    expect(pickCollabColor('usuario-a', all)).toBe(pickCollabColor('usuario-a', all));
    const spread = new Set(Array.from({ length: 50 }, (_, i) => pickCollabColor(`u${i}`, all)));
    expect(spread.size).toBeGreaterThan(4);
  });
});
