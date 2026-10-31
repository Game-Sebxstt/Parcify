import { createContext } from 'svelte';
import { z } from 'zod';

export const LEFT_WIDTH = { min: 200, max: 400, initial: 248 } as const;
export const RIGHT_WIDTH = { min: 240, max: 360, initial: 248 } as const;
export const TIMELINE_HEIGHT = { min: 160, max: 640, initial: 260 } as const;
// Paso de las flechas sobre el asa de un panel.
export const WIDTH_STEP = 8;

const KEY = 'parcify:editorLayout';
const SAVE_DELAY_MS = 300;

export type PanelState = 'open' | 'collapsed';
export type UiMode = 'normal' | 'minimized' | 'hidden';
export type PanelSide = 'left' | 'right';
export type LayoutRect = { x: number; y: number; w: number; h: number };

const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const PanelSchema = z.enum(['open', 'collapsed']);

const StoredLayoutSchema = z.object({
  v: z.literal(1),
  left: PanelSchema,
  right: PanelSchema,
  ui: z.enum(['normal', 'minimized', 'hidden']),
  leftWidth: z.number().int().min(LEFT_WIDTH.min).max(LEFT_WIDTH.max),
  rightWidth: z.number().int().min(RIGHT_WIDTH.min).max(RIGHT_WIDTH.max),
  leftTab: z.enum(['layers', 'animations']),
  rightView: z.enum(['design', 'versions']),
  timeline: z.object({ open: z.boolean(), height: z.number().int().min(TIMELINE_HEIGHT.min).max(TIMELINE_HEIGHT.max) }),
  conversation: z.object({ open: z.boolean(), minimized: z.boolean(), tab: z.enum(['team', 'ai']), rect: RectSchema.nullable() }),
  gallery: z.object({ open: z.boolean(), rect: RectSchema.nullable() }),
});

export type StoredLayout = z.infer<typeof StoredLayoutSchema>;

function readStored(): StoredLayout | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = StoredLayoutSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const clamp = (value: number, range: { min: number; max: number }) => Math.round(Math.min(range.max, Math.max(range.min, value)));

// Estado de la maqueta del editor: paneles, modo de la interfaz, línea de tiempo y ventanas. Se guarda en este
// navegador con un retardo; lo que solo vale para la sesión (grabar, el cabezal) no entra aquí.
export class EditorLayout {
  left = $state<PanelState>('open');
  right = $state<PanelState>('open');
  ui = $state<UiMode>('normal');
  leftWidth = $state<number>(LEFT_WIDTH.initial);
  rightWidth = $state<number>(RIGHT_WIDTH.initial);
  leftTab = $state<'layers' | 'animations'>('layers');
  rightView = $state<'design' | 'versions'>('design');
  // `recording` (Grabar) y `head` (cabezal, en ms) son de la sesión: al recargar, Grabar está apagado y el cabezal en 0.
  // Mientras `open` es true, el editor graba en `head`; cerrar la línea de tiempo deja de grabar pero conserva Grabar
  // para la próxima vez que se abra con el botón de la barra.
  timeline = $state({ open: false, height: TIMELINE_HEIGHT.initial as number, recording: false, head: 0 });
  conversation = $state<{ open: boolean; minimized: boolean; tab: 'team' | 'ai'; rect: LayoutRect | null }>({
    open: false,
    minimized: false,
    tab: 'team',
    rect: null,
  });
  gallery = $state<{ open: boolean; rect: LayoutRect | null }>({ open: false, rect: null });
  // Altura de reposo de cada hoja del móvil (índice de sus alturas), solo para la sesión: al cerrar una hoja y volver a
  // abrirla, sale con la que tenía.
  sheetLevels = $state<Record<string, number>>({});

  // Modo al que vuelve «Mostrar interfaz».
  #beforeHidden: UiMode = 'normal';
  #timer: ReturnType<typeof setTimeout> | null = null;
  #written = '';

  // compact: tablet o móvil. Sin estado guardado, los paneles empiezan plegados para dejar el lienzo libre.
  // Hay que crearla durante la inicialización de un componente: guarda los cambios con un efecto.
  constructor(options: { compact: boolean }) {
    const saved = readStored();
    if (saved) this.#apply(saved);
    else if (options.compact) {
      this.left = 'collapsed';
      this.right = 'collapsed';
    }
    // Sin cambios no se escribe nada: así una tablet que abre por primera vez sigue sin estado guardado.
    this.#written = JSON.stringify(this.snapshot());
    $effect(() => {
      const json = JSON.stringify(this.snapshot());
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = json === this.#written ? null : setTimeout(() => this.#write(json), SAVE_DELAY_MS);
    });
  }

  #apply(saved: StoredLayout) {
    this.left = saved.left;
    this.right = saved.right;
    this.ui = saved.ui;
    this.leftWidth = saved.leftWidth;
    this.rightWidth = saved.rightWidth;
    this.leftTab = saved.leftTab;
    this.rightView = saved.rightView;
    this.timeline = { ...saved.timeline, recording: false, head: 0 };
    this.conversation = { ...saved.conversation };
    this.gallery = { ...saved.gallery };
  }

  #write(json: string) {
    this.#timer = null;
    this.#written = json;
    try {
      localStorage.setItem(KEY, json);
    } catch {
      // Sin almacenamiento local la maqueta dura lo que la pestaña.
    }
  }

  snapshot(): StoredLayout {
    return {
      v: 1,
      left: this.left,
      right: this.right,
      ui: this.ui,
      leftWidth: this.leftWidth,
      rightWidth: this.rightWidth,
      leftTab: this.leftTab,
      rightView: this.rightView,
      timeline: { open: this.timeline.open, height: this.timeline.height },
      conversation: { ...this.conversation, rect: this.conversation.rect ? { ...this.conversation.rect } : null },
      gallery: { open: this.gallery.open, rect: this.gallery.rect ? { ...this.gallery.rect } : null },
    };
  }

  // Al salir de la página no se espera al retardo.
  flush() {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#write(JSON.stringify(this.snapshot()));
  }

  setWidth(side: PanelSide, width: number) {
    if (side === 'left') this.leftWidth = clamp(width, LEFT_WIDTH);
    else this.rightWidth = clamp(width, RIGHT_WIDTH);
  }

  // Abrir un panel desde su pastilla también saca la interfaz del modo minimizado.
  open(side: PanelSide) {
    this.ui = 'normal';
    this[side] = 'open';
  }

  collapse(side: PanelSide) {
    this[side] = 'collapsed';
  }

  // Ctrl/⌘+\: todo menos el lienzo, y vuelta al modo anterior.
  toggleHidden() {
    if (this.ui === 'hidden') this.ui = this.#beforeHidden;
    else {
      this.#beforeHidden = this.ui;
      this.ui = 'hidden';
    }
  }

  // Ctrl/⌘+Shift+\: los dos paneles como pastillas.
  toggleMinimized() {
    this.ui = this.ui === 'minimized' ? 'normal' : 'minimized';
  }

  // Los accesos de «quiero animar esto» abren con Grabar encendido; el botón de la barra la deja como estaba.
  openTimeline(options: { record?: boolean } = {}) {
    this.timeline.open = true;
    if (options.record) this.timeline.recording = true;
  }

  closeTimeline() {
    this.timeline.open = false;
  }
}

export const [getEditorLayout, setEditorLayout] = createContext<EditorLayout>();
