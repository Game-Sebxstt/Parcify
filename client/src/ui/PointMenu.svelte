<script lang="ts">
  import { pointAnchor } from './anchor.ts';
  import DropdownMenu, { type MenuEntry } from './DropdownMenu.svelte';

  type Props = {
    items: MenuEntry[];
    // Punto de la ventana donde se abre; null = cerrado.
    at: { x: number; y: number } | null;
    // returnFocus es false si se cerró pulsando fuera: el foco se queda donde el usuario lo puso.
    onclose: (returnFocus: boolean) => void;
    label: string;
    // 'touch': abierto con el dedo, entradas de 44 px.
    density?: 'default' | 'touch';
    testid?: string;
    class?: string;
  };

  let { items, at, onclose, label, density = 'default', testid, class: className = '' }: Props = $props();

  // No usa el ContextMenu de bits-ui: su disparador arma su propia pulsación larga de 700 ms y saldrían dos menús.
  // A la derecha del punto, como los menús del sistema: así sube o baja lo necesario para caber entero en vez de
  // encogerse con scroll, y con el borde derecho cerca se abre hacia la izquierda.
  const anchor = $derived(at ? pointAnchor(at.x, at.y) : null);
  let returnFocus = true;

  function onOpenChange(open: boolean) {
    if (open) return;
    onclose(returnFocus);
    returnFocus = true;
  }
</script>

<DropdownMenu
  {items}
  open={at !== null}
  {anchor}
  side="right"
  align="start"
  sideOffset={2}
  sticky="always"
  {label}
  {testid}
  {density}
  class={className}
  focusFirst
  {onOpenChange}
  onInteractOutside={() => (returnFocus = false)}
  onCloseAutoFocus={(event) => event.preventDefault()}
/>
