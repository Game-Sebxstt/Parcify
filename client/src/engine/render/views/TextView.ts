import { CanvasTextMetrics, Container, Graphics, Text, TextStyle, type TextStyleFontWeight, type TextStyleOptions } from 'pixi.js';
import { cssFamily, fontReady, loadFont } from '../../text/fonts.ts';
import { ALIGN_FACTOR, cappedResolution, layoutKey, LONG_TEXT_CHARS, type TextLayout } from '../../text/layout.ts';
import { parseColor } from '../color.ts';

// El estilo con el que se pinta un texto. measureTextBox mide con este mismo estilo, así que la caja guardada y lo
// pintado coinciden.
export function textStyleOf(layout: TextLayout): TextStyleOptions {
  return {
    fontFamily: cssFamily(layout.family),
    fontSize: layout.size,
    fontWeight: String(layout.weight) as TextStyleFontWeight,
    fontStyle: layout.italic ? 'italic' : 'normal',
    fill: parseColor(layout.color).color,
    align: layout.align,
    lineHeight: layout.size * layout.lineHeight,
    whiteSpace: 'pre',
    breakWords: true,
    wordWrap: layout.wrapWidth !== null,
    wordWrapWidth: layout.wrapWidth ?? 0,
    padding: Math.ceil(layout.size * 0.2),
  };
}

// Un Text de Pixi (canvas) por nodo con texto, más el subrayado y el tachado. La resolución sigue al zoom
// con el tope de textura por lado; el contenido nunca se interpreta como marcado.
export class TextView {
  readonly container = new Container();
  private readonly text: Text;
  private readonly decorations = new Graphics();
  private key = '';
  private target = 1;
  // La fuente aún no estaba lista: hay que volver a pintar cuando cargue.
  waiting = false;
  // Tiene un texto pintado (no vacío ni esperando fuente).
  active = false;

  constructor() {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
    this.text = new Text({ text: '', style: new TextStyle({ whiteSpace: 'pre', breakWords: true }) });
    this.text.eventMode = 'none';
    this.decorations.eventMode = 'none';
    this.container.addChild(this.text, this.decorations);
  }

  get resolution(): number {
    return this.target;
  }

  get long(): boolean {
    return this.text.text.length > LONG_TEXT_CHARS;
  }

  // Devuelve una promesa si la fuente no estaba cargada: se pinta en cuanto llegue.
  update(layout: TextLayout, resolution: number): Promise<void> | null {
    if (!fontReady(layout.family, layout.italic)) {
      this.waiting = true;
      this.active = false;
      this.container.visible = false;
      return loadFont(layout.family, layout.italic);
    }
    this.waiting = false;
    this.active = true;
    this.container.visible = true;
    const key = layoutKey(layout);
    if (key === this.key) {
      this.setResolution(resolution);
      return null;
    }
    this.key = key;
    const { color, alpha } = parseColor(layout.color);
    const lineHeight = layout.size * layout.lineHeight;
    Object.assign(this.text.style, textStyleOf(layout));
    this.text.text = layout.content;
    this.text.alpha = alpha;

    const width = this.text.width;
    const height = this.text.height;
    const { box } = layout;
    const x = box.x + (layout.wrapWidth === null ? 0 : (box.w - width) * ALIGN_FACTOR[layout.align]);
    const y = box.y + (box.h - height) * ALIGN_FACTOR[layout.vAlign];
    this.text.position.set(x, y);
    this.drawDecorations(layout, x, y, width, lineHeight, color, alpha);
    this.target = 0;
    this.setResolution(resolution);
    return null;
  }

  setResolution(resolution: number): void {
    if (resolution === this.target) return;
    this.target = resolution;
    const next = cappedResolution(resolution, this.text.width, this.text.height);
    if (this.text.resolution !== next) this.text.resolution = next;
  }

  private drawDecorations(layout: TextLayout, x: number, y: number, width: number, lineHeight: number, color: number, alpha: number): void {
    const g = this.decorations.clear();
    if (!layout.underline && !layout.strike) return;
    const metrics = CanvasTextMetrics.measureText(layout.content || ' ', this.text.style);
    const thickness = Math.max(1, layout.size / 14);
    metrics.lines.forEach((_, i) => {
      const lineWidth = metrics.lineWidths[i] ?? 0;
      if (lineWidth <= 0) return;
      const lx = x + (width - lineWidth) * ALIGN_FACTOR[layout.align];
      const top = y + i * lineHeight;
      if (layout.underline) g.rect(lx, top + (lineHeight + layout.size) / 2 - thickness, lineWidth, thickness);
      if (layout.strike) g.rect(lx, top + lineHeight / 2 - thickness / 2, lineWidth, thickness);
    });
    g.fill({ color, alpha });
  }

  clear(): void {
    this.key = '';
    this.active = false;
    this.text.text = '';
    this.decorations.clear();
    this.container.visible = false;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
