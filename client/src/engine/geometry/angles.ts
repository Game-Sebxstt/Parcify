// Ángulos en grados para la interfaz y el imán; el documento guarda radianes.

export const SNAP_STEP_DEG = 45;
export const SHIFT_STEP_DEG = 15;

export const toRad = (deg: number) => (deg * Math.PI) / 180;
export const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Lleva el ángulo a (−180°, 180°].
export function normalizeDeg(angle: number): number {
  const wrapped = (((angle + 180) % 360) + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped || 0;
}

// Se redondea después de normalizar: al revés, el módulo vuelve a meter error de coma flotante (12,3 → 12,2999…).
function rounded(angle: number): number {
  const value = Math.round(normalizeDeg(angle) * 10) / 10;
  return value === -180 ? 180 : value || 0;
}

export type RotationSnap = { angle: number; snapped: boolean };

// Sin modificador se imanta a los múltiplos de 45° a menos de thresholdDeg; Shift va en pasos de 15° y Ctrl desactiva
// el imán. El resultado sale redondeado a 0,1° y en (−180°, 180°].
export function snapRotation(angle: number, opts: { shift: boolean; ctrl: boolean; thresholdDeg: number }): RotationSnap {
  if (opts.ctrl) return { angle: rounded(angle), snapped: false };
  if (opts.shift) return { angle: rounded(Math.round(angle / SHIFT_STEP_DEG) * SHIFT_STEP_DEG), snapped: true };
  const nearest = Math.round(angle / SNAP_STEP_DEG) * SNAP_STEP_DEG;
  if (Math.abs(angle - nearest) < opts.thresholdDeg) return { angle: rounded(nearest), snapped: true };
  return { angle: rounded(angle), snapped: false };
}
