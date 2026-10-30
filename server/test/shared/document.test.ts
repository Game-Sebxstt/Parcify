import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { NODE_ID_LENGTH, newNodeId } from '../../src/shared/document/ids.js';
import { DEFAULT_PAGE_NAME, initDocument, isDocumentInitialized } from '../../src/shared/document/init.js';
import {
  PresenceStateSchema,
  ROOT_KEYS,
  documentNameFor,
  projectIdFromDocumentName,
  serverOrigin,
} from '../../src/shared/document/keys.js';
import { DOCUMENT_LIMITS } from '../../src/shared/document/limits.js';
import { DocumentTooNewError, MIGRATIONS, documentSchemaVersion, migrate } from '../../src/shared/document/migrations.js';
import { DOCUMENT_SCHEMA_VERSION, MetaSchema, NodeIdSchema, PageSchema } from '../../src/shared/document/schema.js';

describe('init', () => {
  it('crea meta y «Página 1» una sola vez, con origen del servidor', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction) => origins.push(transaction.origin));

    const first = initDocument(doc, { now: 1000 });
    expect(first.initialized).toBe(true);
    expect(isDocumentInitialized(doc)).toBe(true);
    expect(MetaSchema.parse(doc.getMap(ROOT_KEYS.meta).toJSON())).toEqual({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      createdAt: 1000,
      background: '#141416FF',
    });
    const pages = doc.getMap<Y.Map<unknown>>(ROOT_KEYS.pages);
    expect(pages.size).toBe(1);
    const page = PageSchema.parse(pages.get(first.pageId!)!.toJSON());
    expect(page.name).toBe(DEFAULT_PAGE_NAME);
    expect(origins).toEqual([serverOrigin('init')]);

    expect(initDocument(doc).initialized).toBe(false);
    expect(pages.size).toBe(1);
  });
});

describe('ids', () => {
  it('genera ids de 21 caracteres válidos para el esquema', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newNodeId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toHaveLength(NODE_ID_LENGTH);
      expect(NodeIdSchema.safeParse(id).success).toBe(true);
    }
  });
});

function v1Document(): Y.Doc {
  const doc = new Y.Doc();
  initDocument(doc);
  doc.getMap(ROOT_KEYS.meta).set('schemaVersion', 1);
  return doc;
}

function seedV1Content(doc: Y.Doc) {
  const pageId = [...doc.getMap(ROOT_KEYS.pages).keys()][0]!;
  const base = { pageId, parentId: null, index: 'a0', x: 10, y: 20, w: 100, h: 50, rotation: 0, opacity: 1, visible: true, locked: false, createdBy: 'user_1' };
  const style = { fill: '#FF6B4AFF', stroke: null, strokeWidth: 1, strokeDash: 'solid', shadow: null };
  const rectId = newNodeId();
  const connectorId = newNodeId();
  const textId = newNodeId();
  const nodes: Record<string, Record<string, unknown>> = {
    [rectId]: { ...base, ...style, id: rectId, type: 'rect', cornerRadius: 4 },
    [connectorId]: {
      ...base,
      ...style,
      id: connectorId,
      type: 'connector',
      from: { nodeId: rectId, anchor: 'right' },
      to: { x: 300, y: 40 },
      route: 'elbow',
      startCap: 'none',
      endCap: 'arrow',
    },
    [textId]: {
      ...base,
      id: textId,
      type: 'text',
      fontFamily: 'Manrope',
      fontSize: 16,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: '#FFFFFFFF',
      align: 'left',
      lineHeight: 1.2,
      autoWidth: false,
    },
  };
  const animation = {
    duration: 800,
    delay: 0,
    loop: 1,
    direction: 'normal',
    autoplay: 'present',
    tracks: {
      scale: { a: { t: 0, v: 0, e: 'easeOutBack' }, b: { t: 1, v: 1, e: 'linear' } },
      opacity: { c: { t: 0, v: 0, e: 'linear' }, d: { t: 1, v: 1.2, e: 'linear' } },
    },
  };
  doc.transact(() => {
    for (const [id, props] of Object.entries(nodes)) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(props)) map.set(key, value);
      doc.getMap(ROOT_KEYS.nodes).set(id, map);
    }
    const anim = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(animation)) anim.set(key, value);
    doc.getMap(ROOT_KEYS.animations).set(rectId, anim);
  });
}

describe('migrate', () => {
  it('un documento nuevo ya está en la v2 y migrarlo es un no-op', () => {
    expect(DOCUMENT_SCHEMA_VERSION).toBe(2);
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
    const doc = new Y.Doc();
    initDocument(doc);
    const before = Y.encodeStateVector(doc);
    expect(migrate(doc)).toEqual({ from: 2, to: 2, applied: [] });
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('migrar de v1 a v2 deja nodos y animaciones idénticos', () => {
    const doc = v1Document();
    seedV1Content(doc);
    const nodes = JSON.stringify(doc.getMap(ROOT_KEYS.nodes).toJSON());
    const animations = JSON.stringify(doc.getMap(ROOT_KEYS.animations).toJSON());
    const pages = JSON.stringify(doc.getMap(ROOT_KEYS.pages).toJSON());

    expect(migrate(doc)).toEqual({ from: 1, to: 2, applied: [1] });
    expect(documentSchemaVersion(doc)).toBe(2);
    expect(JSON.stringify(doc.getMap(ROOT_KEYS.nodes).toJSON())).toBe(nodes);
    expect(JSON.stringify(doc.getMap(ROOT_KEYS.animations).toJSON())).toBe(animations);
    expect(JSON.stringify(doc.getMap(ROOT_KEYS.pages).toJSON())).toBe(pages);
    expect(migrate(doc)).toEqual({ from: 2, to: 2, applied: [] });
  });

  it('un documento v3 lanza DocumentTooNewError sin tocarlo', () => {
    const doc = new Y.Doc();
    initDocument(doc);
    doc.getMap(ROOT_KEYS.meta).set('schemaVersion', 3);
    const before = Y.encodeStateVector(doc);
    expect(() => migrate(doc)).toThrow(DocumentTooNewError);
    expect(documentSchemaVersion(doc)).toBe(3);
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('aplica migraciones en orden, en una transacción, y es idempotente', () => {
    const doc = v1Document();
    const migrations = {
      1: (d: Y.Doc) => d.getMap(ROOT_KEYS.meta).set('migratedTo2', true),
      2: (d: Y.Doc) => d.getMap(ROOT_KEYS.meta).set('migratedTo3', true),
    };
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction) => origins.push(transaction.origin));

    expect(migrate(doc, { migrations, target: 3 })).toEqual({ from: 1, to: 3, applied: [1, 2] });
    expect(documentSchemaVersion(doc)).toBe(3);
    expect(origins).toEqual([serverOrigin('migration')]);
    expect(migrate(doc, { migrations, target: 3 })).toEqual({ from: 3, to: 3, applied: [] });
  });

  it('no toca el documento si falta un paso y rechaza documentos más nuevos', () => {
    const doc = v1Document();
    expect(() => migrate(doc, { migrations: {}, target: 2 })).toThrow('Falta la migración 1 → 2');
    expect(documentSchemaVersion(doc)).toBe(1);
    doc.getMap(ROOT_KEYS.meta).set('schemaVersion', DOCUMENT_SCHEMA_VERSION + 1);
    expect(() => migrate(doc)).toThrow(DocumentTooNewError);
  });

  it('dos réplicas que migran a la vez convergen', () => {
    const a = v1Document();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const migrations = { 1: (d: Y.Doc) => d.getMap(ROOT_KEYS.meta).set('flag', 'v2') };
    migrate(a, { migrations, target: 2 });
    migrate(b, { migrations, target: 2 });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getMap(ROOT_KEYS.meta).toJSON()).toEqual(b.getMap(ROOT_KEYS.meta).toJSON());
    expect(documentSchemaVersion(a)).toBe(2);
  });
});

describe('keys', () => {
  it('traduce entre projectId y nombre de documento', () => {
    expect(documentNameFor('abc')).toBe('project:abc');
    expect(projectIdFromDocumentName('project:abc')).toBe('abc');
    expect(projectIdFromDocumentName('otro:abc')).toBeNull();
    expect(projectIdFromDocumentName('project:')).toBeNull();
  });

  it('valida el estado de presencia con 500 ids y rechaza 501', () => {
    const state = {
      user: { id: 'u1', name: 'Ana', color: '#FF6B4A', avatarAssetId: null },
      pageId: newNodeId(),
      cursor: { x: 1, y: 2 },
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: Array.from({ length: DOCUMENT_LIMITS.maxSelectionIds }, () => newNodeId()),
      selectionBox: null,
      marquee: null,
      gesture: { ids: 'selection', matrix: [1, 0, 0, 1, 10, 0] },
      editingText: null,
      chatTyping: false,
      aiBusy: false,
    };
    expect(PresenceStateSchema.safeParse(state).success).toBe(true);
    expect(JSON.stringify(state).length).toBeLessThan(DOCUMENT_LIMITS.maxAwarenessBytes);
    expect(PresenceStateSchema.safeParse({ ...state, selection: [...state.selection, newNodeId()] }).success).toBe(false);
  });
});
