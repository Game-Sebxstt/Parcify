import type { WheelPreference } from '../engine/index.ts';

// Preferencia «Rueda del ratón» de este navegador: desplazar el lienzo (por defecto) o hacer zoom.
const KEY = 'parcify:wheel';

export function wheelPreference(): WheelPreference {
  try {
    return localStorage.getItem(KEY) === 'zoom' ? 'zoom' : 'pan';
  } catch {
    return 'pan';
  }
}

export function setWheelPreference(value: WheelPreference) {
  try {
    if (value === 'zoom') localStorage.setItem(KEY, 'zoom');
    else localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento local la rueda se queda en «desplazar».
  }
}
