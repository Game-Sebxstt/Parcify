<script lang="ts">
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import type { Engine } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import Sheet from '../../../ui/Sheet.svelte';
  import type TimelinePanel from '../timeline/TimelinePanel.svelte';

  // El estado es el mismo que el del panel del escritorio (EditorLayout.timeline): montar esta hoja o el panel al
  // cruzar los 640 px no abre, no cierra ni cambia Grabar. Cerrar la hoja (× o deslizar) cierra la línea de tiempo.
  type Props = {
    open?: boolean;
    height?: number;
    // La línea de tiempo se descarga aparte: el editor la pasa ya cargada.
    Timeline: typeof TimelinePanel;
    engine: Engine;
    projectId: string;
    readOnly: boolean;
    aiAnimation: boolean;
    focusRequest: number;
    // Con selección editable: abre Propiedades encima de esta hoja sin cerrar la línea de tiempo, para cambiar un valor
    // en el cabezal y que se grabe. Al cerrar Propiedades vuelve esta hoja.
    onproperties?: (() => void) | null;
  };

  let {
    open = $bindable(false),
    height = $bindable(0),
    Timeline,
    engine,
    projectId,
    readOnly,
    aiAnimation,
    focusRequest,
    onproperties = null,
  }: Props = $props();
</script>

{#snippet actions()}
  {#if onproperties}
    <button
      type="button"
      onclick={() => onproperties?.()}
      class="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-card px-3 text-sm font-semibold text-ink transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral"
      data-testid="timeline-sheet-properties"
    >
      <SlidersHorizontal size={20} aria-hidden="true" />
      {m.editor_mobile_properties()}
    </button>
  {/if}
{/snippet}

<Sheet bind:open bind:height title={m.timeline_label()} heights={[0.55]} modal={false} {actions} testid="timeline-sheet">
  <Timeline {engine} {projectId} {readOnly} {aiAnimation} open={true} touch {focusRequest} sheet onclose={() => (open = false)} />
</Sheet>
