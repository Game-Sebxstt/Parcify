import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AnimationPlanResultSchema, type AnimationPlan } from '../../shared/ai/animation.js';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { AnimationCommands } from '../commands/animation.ts';
import { makeCore, newDoc, putNode, rect } from '../test-utils.ts';

const plan = (value: unknown): AnimationPlan => AnimationPlanResultSchema.parse(value);

const slide = (nodeId: string, to = 100) => ({
  nodeId,
  animation: {
    duration: 1000,
    delay: 0,
    loop: 1,
    direction: 'normal',
    autoplay: 'none',
    tracks: { offsetX: { k0: { t: 0, v: 0, e: 'linear' }, k1: { t: 1, v: to, e: 'linear' } } },
  },
});

function animations(doc: Y.Doc) {
  return doc.getMap(ROOT_KEYS.animations).toJSON() as Record<string, { duration: number; tracks: Record<string, Record<string, { v: number }>> }>;
}

describe('animaciones propuestas por la IA', () => {
  it('la vista previa se reproduce en las vistas sin tocar el Y.Doc', () => {
    const doc = newDoc();
    const id = putNode(doc, rect({ x: 10, y: 20 }));
    const ctx = makeCore(doc);
    ctx.tick(0);
    const before = Y.encodeStateVector(doc);
    let updates = 0;
    doc.on('update', () => updates++);

    ctx.core.setAiAnimationPreview(plan({ summary: 'x', animations: [slide(id)] }));
    ctx.core.anim.play();
    ctx.tick(0);
    ctx.tick(500);
    expect(ctx.sink.overrides.get(id)?.gesture?.matrix[4]).toBeCloseTo(50, 6);
    ctx.core.anim.seek(1000);
    ctx.tick(600);
    expect(ctx.sink.overrides.get(id)?.gesture?.matrix[4]).toBeCloseTo(100, 6);

    ctx.core.setAiAnimationPreview(null);
    ctx.tick(700);
    expect(ctx.sink.overrides.has(id)).toBe(false);
    expect(updates).toBe(0);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(animations(doc)).toEqual({});
    expect(ctx.core.record(id)).toMatchObject({ x: 10, y: 20 });
  });

  it('aplicar escribe en una transacción que se deshace en un paso y sustituye la animación anterior', () => {
    const doc = newDoc();
    const animated = putNode(doc, rect());
    const fresh = putNode(doc, rect({ index: 'a1' }));
    const locked = putNode(doc, rect({ locked: true, index: 'a2' }));
    const ctx = makeCore(doc);
    ctx.tick(0);
    const keyframes = new AnimationCommands(ctx.core);
    keyframes.setAnimation(animated, { duration: 3000 });
    keyframes.addKeyframe(animated, 'opacity', { t: 0, v: 0 });
    ctx.tick(0);

    const result = keyframes.applyAiAnimations(
      plan({ summary: 'x', animations: [slide(animated, 40), slide(fresh), slide(locked), slide('AAAAAAAAAAAAAAAAAAAAA')] }),
    );
    ctx.tick(0);
    expect(result).toEqual({ applied: 2, skipped: 2 });
    const after = animations(doc);
    expect(Object.keys(after).sort()).toEqual([animated, fresh].sort());
    expect(after[animated]!.duration).toBe(1000);
    expect(Object.keys(after[animated]!.tracks.opacity ?? {})).toHaveLength(0);
    expect(Object.values(after[animated]!.tracks.offsetX!).map((kf) => kf.v).sort((a, b) => a - b)).toEqual([0, 40]);

    ctx.core.commands.undo();
    ctx.tick(0);
    const undone = animations(doc);
    expect(Object.keys(undone)).toEqual([animated]);
    expect(undone[animated]!.duration).toBe(3000);
    expect(Object.keys(undone[animated]!.tracks.opacity!)).toHaveLength(1);
  });
});
