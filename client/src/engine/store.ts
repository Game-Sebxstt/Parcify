// Contrato de store de Svelte: subscribe(fn) llama a fn con el valor actual y devuelve la baja.
export type Readable<T> = {
  subscribe(run: (value: T) => void): () => void;
  get(): T;
};

export class Store<T> implements Readable<T> {
  private readonly subscribers = new Set<(value: T) => void>();

  constructor(
    private value: T,
    private readonly equals: (a: T, b: T) => boolean = Object.is,
  ) {}

  get(): T {
    return this.value;
  }

  // force: avisa aunque el valor sea igual (p. ej. una lista con los mismos objetos parcheados en sitio).
  set(value: T, force = false): void {
    if (!force && this.equals(this.value, value)) return;
    this.value = value;
    for (const run of this.subscribers) run(value);
  }

  subscribe(run: (value: T) => void): () => void {
    this.subscribers.add(run);
    run(this.value);
    return () => this.subscribers.delete(run);
  }

  readonly(): Readable<T> {
    return { subscribe: (run) => this.subscribe(run), get: () => this.get() };
  }
}

export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
