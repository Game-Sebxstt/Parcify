import { describe, expect, it } from 'vitest';
import type { ConnectorRecord } from '../../types.ts';
import { ShapeView } from './ShapeView.ts';

describe('ShapeView', () => {
  it('redibuja la vista previa de un conector que cambia de recorrido sin cambiar de objeto', () => {
    const view = new ShapeView();
    const record = { type: 'connector', stroke: '#000000FF', strokeWidth: 2, strokeDash: 'solid', startCap: 'none', endCap: 'arrow', path: [0, 0, 10, 0] } as unknown as ConnectorRecord;
    view.draw(record);
    expect(view.needsDraw(record)).toBe(false);
    (record as { path?: readonly number[] }).path = [0, 0, 20, 5];
    expect(view.needsDraw(record)).toBe(true);
    view.draw(record);
    (record as { path?: readonly number[] }).path = [0, 0, 20, 5];
    expect(view.needsDraw(record)).toBe(false);
    view.destroy();
  });
});
