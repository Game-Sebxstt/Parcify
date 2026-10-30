import type { Commands } from '../commands/Commands.ts';
import type { Tool } from '../EditorCore.ts';

export type KeyInput = { key: string; code: string; ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean };

type Action = (commands: Commands) => void;

type Shortcut = { key: string; ctrl?: boolean; shift?: boolean; edit?: boolean; run: Action };

const tool = (name: Tool): Action => (commands) => commands.setTool(name);

// Tabla de atajos. `edit` marca los que cambian el documento: no se ejecutan en solo lectura.
export const SHORTCUTS: readonly Shortcut[] = [
  { key: 'v', run: tool('select') },
  { key: 'h', run: tool('hand') },
  { key: 'r', run: tool('rect'), edit: true },
  { key: 'o', run: tool('ellipse'), edit: true },
  { key: 'l', run: tool('line'), edit: true },
  { key: 'l', shift: true, run: tool('arrow'), edit: true },
  { key: 't', run: tool('text'), edit: true },
  { key: 'c', run: tool('connector'), edit: true },
  { key: 'f', run: tool('frame'), edit: true },
  { key: 'enter', run: (c) => void c.enterSelection() },
  { key: 'enter', shift: true, run: (c) => void c.selectParent() },
  { key: 'g', ctrl: true, run: (c) => void c.groupSelection(), edit: true },
  { key: 'g', ctrl: true, shift: true, run: (c) => void c.ungroupSelection(), edit: true },
  { key: 'z', ctrl: true, run: (c) => c.undo(), edit: true },
  { key: 'z', ctrl: true, shift: true, run: (c) => c.redo(), edit: true },
  { key: 'y', ctrl: true, run: (c) => c.redo(), edit: true },
  { key: 'd', ctrl: true, run: (c) => c.duplicateSelection(), edit: true },
  { key: 'delete', run: (c) => c.deleteSelection(), edit: true },
  { key: 'backspace', run: (c) => c.deleteSelection(), edit: true },
  // Antes que «]» y «[»: en el teclado español «+» está en la tecla BracketRight.
  { key: '+', ctrl: true, run: (c) => c.zoomIn() },
  { key: '+', ctrl: true, shift: true, run: (c) => c.zoomIn() },
  { key: '=', ctrl: true, run: (c) => c.zoomIn() },
  { key: '-', ctrl: true, run: (c) => c.zoomOut() },
  { key: ']', ctrl: true, run: (c) => c.zOrder('forward'), edit: true },
  { key: '[', ctrl: true, run: (c) => c.zOrder('backward'), edit: true },
  { key: ']', ctrl: true, shift: true, run: (c) => c.zOrder('front'), edit: true },
  { key: '[', ctrl: true, shift: true, run: (c) => c.zOrder('back'), edit: true },
  { key: 'l', ctrl: true, shift: true, run: (c) => c.toggleLocked(), edit: true },
  { key: 'a', ctrl: true, run: (c) => c.selectAll() },
  { key: 'arrowleft', run: (c) => c.nudge(-1, 0), edit: true },
  { key: 'arrowright', run: (c) => c.nudge(1, 0), edit: true },
  { key: 'arrowup', run: (c) => c.nudge(0, -1), edit: true },
  { key: 'arrowdown', run: (c) => c.nudge(0, 1), edit: true },
  { key: 'arrowleft', shift: true, run: (c) => c.nudge(-10, 0), edit: true },
  { key: 'arrowright', shift: true, run: (c) => c.nudge(10, 0), edit: true },
  { key: 'arrowup', shift: true, run: (c) => c.nudge(0, -10), edit: true },
  { key: 'arrowdown', shift: true, run: (c) => c.nudge(0, 10), edit: true },
  { key: '!', shift: true, run: (c) => c.fitAll() },
  { key: '1', shift: true, run: (c) => c.fitAll() },
  { key: '2', shift: true, run: (c) => c.zoomToSelection() },
  { key: '"', shift: true, run: (c) => c.zoomToSelection() },
  { key: '0', ctrl: true, run: (c) => c.zoomTo(1) },
  { key: 'escape', run: (c) => c.escape() },
];

// Con Shift, `key` es el carácter resultante (p. ej. «!» en Shift+1); por eso también se mira `code`.
function keyOf(input: KeyInput): string[] {
  const keys = [input.key.toLowerCase()];
  if (input.code.startsWith('Digit')) keys.push(input.code.slice(5));
  if (input.code === 'BracketRight') keys.push(']');
  if (input.code === 'BracketLeft') keys.push('[');
  if (input.code === 'NumpadAdd') keys.push('+');
  if (input.code === 'NumpadSubtract') keys.push('-');
  if (input.code.startsWith('Key')) keys.push(input.code.slice(3).toLowerCase());
  return keys;
}

// Ctrl/⌘+\ oculta la interfaz y Ctrl/⌘+Shift+\ la minimiza. En el teclado español «\» sale con AltGr, que llega como
// Ctrl+Alt: aquí Alt no cuenta. También vale la tecla física de «\» del teclado inglés (o la de «<» del ISO), escriba
// lo que escriba la distribución.
const HIDE_UI: Shortcut = { key: '\\', ctrl: true, run: (c) => c.uiCommand('hideUi') };
const MINIMIZE_UI: Shortcut = { key: '\\', ctrl: true, shift: true, run: (c) => c.uiCommand('minimizeUi') };

function isBackslash(input: KeyInput): boolean {
  return input.key === '\\' || input.code === 'Backslash' || input.code === 'IntlBackslash';
}

export function findShortcut(input: KeyInput): Shortcut | null {
  if (input.ctrl && isBackslash(input)) return input.shift ? MINIMIZE_UI : HIDE_UI;
  if (input.alt) return null;
  const keys = keyOf(input);
  return (
    SHORTCUTS.find(
      (shortcut) => keys.includes(shortcut.key) && Boolean(shortcut.ctrl) === input.ctrl && Boolean(shortcut.shift) === input.shift,
    ) ?? null
  );
}
