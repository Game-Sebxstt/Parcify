export type TextEdit = { start: number; end: number; insert: string };

const WORD_BEFORE = /[\p{L}\p{N}_]+[^\p{L}\p{N}_\n]*$|[^\p{L}\p{N}_\n]+$|\n$/u;
const WORD_AFTER = /^[^\p{L}\p{N}_\n]*[\p{L}\p{N}_]+|^[^\p{L}\p{N}_\n]+|^\n/u;

// Un carácter visible a la izquierda o a la derecha, sin partir pares sustitutos.
function previousCharStart(value: string, index: number): number {
  if (index <= 0) return 0;
  const low = value.charCodeAt(index - 1);
  return index >= 2 && low >= 0xdc00 && low <= 0xdfff ? index - 2 : index - 1;
}

function nextCharEnd(value: string, index: number): number {
  if (index >= value.length) return value.length;
  const high = value.charCodeAt(index);
  return high >= 0xd800 && high <= 0xdbff && index + 1 < value.length ? index + 2 : index + 1;
}

// Traduce un beforeinput a una edición de texto plano sobre [start, end). null = no es una edición de texto.
export function editFor(inputType: string, data: string | null, start: number, end: number, value: string): TextEdit | null {
  const collapsed = start === end;
  switch (inputType) {
    case 'insertText':
    case 'insertReplacementText':
    case 'insertFromPaste':
    case 'insertFromDrop':
    case 'insertFromYank':
    case 'insertCompositionText':
      return { start, end, insert: (data ?? '').replace(/\r\n?/g, '\n') };
    case 'insertLineBreak':
    case 'insertParagraph':
      return { start, end, insert: '\n' };
    case 'deleteContentBackward':
      return collapsed ? { start: previousCharStart(value, start), end, insert: '' } : { start, end, insert: '' };
    case 'deleteContentForward':
      return collapsed ? { start, end: nextCharEnd(value, end), insert: '' } : { start, end, insert: '' };
    case 'deleteWordBackward': {
      if (!collapsed) return { start, end, insert: '' };
      const match = WORD_BEFORE.exec(value.slice(0, start));
      return { start: start - (match?.[0].length ?? 0), end, insert: '' };
    }
    case 'deleteWordForward': {
      if (!collapsed) return { start, end, insert: '' };
      const match = WORD_AFTER.exec(value.slice(end));
      return { start, end: end + (match?.[0].length ?? 0), insert: '' };
    }
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward': {
      if (!collapsed) return { start, end, insert: '' };
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      return { start: lineStart === start ? previousCharStart(value, start) : lineStart, end, insert: '' };
    }
    case 'deleteSoftLineForward':
    case 'deleteHardLineForward': {
      if (!collapsed) return { start, end, insert: '' };
      const lineEnd = value.indexOf('\n', end);
      return { start, end: lineEnd === -1 ? value.length : lineEnd === end ? end + 1 : lineEnd, insert: '' };
    }
    case 'deleteByCut':
    case 'deleteByDrag':
    case 'deleteContent':
      return { start, end, insert: '' };
    default:
      return null;
  }
}

// La diferencia mínima entre dos textos, como una sola sustitución (para lo que el navegador ya escribió).
export function diffText(before: string, after: string): TextEdit | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let tail = 0;
  while (tail < max - start && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++;
  return { start, end: before.length - tail, insert: after.slice(start, after.length - tail) };
}
