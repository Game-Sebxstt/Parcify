// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { longPress, NATIVE_MENU_GRACE_MS, type LongPressPoint } from './longpress.ts';

type PointerInit = { pointerId?: number; pointerType?: string; clientX?: number; clientY?: number; button?: number };

function pointer(type: string, init: PointerInit = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const values = { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 20, button: 0, ...init };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  return event;
}

function setup(options?: { ms?: number; slop?: number }) {
  const node = document.createElement('div');
  const child = document.createElement('span');
  node.append(child);
  document.body.append(node);
  const handler = vi.fn<(point: LongPressPoint) => void>();
  const destroy = longPress(handler, options)(node);
  return { node, child, handler, destroy: () => (destroy as () => void)() };
}

describe('longPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('dispara a los ms con el punto y el objetivo del dedo', () => {
    const { child, handler } = setup({ ms: 500 });
    child.dispatchEvent(pointer('pointerdown', { clientX: 40, clientY: 60 }));
    vi.advanceTimersByTime(499);
    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ clientX: 40, clientY: 60, pointerType: 'touch', target: child });
  });

  it('se cancela al moverse más que el margen, pero no con un temblor dentro de él', () => {
    const { node, handler } = setup({ slop: 8 });
    node.dispatchEvent(pointer('pointerdown'));
    node.dispatchEvent(pointer('pointermove', { clientX: 15, clientY: 24 }));
    vi.advanceTimersByTime(500);
    expect(handler).toHaveBeenCalledOnce();

    node.dispatchEvent(pointer('pointerdown', { pointerId: 2 }));
    node.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 19, clientY: 20 }));
    vi.advanceTimersByTime(500);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('se cancela al soltar, con pointercancel y con un segundo dedo', () => {
    const { node, handler } = setup();
    node.dispatchEvent(pointer('pointerdown'));
    node.dispatchEvent(pointer('pointerup'));
    node.dispatchEvent(pointer('pointerdown', { pointerId: 2 }));
    node.dispatchEvent(pointer('pointercancel', { pointerId: 2 }));
    node.dispatchEvent(pointer('pointerdown', { pointerId: 3 }));
    node.dispatchEvent(pointer('pointerdown', { pointerId: 4 }));
    vi.advanceTimersByTime(1000);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignora el ratón y el botón lateral del lápiz', () => {
    const { node, handler } = setup();
    node.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(1000);
    node.dispatchEvent(pointer('pointerdown', { pointerId: 2, pointerType: 'pen', button: 2 }));
    vi.advanceTimersByTime(1000);
    expect(handler).not.toHaveBeenCalled();
    node.dispatchEvent(pointer('pointerdown', { pointerId: 3, pointerType: 'pen' }));
    vi.advanceTimersByTime(500);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('anula el clic que sigue a la pulsación larga, y solo ese', () => {
    const { child } = setup();
    const onclick = vi.fn();
    child.addEventListener('click', onclick);
    child.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(500);
    child.dispatchEvent(pointer('pointerup'));
    const first = new MouseEvent('click', { bubbles: true, cancelable: true });
    child.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(onclick).not.toHaveBeenCalled();
    child.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('descarta el contextmenu nativo durante el gesto y poco después, pero no el del teclado de más tarde', () => {
    const { child } = setup();
    const contextmenu = () => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      child.dispatchEvent(event);
      return event.defaultPrevented;
    };
    child.dispatchEvent(pointer('pointerdown'));
    expect(contextmenu()).toBe(true);
    vi.advanceTimersByTime(500);
    child.dispatchEvent(pointer('pointerup'));
    vi.advanceTimersByTime(NATIVE_MENU_GRACE_MS - 1);
    expect(contextmenu()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(contextmenu()).toBe(false);
  });

  it('con el ratón no toca el contextmenu, y al desmontarse deja de escuchar', () => {
    const { node, child, handler, destroy } = setup();
    node.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    child.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    node.dispatchEvent(pointer('pointerdown', { pointerId: 2 }));
    destroy();
    vi.advanceTimersByTime(1000);
    expect(handler).not.toHaveBeenCalled();
  });
});
