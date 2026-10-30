<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import type { Engine } from '../../../engine/index.ts';
  import { getEditorLayout, LEFT_WIDTH } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import Tabs from '../../../ui/Tabs.svelte';
  import AnimationsPanel from '../animations/AnimationsPanel.svelte';
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
    // Vista previa de versiones abierta: la pastilla queda por encima de la superposición.
    raised?: boolean;
    // Tamaño de la pastilla plegada en pantalla (0 sin pastilla).
    pillWidth?: number;
    pillHeight?: number;
  };

  let {
    engine,
    readOnly,
    open,
    header,
    hidden,
    width = $bindable(0),
    clearance = 0,
    raised = false,
    pillWidth = $bindable(0),
    pillHeight = $bindable(0),
  }: Props = $props();

  const layout = getEditorLayout();
  let layers = $state<ReturnType<typeof LayersPanel> | null>(null);

  // «Renombrar» desde el lienzo: con el panel plegado, primero se abre, y la pestaña pasa a Capas.
  export async function rename(id: string) {
    if (!open) layout.open('left');
    if (layout.leftTab !== 'layers') {
      layout.leftTab = 'layers';
      await tick();
    }
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
      {@const current = engine}
      <PagesPanel engine={current} {readOnly} />
      {#snippet layersTab()}
        <LayersPanel bind:this={layers} engine={current} {readOnly} titled={false} />
      {/snippet}
      {#snippet animationsTab()}
        <AnimationsPanel engine={current} />
      {/snippet}
      <Tabs
        value={layout.leftTab}
        onValueChange={(next) => (layout.leftTab = next === 'animations' ? 'animations' : 'layers')}
        label={m.editor_left_tabs()}
        size="sm"
        class="flex min-h-0 flex-1 flex-col"
        contentClass="min-h-0 flex-1 flex-col data-[state=active]:flex"
        contentTabindex={-1}
        items={[
          { value: 'layers', label: m.editor_layers_label(), content: layersTab },
          { value: 'animations', label: m.editor_tab_animations(), content: animationsTab },
        ]}
      />
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
    bind:offsetWidth={pillWidth}
    bind:offsetHeight={pillHeight}
    class={[
      'absolute top-2 left-2 max-w-[calc(50%-0.75rem)] touch-pan-x touch-pan-y rounded-panel border border-edge/40 bg-surface-2 text-ui shadow-float',
      raised ? 'z-(--z-stage-pill)' : 'z-(--z-panel)',
    ]}
    data-testid="left-panel-pill"
  >
    {@render header(true)}
  </div>
{/if}
