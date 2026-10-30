import { FONT_FAMILIES, type FontFamily } from '../../shared/document/schema.js';

// Ficheros woff2 de public/fonts (fontsource, OFL). Cada familia variable cubre 400–700 con un solo fichero
// por subconjunto; las que no tienen cursiva usan la normal y el navegador la inclina.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF';

const FILES: Record<FontFamily, { slug: string; italic: boolean }> = {
  Manrope: { slug: 'manrope', italic: false },
  Inter: { slug: 'inter', italic: true },
  'Source Serif 4': { slug: 'source-serif-4', italic: true },
  'JetBrains Mono': { slug: 'jetbrains-mono', italic: true },
  Caveat: { slug: 'caveat', italic: false },
  Montserrat: { slug: 'montserrat', italic: true },
  Lora: { slug: 'lora', italic: true },
  'Space Grotesk': { slug: 'space-grotesk', italic: false },
};

export const DEFAULT_FONT: FontFamily = 'Manrope';

export function isFontFamily(value: unknown): value is FontFamily {
  return (FONT_FAMILIES as readonly unknown[]).includes(value);
}

// Nombre propio para no mezclarse con una fuente instalada del mismo nombre.
export function cssFamily(family: FontFamily): string {
  return `Parcify ${family}`;
}

const loads = new Map<string, Promise<void>>();
const ready = new Set<string>();
const listeners = new Set<() => void>();
let documentReady = false;

// Avisa cada vez que termina de cargar un estilo de fuente (o falla, y se pinta con la de reserva) y cuando
// document.fonts.ready se resuelve por primera vez. Quien midió con una fuente sin cargar vuelve a medir.
export function onFontLoad(listener: () => void): () => void {
  listeners.add(listener);
  if (!documentReady && available()) {
    documentReady = true;
    void document.fonts.ready.then(notify);
  }
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

const available = () => typeof FontFace !== 'undefined' && typeof document !== 'undefined' && 'fonts' in document;

function keyOf(family: FontFamily, italic: boolean): string {
  return `${family}:${italic && FILES[family].italic ? 'italic' : 'normal'}`;
}

// Sin FontFace (Node, pruebas) no hay nada que esperar.
export function fontReady(family: FontFamily, italic: boolean): boolean {
  return !available() || ready.has(keyOf(family, italic));
}

// Carga los dos subconjuntos con FontFace.load() y los añade a document.fonts, una sola vez por estilo.
export function loadFont(family: FontFamily, italic: boolean): Promise<void> {
  if (!available()) return Promise.resolve();
  const key = keyOf(family, italic);
  let load = loads.get(key);
  if (load) return load;
  const { slug, italic: hasItalic } = FILES[family];
  const style = italic && hasItalic ? 'italic' : 'normal';
  const faces = [
    [LATIN, `/fonts/${slug}/${slug}-latin-wght-${style}.woff2`],
    [LATIN_EXT, `/fonts/${slug}/${slug}-latin-ext-wght-${style}.woff2`],
  ].map(([unicodeRange, url]) => new FontFace(cssFamily(family), `url(${url}) format('woff2')`, { style, weight: '100 900', unicodeRange: unicodeRange!, display: 'block' }));
  load = Promise.all(
    faces.map(async (face) => {
      document.fonts.add(await face.load());
    }),
  ).then(
    () => {
      ready.add(key);
      notify();
    },
    // Si no carga, se pinta con la fuente por defecto en vez de esperar para siempre.
    () => {
      ready.add(key);
      notify();
    },
  );
  loads.set(key, load);
  return load;
}
