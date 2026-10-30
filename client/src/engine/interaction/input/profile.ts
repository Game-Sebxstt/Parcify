export type PointerKind = 'mouse' | 'pen' | 'touch';

// Umbrales y tamaños que dependen del puntero con el que se trabaja. Todo en px de pantalla salvo que se diga otra cosa.
export type InputProfile = {
  kind: PointerKind;
  // Lado del tirador dibujado.
  handleDraw: number;
  // Lado de la zona de impacto del tirador.
  handleHit: number;
  dragThreshold: number;
  // Distancia por fuera de la esquina en la que se gira: [mín, máx].
  rotateZone: readonly [number, number];
  // Sin hover no hay forma de descubrir la zona de giro: el dedo tiene un tirador visible, a esta distancia del borde.
  rotateHandle: number | null;
  rotateSnapDeg: number;
  doubleMs: number;
  doublePx: number;
  // null: el ratón abre el menú con el botón secundario.
  longPressMs: number | null;
  longPressSlop: number;
  // Tolerancia al pulsar sobre trazos.
  lineHitPx: number;
  // Margen alrededor de la caja de la selección dentro del cual un hueco arrastra toda la selección.
  boxSlop: number;
  // Con el dedo, la selección cambia al pasar el umbral o al soltar, para que un pellizco no la cambie.
  deferSelection: boolean;
  // Radio y puntos medios solo con hover; con el dedo se ven siempre.
  showHoverOnly: boolean;
};

// Cada perfil se congela por separado: los comparten todos los lienzos de la página.
export const INPUT_PROFILES: Readonly<Record<PointerKind, Readonly<InputProfile>>> = Object.freeze({
  mouse: Object.freeze<InputProfile>({
    kind: 'mouse',
    handleDraw: 8,
    handleHit: 16,
    dragThreshold: 4,
    rotateZone: [6, 22],
    rotateHandle: null,
    rotateSnapDeg: 3,
    doubleMs: 400,
    doublePx: 6,
    longPressMs: null,
    longPressSlop: 8,
    lineHitPx: 6,
    boxSlop: 4,
    deferSelection: false,
    showHoverOnly: true,
  }),
  pen: Object.freeze<InputProfile>({
    kind: 'pen',
    handleDraw: 12,
    handleHit: 24,
    dragThreshold: 6,
    rotateZone: [8, 28],
    rotateHandle: null,
    rotateSnapDeg: 5,
    doubleMs: 400,
    doublePx: 16,
    longPressMs: 500,
    longPressSlop: 8,
    lineHitPx: 10,
    boxSlop: 6,
    deferSelection: false,
    showHoverOnly: true,
  }),
  touch: Object.freeze<InputProfile>({
    kind: 'touch',
    handleDraw: 16,
    handleHit: 44,
    dragThreshold: 8,
    rotateZone: [10, 36],
    rotateHandle: 24,
    rotateSnapDeg: 5,
    doubleMs: 300,
    doublePx: 35,
    longPressMs: 500,
    longPressSlop: 8,
    lineHitPx: 16,
    boxSlop: 8,
    deferSelection: true,
    showHoverOnly: false,
  }),
});

// Incrustado no hay pellizco de dos dedos que proteger: el toque selecciona al tocar, como con el ratón.
export const EMBEDDED_PROFILES: Readonly<Record<PointerKind, Readonly<InputProfile>>> = Object.freeze({
  mouse: INPUT_PROFILES.mouse,
  pen: INPUT_PROFILES.pen,
  touch: Object.freeze<InputProfile>({ ...INPUT_PROFILES.touch, deferSelection: false }),
});

export function toPointerKind(pointerType: string): PointerKind {
  return pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse';
}

// Solo para el primer frame: después manda el pointerType real de cada evento, porque hay portátiles táctiles con
// touchpad y la media query describe el puntero principal, no el que se está usando.
export function initialKind(): PointerKind {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'mouse';
  return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
}
