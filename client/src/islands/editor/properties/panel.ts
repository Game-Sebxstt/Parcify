import type { Engine, FramePresetId, GeometryPatch, NodeRecord, StyleEach, StylePatch, TextSizeMode } from '../../../engine/index.ts';
import type { AnimProp } from '../../../shared/document/schema.js';
import { m } from '../../../paraglide/messages.js';
import { parseHex, topColors } from '../../../ui/color.ts';

export const PRESET_LABELS: Record<FramePresetId, () => string> = {
  '16:9': m.editor_preset_16_9,
  '4:3': m.editor_preset_4_3,
  '1:1': m.editor_preset_1_1,
  A4: m.editor_preset_a4,
  'A4-landscape': m.editor_preset_a4_landscape,
  letter: m.editor_preset_letter,
  phone: m.editor_preset_phone,
  story: m.editor_preset_story,
};

// Lo que emiten ScrubInput y ColorPicker al confirmar: `merge` funde el paso con el anterior (↑/↓ seguidas).
export type CommitMeta = { merge: boolean };

// Instante del cabezal cuya pose muestra el panel (null con la línea de tiempo cerrada) y la versión de las
// animaciones, para volver a leerla cuando cambian.
export type Posed = { at: number | null; version: number };

// Rombos de keyframe del panel: solo existen con la línea de tiempo abierta y el panel editable. `at` es el cabezal
// (ms) y `version`, la de las animaciones, para volver a leer las pistas cuando cambian.
export type KeyframeContext = { engine: Engine; at: number; version: number };

// Lo que el panel deja animar a cada tipo con un rombo, igual que la grabación: un conector no se anima, una línea
// no gira ni cambia de tamaño, y un texto o un grupo no cambian de tamaño (va al diseño con un aviso).
export function animatable(record: NodeRecord, prop: AnimProp): boolean {
  if (record.type === 'connector') return false;
  switch (prop) {
    case 'scaleX':
    case 'scaleY':
      return record.type !== 'line' && record.type !== 'text' && record.type !== 'group';
    case 'rotation':
      return record.type !== 'line';
    case 'fill':
      return record.type === 'text' || (record.type !== 'line' && typeof (record as { fill?: unknown }).fill === 'string');
    case 'stroke':
      return typeof (record as { stroke?: unknown }).stroke === 'string';
    default:
      return true;
  }
}

// Valor compartido por los registros que tienen la propiedad: `mixed` si no coinciden.
export function shared<R, T>(records: readonly R[], read: (record: R) => T | undefined): { value: T | undefined; mixed: boolean } {
  let value: T | undefined;
  let found = false;
  for (const record of records) {
    const next = read(record);
    if (next === undefined) continue;
    if (!found) {
      value = next;
      found = true;
    } else if (!Object.is(next, value)) return { value, mixed: true };
  }
  return { value, mixed: false };
}

// Opacidad en % compartida por los colores que devuelve `read`.
export function sharedAlpha<R extends NodeRecord>(records: readonly R[], read: (record: R) => string | undefined): { value: number | undefined; mixed: boolean } {
  return shared(records, (record) => {
    const rgba = parseHex(read(record) ?? '');
    return rgba ? Math.round(rgba.a * 100) : undefined;
  });
}

// Color nuevo de una fila: el mismo para todos o calculado sobre el color de cada nodo (cambiar solo la opacidad
// conserva el RGB de cada uno).
export type ColorChange = string | ((current: string) => string);
type ColorKey = 'fill' | 'stroke' | 'color' | 'labelColor';

// `read` da el color actual de un nodo de la fila; los que no tienen ninguno no cambian con un cambio relativo.
export function colorPatch(key: ColorKey, change: ColorChange, read: (record: NodeRecord) => string | undefined): StylePatch | StyleEach {
  const patch = (color: string) => ({ [key]: color }) as StylePatch;
  if (typeof change === 'string') return patch(change);
  return (record) => {
    const current = read(record);
    return current === undefined ? null : patch(change(current));
  };
}

// Los 12 colores más usados en la página, para la fila «Colores del documento» del selector.
export function pageColors(engine: Engine): string[] {
  const page = engine.state.pageId.get();
  const colors: string[] = [];
  for (const record of engine.core.store.all()) {
    if (record.pageId !== page) continue;
    for (const key of ['fill', 'stroke', 'color', 'labelColor'] as const) {
      const value = (record as Partial<Record<typeof key, unknown>>)[key];
      if (typeof value === 'string') colors.push(value);
    }
  }
  return topColors(colors);
}

// Escrituras del panel con el contrato de vista previa de Commands. Si la selección cambia con una vista previa
// abierta, Commands ya la confirmó sobre los nodos que tenía; la confirmación que llega después del campo (al perder
// el foco o al desmontarse) pertenece a la selección anterior y no se aplica a la nueva.
export class PanelEdits {
  private owner: string | null = null;

  constructor(
    private readonly engine: () => Engine,
    private readonly ids: () => readonly string[],
  ) {}

  private get key(): string {
    return this.ids().join(',');
  }

  // Una vista previa nueva siempre pertenece a la selección actual.
  private begin(): void {
    this.owner = this.key;
  }

  private own(): boolean {
    const mine = this.owner === null || this.owner === this.key;
    this.owner = null;
    return mine;
  }

  previewGeometry(patch: GeometryPatch): void {
    this.begin();
    this.engine().commands.previewGeometry(this.ids(), patch);
  }

  setGeometry(patch: GeometryPatch, meta: CommitMeta = { merge: false }): void {
    if (this.own()) this.engine().commands.setGeometry(this.ids(), patch, { merge: meta.merge });
  }

  previewStyle(patch: StylePatch | StyleEach): void {
    this.begin();
    this.engine().commands.previewStyle(patch, { autoCommit: false });
  }

  setStyle(patch: StylePatch | StyleEach, meta: CommitMeta = { merge: false }): void {
    if (this.own()) this.engine().commands.setStyle(patch, this.ids(), { merge: meta.merge });
  }

  cancel(): void {
    this.owner = null;
    this.engine().commands.cancelPreview();
  }

  // Modo de tamaño de los textos seleccionados (auto-ancho, auto-alto o fijo), con la caja medida.
  setTextMode(mode: TextSizeMode): void {
    this.owner = null;
    this.engine().commands.setTextMode(this.ids(), mode);
  }

  // «Restablecer recorrido» en los conectores seleccionados, en un solo paso.
  resetPath(): void {
    this.owner = null;
    this.engine().commands.resetConnectorPath(this.ids());
  }
}

// Formas con texto interior (las que tienen labelFontSize en el esquema).
export const LABEL_TYPES: ReadonlySet<string> = new Set(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc', 'connector']);
