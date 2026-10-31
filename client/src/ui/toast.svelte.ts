export type ToastTone = 'info' | 'success' | 'error';

export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};

const DEFAULT_DURATION_MS = 6000;

let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function dismissToast(id: number) {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index !== -1) toasts.splice(index, 1);
}

// Un toast con acción no caduca solo en pantallas anchas: la persona tiene que poder usarla. En el móvil va arriba y
// tapa la cabecera, así que caduca a los 10 s.
const MOBILE_ACTION_DURATION_MS = 10_000;

function narrowScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches;
}

export function showToast(input: { message: string; tone?: ToastTone; action?: ToastAction; durationMs?: number }) {
  const existing = toasts.find((toast) => toast.message === input.message);
  if (existing) return existing.id;
  const toast: Toast = { id: nextId++, message: input.message, tone: input.tone ?? 'info' };
  if (input.action) toast.action = input.action;
  toasts.push(toast);
  if (!input.action) setTimeout(() => dismissToast(toast.id), input.durationMs ?? DEFAULT_DURATION_MS);
  else if (narrowScreen()) setTimeout(() => dismissToast(toast.id), Math.max(input.durationMs ?? 0, MOBILE_ACTION_DURATION_MS));
  return toast.id;
}
