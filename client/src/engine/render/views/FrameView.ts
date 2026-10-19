import { Container, Graphics, Matrix } from 'pixi.js';
import type { Mat } from '../../geometry/matrix.ts';
import type { ContainerRecord } from '../../types.ts';
import { parseColor } from '../color.ts';

const scratch = new Matrix();

// Vista de un grupo o un frame. `root` va en el contenedor de su padre y lleva la opacidad, la visibilidad y el
// recorte; `body` guarda las vistas de los hijos (con sus matrices de mundo) y es lo que se cachea como textura.
// Un frame pinta además su fondo debajo de los hijos.
export class FrameView {
  readonly root = new Container();
  readonly body = new Container();
  readonly background: Graphics | null;
  private clipMask: Graphics | null = null;
  // Nodos que cuelgan de él (para decidir si merece la pena cachearlo como textura).
  descendants = 0;
  // Hijos con vista previa de un gesto o en edición: mientras haya alguno no se cachea.
  active = 0;
  quietSince = 0;
  cached = false;
  cacheZoom = 0;
  // Momento en que se descartó cachearlo (demasiado grande); hasta que algo cambie no se vuelve a medir.
  rejectedAt = -1;

  constructor(readonly kind: ContainerRecord['type']) {
    for (const item of [this.root, this.body]) {
      item.eventMode = 'none';
      item.interactiveChildren = false;
    }
    this.body.sortableChildren = true;
    if (kind === 'frame') {
      this.background = new Graphics();
      this.background.eventMode = 'none';
      this.root.addChild(this.background);
    } else {
      this.background = null;
    }
    this.root.addChild(this.body);
  }

  draw(record: ContainerRecord, world: Readonly<Mat>, opacity = record.opacity): void {
    if (this.root.alpha !== opacity) this.root.alpha = opacity;
    if (record.type !== 'frame' || !this.background) return;
    scratch.set(world[0], world[1], world[2], world[3], world[4], world[5]);
    const g = this.background;
    g.clear();
    if (record.fill) {
      const fill = parseColor(record.fill);
      g.rect(0, 0, record.w, record.h).fill({ color: fill.color, alpha: fill.alpha });
    }
    g.setFromMatrix(scratch);
    // Recorte rectangular: Pixi 8.22 no registra un pipe de tijera, así que es una máscara de stencil de un
    // rectángulo.
    if (record.clip) {
      if (!this.clipMask) {
        this.clipMask = new Graphics();
        this.clipMask.eventMode = 'none';
        this.root.addChild(this.clipMask);
        this.root.mask = this.clipMask;
      }
      this.clipMask.clear().rect(0, 0, record.w, record.h).fill(0xffffff);
      this.clipMask.setFromMatrix(scratch);
    } else if (this.clipMask) {
      this.root.mask = null;
      this.clipMask.destroy();
      this.clipMask = null;
    }
  }

  setCached(cached: boolean, resolution = 1): void {
    if (cached === this.cached) return;
    this.cached = cached;
    this.body.cacheAsTexture(cached ? { resolution, antialias: true } : false);
  }

  // Las vistas de los hijos ya se han sacado de `body`: solo quedan las propias.
  destroy(): void {
    this.setCached(false);
    this.root.mask = null;
    this.root.destroy({ children: true });
    this.clipMask = null;
  }
}
