const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const MOD_KEY = MAC ? '⌘' : 'Ctrl';
export const MOD_ARIA = MAC ? 'Meta' : 'Control';

export type UiKeys = { hide: string; minimize: string; hideAria: string; minimizeAria: string };

export const DEFAULT_UI_KEYS: UiKeys = keysFor('\\');

function keysFor(key: string): UiKeys {
  return {
    hide: `${MOD_KEY}+${key}`,
    minimize: `${MOD_KEY}+Shift+${key}`,
    hideAria: `${MOD_ARIA}+\\`,
    minimizeAria: `${MOD_ARIA}+Shift+\\`,
  };
}

type LayoutMapKeyboard = { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> };

// La tecla física de «\» del teclado inglés escribe otra cosa en otras distribuciones (ç en la española) y el atajo
// también responde a ella: se enseña lo que pone en el teclado de la persona. Sin la API, «\».
export async function loadUiKeys(): Promise<UiKeys> {
  try {
    const keyboard = (navigator as Navigator & { keyboard?: LayoutMapKeyboard }).keyboard;
    const map = await keyboard?.getLayoutMap?.();
    const key = map?.get('Backslash');
    return key ? keysFor(key.toLocaleUpperCase()) : DEFAULT_UI_KEYS;
  } catch {
    return DEFAULT_UI_KEYS;
  }
}
