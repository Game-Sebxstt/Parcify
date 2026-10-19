import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AssistantPlanResultSchema, type AssistantPlan } from '../../shared/ai/assistant.js';
import { ROOT_KEYS } from '../../shared/document/keys.js';
import { NodeSchema } from '../../shared/document/schema.js';
import { frame, makeCore, newDoc, nodeMap, PAGE_ID, putNode, rect } from '../test-utils.ts';

function nodes(doc: Y.Doc) {
  return doc.getMap(ROOT_KEYS.nodes).toJSON() as Record<string, Record<string, unknown>>;
}

function texts(doc: Y.Doc) {
  return doc.getMap(ROOT_KEYS.texts).toJSON() as Record<string, string>;
}

function plan(value: unknown): AssistantPlan {
  return AssistantPlanResultSchema.parse(value);
}

describe('aplicar un plan del asistente', () => {
  it('crea, edita y borra en una transacción que se deshace con un solo paso', () => {
    const doc = newDoc();
    const keep = putNode(doc, rect({ x: 0, y: 0 }));
    const gone = putNode(doc, rect({ x: 200, y: 0, index: 'a1' }));
    const ctx = makeCore(doc);
    const { core } = ctx;
    // Un cambio propio justo antes: el deshacer de la IA no lo arrastra.
    core.setSelection([keep]);
    core.commands.nudge(5, 0);
    ctx.tick();
    const before = nodes(doc);

    const result = core.commands.applyAiPlan(
      plan({
        summary: 'Título en un frame, rectángulo azul y fuera el otro',
        ops: [
          { op: 'create', tempId: 'f1', node: { type: 'frame', parentId: null, x: 400, y: 0, w: 300, h: 200 } },
          { op: 'create', tempId: 't1', node: { type: 'text', parentId: 'f1', x: 10, y: 10, w: 200, h: 30, text: 'Hola', color: '#112233FF' } },
          { op: 'create', tempId: 'l1', node: { type: 'line', parentId: null, x: 0, y: 300, w: 1, h: 1, points: [[0, 0], [50, 20], [100, 0]] } },
          { op: 'update', id: keep, patch: { fill: '#0000FFFF', cornerRadius: 999, text: 'Etiqueta' } },
          { op: 'delete', id: gone },
        ],
      }),
    );
    ctx.tick();
    expect(result).toEqual({ applied: 5, skipped: 0 });
    const after = nodes(doc);
    expect(Object.keys(after)).toHaveLength(4);
    for (const node of Object.values(after)) expect(NodeSchema.safeParse(node).success).toBe(true);
    const frameNode = Object.values(after).find((node) => node.type === 'frame')!;
    const textNode = Object.values(after).find((node) => node.type === 'text')!;
    const line = Object.values(after).find((node) => node.type === 'line')!;
    expect(textNode.parentId).toBe(frameNode.id);
    expect(texts(doc)[textNode.id as string]).toBe('Hola');
    expect(line).toMatchObject({ x: 0, y: 300, w: 100, h: 20, points: [[0, 0], [50, 20], [100, 0]] });
    expect(after[keep]).toMatchObject({ fill: '#0000FFFF', cornerRadius: 25, x: 5 });
    expect(texts(doc)[keep]).toBe('Etiqueta');
    expect(after[gone]).toBeUndefined();
    expect(core.selection.get()).toEqual(expect.arrayContaining([frameNode.id, line.id]));

    core.commands.undo();
    ctx.tick();
    expect(nodes(doc)).toEqual(before);
    expect(texts(doc)[keep]).toBeUndefined();
    core.commands.undo();
    ctx.tick();
    expect(nodeMap(doc, keep).get('x')).toBe(0);
  });

  it('al aplicar se omiten los cambios sobre nodos que desaparecieron, bloqueados o de otra página', () => {
    const doc = newDoc();
    const removed = putNode(doc, rect());
    const locked = putNode(doc, rect({ locked: true, index: 'a1' }));
    const elsewhere = putNode(doc, rect({ pageId: 'PAGE_0000000000000002', index: 'a2' }));
    const alive = putNode(doc, rect({ index: 'a3' }));
    const ctx = makeCore(doc);
    const proposal = plan({
      summary: 'x',
      ops: [
        { op: 'update', id: removed, patch: { x: 10 } },
        { op: 'delete', id: locked },
        { op: 'update', id: elsewhere, patch: { x: 10 } },
        { op: 'create', tempId: 't1', node: { type: 'rect', parentId: removed, x: 0, y: 0, w: 10, h: 10 } },
        { op: 'update', id: alive, patch: { opacity: 0.5 } },
      ],
    });
    // Otro usuario borra el nodo mientras se revisa la vista previa.
    doc.transact(() => doc.getMap(ROOT_KEYS.nodes).delete(removed), 'remote');
    ctx.tick();
    const result = ctx.core.commands.applyAiPlan(proposal);
    ctx.tick();
    expect(result).toEqual({ applied: 2, skipped: 3 });
    expect(nodeMap(doc, locked)).toBeDefined();
    expect(nodeMap(doc, elsewhere).get('x')).toBe(0);
    expect(nodeMap(doc, alive).get('opacity')).toBe(0.5);
    const created = Object.values(nodes(doc)).find((node) => ![locked, elsewhere, alive].includes(node.id as string))!;
    expect(created.parentId).toBeNull();
  });

  it('el resultado converge entre réplicas y deshacer la IA conserva lo de los demás', () => {
    const base = newDoc();
    const target = putNode(base, rect({ x: 0, y: 0 }));
    const container = putNode(base, frame({ x: 500, y: 0, index: 'a1' }));
    const state = Y.encodeStateAsUpdate(base);
    const replicas = [0, 1].map((i) => {
      const doc = new Y.Doc();
      doc.clientID = 200 + i;
      Y.applyUpdate(doc, state, 'remote');
      return makeCore(doc, { user: { id: `user-${i}`, name: `U${i}`, color: '#FB8F5A', avatarAssetId: null } });
    });
    const [a, b] = replicas as [ReturnType<typeof makeCore>, ReturnType<typeof makeCore>];
    const sync = () => {
      const updates = replicas.map((r) => Y.encodeStateAsUpdate(r.doc));
      for (const r of replicas) for (const update of updates) Y.applyUpdate(r.doc, update, 'remote');
      for (const r of replicas) r.tick();
    };

    a.core.commands.applyAiPlan(
      plan({
        summary: 'x',
        ops: [
          { op: 'update', id: target, patch: { fill: '#00FF00FF', y: 40 } },
          { op: 'create', tempId: 'c1', node: { type: 'ellipse', parentId: container, x: 10, y: 10, w: 50, h: 50 } },
        ],
      }),
    );
    b.core.setSelection([target]);
    b.core.commands.nudge(30, 0);
    sync();
    expect(nodes(a.doc)).toEqual(nodes(b.doc));
    expect(nodes(a.doc)[target]).toMatchObject({ x: 30, y: 40, fill: '#00FF00FF' });
    expect(a.core.tree.paintOrder(PAGE_ID)).toEqual(b.core.tree.paintOrder(PAGE_ID));

    a.core.commands.undo();
    a.tick();
    sync();
    expect(nodes(a.doc)).toEqual(nodes(b.doc));
    expect(Object.keys(nodes(a.doc))).toHaveLength(2);
    expect(nodes(a.doc)[target]).toMatchObject({ x: 30, y: 0, fill: '#FF0000FF' });
  });

  it('una salida que no cumple el esquema no llega a aplicarse', () => {
    const ctx = makeCore(newDoc());
    const bad = { summary: 'x', ops: [{ op: 'create', tempId: 't1', node: { type: 'image', assetId: 'x', parentId: null, x: 0, y: 0, w: 1, h: 1 } }] };
    expect(AssistantPlanResultSchema.safeParse(bad).success).toBe(false);
    const injected = { summary: 'x', ops: [{ op: 'update', id: 'AAAAAAAAAAAAAAAAAAAAA', patch: { pageId: 'otra', createdBy: 'otro' } }] };
    const parsed = AssistantPlanResultSchema.parse(injected);
    expect(parsed.ops[0]).toEqual({ op: 'update', id: 'AAAAAAAAAAAAAAAAAAAAA', patch: {} });
    expect(ctx.core.commands.applyAiPlan(parsed)).toEqual({ applied: 0, skipped: 1 });
    expect(Object.keys(nodes(ctx.doc))).toHaveLength(0);
  });
});
