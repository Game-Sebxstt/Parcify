<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getEditorLayout, RIGHT_WIDTH } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import PanelResizer from './PanelResizer.svelte';

  type Props = {
    open: boolean;
    // Barra de sesión: completa dentro del panel o compacta en la pastilla plegada.
    header: Snippet<[compact: boolean]>;
    design: Snippet;
    versions: Snippet;
    // Interfaz oculta o presentando: ni panel ni pastilla.
    hidden: boolean;
    width?: number;
    // Alto que tapan por abajo las barras flotantes (tablet): el contenido termina por encima.
    clearance?: number;
  };

  let { open, header, design, versions, hidden, width = $bindable(0), clearance = 0 }: Props = $props();

  const layout = getEditorLayout();
</script>

<aside
  bind:offsetWidth={width}
  aria-label={m.editor_props_label()}
  {hidden}
  inert={!open}
  style:width="{layout.rightWidth}px"
  class={[
    'absolute top-2 right-2 bottom-2 z-(--z-panel) flex flex-col rounded-panel border border-edge/40 bg-surface-1 text-ui shadow-panel',
    'touch-pan-x touch-pan-y transition-[translate,opacity,visibility] duration-(--dur-slow) ease-out',
    open ? '' : 'invisible translate-x-[calc(100%+1rem)] opacity-0',
  ]}
  data-testid="right-panel"
  data-state={open ? 'open' : 'collapsed'}
>
  <PanelResizer
    edge="left"
    width={layout.rightWidth}
    min={RIGHT_WIDTH.min}
    max={RIGHT_WIDTH.max}
    label={m.editor_panel_resize_right()}
    onresize={(next) => layout.setWidth('right', next)}
  />
  {#if open}
    {@render header(false)}
  {/if}
  <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden border-t border-edge/25" style:padding-bottom={clearance ? `${clearance}px` : null}>
    <div hidden={layout.rightView !== 'design'} class="scroll-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      {@render design()}
    </div>
    {@render versions()}
  </div>
</aside>

{#if !open && !hidden}
  <!-- Con las dos pastillas en una ventana estrecha, cada una se queda con su mitad y esta desplaza sus botones. -->
  <div
    class="scroll-thin absolute top-2 right-2 z-(--z-panel) max-w-[calc(50%-0.75rem)] touch-pan-x touch-pan-y overflow-x-auto overflow-y-hidden rounded-panel border border-edge/40 bg-surface-2 text-ui shadow-float"
    data-testid="right-panel-pill"
  >
    {@render header(true)}
  </div>
{/if}
