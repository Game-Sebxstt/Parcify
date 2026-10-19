// Preferencia «Reducir movimiento» de la cuenta en este navegador; se suma a la del sistema.
const KEY = 'parcify:reduceMotion';

export function reduceMotionPreferred(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function applyReduceMotion(enabled = reduceMotionPreferred()) {
  if (enabled) document.documentElement.dataset.reduceMotion = '1';
  else delete document.documentElement.dataset.reduceMotion;
}

export function setReduceMotion(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento local la preferencia dura hasta recargar.
  }
  applyReduceMotion(enabled);
}

export function motionReduced(): boolean {
  return reduceMotionPreferred() || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
