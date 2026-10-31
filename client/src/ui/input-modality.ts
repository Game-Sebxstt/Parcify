// Último modo de entrada de la página. Con el dedo no hay hover que cierre un tooltip: tras un toque se quedaría a la
// vista encima del botón (o saldría al devolver el foco a otro). La tecla siguiente vuelve al modo teclado.
let touching = false;
let installed = false;

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', (event) => (touching = event.pointerType === 'touch'), { capture: true, passive: true });
  document.addEventListener('keydown', () => (touching = false), { capture: true, passive: true });
  // En un portátil táctil, mover el ratón después de un toque devuelve el hover sin esperar a un clic.
  document.addEventListener(
    'pointermove',
    (event) => {
      if (touching && event.pointerType === 'mouse') touching = false;
    },
    { capture: true, passive: true },
  );
}

// Se llama al montar quien lo consulta, para que los oyentes estén antes del primer toque.
export function watchInputModality(): void {
  install();
}

export function lastInputWasTouch(): boolean {
  install();
  return touching;
}
