import { describe, expect, it } from 'vitest';
import type { ContainerRecord } from '../../types.ts';
import { FrameView } from './FrameView.ts';

const IDENTITY = [1, 0, 0, 1, 0, 0] as const;

describe('FrameView', () => {
  it('toma la opacidad indicada aunque el registro conserve la del documento', () => {
    const view = new FrameView('group');
    const record = { type: 'group', opacity: 1 } as ContainerRecord;
    view.draw(record, [...IDENTITY], 0.25);
    expect(view.root.alpha).toBe(0.25);
    view.draw(record, [...IDENTITY]);
    expect(view.root.alpha).toBe(1);
    view.destroy();
  });
});
