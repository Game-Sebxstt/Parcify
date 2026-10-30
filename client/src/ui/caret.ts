// Propiedades que deciden dónde cae cada carácter de un textarea.
const COPIED = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'wordSpacing',
  'tabSize',
] as const;

// Rectángulo (en coordenadas de la ventana) del caret en la posición `index` de un textarea. Se mide con un div
// espejo que copia la tipografía y el ancho del campo. Devuelve null si no se puede medir.
export function caretRect(field: HTMLTextAreaElement, index: number): DOMRect | null {
  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  for (const property of COPIED) mirror.style[property] = style[property];
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.height = 'auto';
  mirror.style.overflow = 'hidden';
  mirror.textContent = field.value.slice(0, index);
  const marker = document.createElement('span');
  // Un carácter de ancho cero marca el sitio aunque el caret esté al final.
  marker.textContent = '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const box = field.getBoundingClientRect();
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
  const x = box.left + marker.offsetLeft - field.scrollLeft;
  const y = box.top + marker.offsetTop - field.scrollTop;
  mirror.remove();
  if (!Number.isFinite(x) || !Number.isFinite(y) || box.width === 0) return null;
  return new DOMRect(x, y, 1, lineHeight);
}
