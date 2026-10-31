<script lang="ts">
  import type { Engine } from '../../../engine/index.ts';
  import { getEditorLayout } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import Sheet from '../../../ui/Sheet.svelte';
  import LayersPanel from '../LayersPanel.svelte';
  import PagesPanel from '../PagesPanel.svelte';

  type Props = {
    open?: boolean;
    height?: number;
    engine: Engine;
    readOnly: boolean;
    // «Renombrar» de la pulsación larga en una capa: la hoja «Renombrar» del editor.
    onrename: (id: string) => void;
  };

  let { open = $bindable(false), height = $bindable(0), engine, readOnly, onrename }: Props = $props();

  const layout = getEditorLayout();
</script>

<Sheet
  bind:open
  bind:height
  bind:level={() => layout.sheetLevels.layers ?? 0, (value) => (layout.sheetLevels.layers = value)}
  title={m.editor_mobile_layers()}
  heights={[0.6, 0.92]}
  modal={false}
  testid="layers-sheet"
>
  <PagesPanel {engine} {readOnly} density="touch" />
  <LayersPanel {engine} {readOnly} density="touch" {onrename} />
</Sheet>
