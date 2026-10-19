// Selección múltiple de una lista ordenada: clic alterna, Shift+clic selecciona el tramo desde el ancla.
export class Selection {
  ids = $state<string[]>([]);
  private anchor: string | null = null;

  get size(): number {
    return this.ids.length;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  toggle(id: string, order: readonly string[], options: { range?: boolean } = {}) {
    if (options.range && this.anchor !== null && order.includes(this.anchor) && order.includes(id)) {
      const from = order.indexOf(this.anchor);
      const to = order.indexOf(id);
      const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      const chosen = [...this.ids, ...span];
      this.ids = order.filter((item) => chosen.includes(item));
      return;
    }
    this.ids = this.has(id) ? this.ids.filter((item) => item !== id) : order.filter((item) => item === id || this.has(item));
    this.anchor = id;
  }

  selectAll(order: readonly string[]) {
    this.ids = [...order];
    this.anchor = order.at(-1) ?? null;
  }

  clear() {
    this.ids = [];
    this.anchor = null;
  }

  // Al recargar o filtrar la lista, se olvidan los ids que ya no están.
  retain(order: readonly string[]) {
    if (this.ids.every((id) => order.includes(id))) return;
    this.ids = this.ids.filter((id) => order.includes(id));
    if (this.anchor !== null && !order.includes(this.anchor)) this.anchor = null;
  }
}
