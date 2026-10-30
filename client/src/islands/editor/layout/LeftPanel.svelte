<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Engine } from '../../../engine/index.ts';
  import { getEditorLayout, LEFT_WIDTH } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import LayersPanel from '../LayersPanel.svelte';
  import PagesPanel from '../PagesPanel.svelte';
  import PanelResizer from './PanelResizer.svelte';

  type Props = {
    engine: Engine | null;
    readOnly: boolean;
    open: boolean;
    // Cabecera de archivo: completa dentro del panel o compacta en la pastilla plegada.
    header: Snippet<[compact: boolean]>;
    // Interfaz oculta o presentando: ni panel ni pastilla.
    hidden: boolean;
    // Ancho del panel en pantalla, para colocar lo que flota a su lado.
    width?: number;
    // Alto que tapan por abajo las barras flotantes (tablet): el contenido termina por encima.
    clearance?: number;
  };

  let { engine, readOnly, open, header, hidden, width = $bindable(0), clearance = 0 }: Props = $props();

  const layout = getEditorLayout();
  let layers = $state<ReturnType<typeof LayersPanel> | null>(null);

  // «Renombrar» desde el lienzo: con el panel plegado, primero se abre.
  export async function rename(id: string) {
    if (!open) layout.open('left');
    await layers?.rename(id);
  }
</script>

<aside
  bind:offsetWidth={width}
  aria-label={m.editor_side_label()}
  {hidden}
  inert={!open}
  style:width="{layout.leftWidth}px"
  class={[
    'absolute top-2 bottom-2 left-2 z-(--z-panel) flex flex-col rounded-panel border border-edge/40 bg-surface-1 text-ui shadow-panel',
    'touch-pan-x touch-pan-y transition-[translate,opacity,visibility] duration-(--dur-slow) ease-out',
    open ? '' : 'invisible -translate-x-[calc(100%+1rem)] opacity-0',
  ]}
  data-testid="left-panel"
  data-state={open ? 'open' : 'collapsed'}
>
  {#if open}
    {@render header(false)}
  {/if}
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-edge/25" style:padding-bottom={clearance ? `${clearance}px` : null}>
    {#if engine}
      <PagesPanel {engine} {readOnly} />
      <LayersPanel bind:this={layers} {engine} {readOnly} />
    {/if}
  </div>
  <PanelResizer
    edge="right"
    width={layout.leftWidth}
    min={LEFT_WIDTH.min}
    max={LEFT_WIDTH.max}
    label={m.editor_panel_resize_left()}
    onresize={(next) => layout.setWidth('left', next)}
  />
</aside>

{#if !open && !hidden}
  <!-- Con las dos pastillas en una ventana estrecha, cada una se queda con su mitad. -->
  <div
    class="absolute top-2 left-2 z-(--z-panel) max-w-[calc(50%-0.75rem)] touch-pan-x touch-pan-y rounded-panel border border-edge/40 bg-surface-2 text-ui shadow-float"
    data-testid="left-panel-pill"
  >
    {@render header(true)}
  </div>
{/if}
