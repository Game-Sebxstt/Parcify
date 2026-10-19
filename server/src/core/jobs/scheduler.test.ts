import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { rebuildDocument } from './compact.js';
import { nextRunAt } from './scheduler.js';

describe('nextRunAt', () => {
  it('alinea los intervalos y nunca devuelve el instante actual', () => {
    const quarter = 15 * 60_000;
    expect(nextRunAt({ everyMs: quarter }, Date.UTC(2026, 9, 18, 10, 7))).toBe(Date.UTC(2026, 9, 18, 10, 15));
    expect(nextRunAt({ everyMs: quarter }, Date.UTC(2026, 9, 18, 10, 15))).toBe(Date.UTC(2026, 9, 18, 10, 30));
  });

  it('programa los diarios a la hora UTC de hoy o de mañana', () => {
    const daily = { dailyAtUtc: { hour: 3 } };
    expect(nextRunAt(daily, Date.UTC(2026, 9, 18, 1, 0))).toBe(Date.UTC(2026, 9, 18, 3, 0));
    expect(nextRunAt(daily, Date.UTC(2026, 9, 18, 3, 0))).toBe(Date.UTC(2026, 9, 19, 3, 0));
    expect(nextRunAt(daily, Date.UTC(2026, 9, 18, 22, 30))).toBe(Date.UTC(2026, 9, 19, 3, 0));
  });
});

describe('rebuildDocument', () => {
  it('conserva el contenido de todas las raíces y descarta el historial', () => {
    const doc = new Y.Doc();
    const node = new Y.Map<unknown>();
    node.set('type', 'rect');
    node.set('points', Y.Array.from([1, 2]));
    doc.getMap(ROOT_KEYS.nodes).set('n1', node);
    doc.getMap(ROOT_KEYS.meta).set('schemaVersion', 1);
    const text = new Y.Text();
    doc.getMap(ROOT_KEYS.texts).set('n1', text);
    for (let i = 0; i < 200; i++) {
      doc.transact(() => {
        text.delete(0, text.length);
        text.insert(0, `valor ${i}`);
        node.set('x', i);
      });
    }
    const before = Y.encodeStateAsUpdate(doc);
    const rebuilt = rebuildDocument(before);
    expect(rebuilt.byteLength * 2).toBeLessThan(before.byteLength);

    const copy = new Y.Doc();
    Y.applyUpdate(copy, rebuilt);
    for (const root of Object.values(ROOT_KEYS)) expect(copy.getMap(root).toJSON()).toEqual(doc.getMap(root).toJSON());
    expect(copy.getMap<Y.Text>(ROOT_KEYS.texts).get('n1')?.toString()).toBe('valor 199');
  });
});
