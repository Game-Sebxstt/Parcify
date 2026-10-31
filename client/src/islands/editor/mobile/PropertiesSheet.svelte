<script lang="ts">
  import type { Engine, FramePresetId, NodeRecord, Tool } from '../../../engine/index.ts';
  import { getEditorLayout } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import Sheet from '../../../ui/Sheet.svelte';
  import PropertiesPanel from '../properties/PropertiesPanel.svelte';

  type Props = {
    open?: boolean;
    // Alto de la hoja en pantalla, para que la cámara la evite.
    height?: number;
    engine: Engine;
    records: readonly NodeRecord[];
    readOnly: boolean;
    tool: Tool;
    preset: FramePresetId;
    pageName: string;
    onpreset: (preset: FramePresetId) => void;
    onexport: () => void;
    onkeyframes: () => void;
  };

  let { open = $bindable(false), height = $bindable(0), engine, records, readOnly, tool, preset, pageName, onpreset, onexport, onkeyframes }: Props = $props();

  const layout = getEditorLayout();
</script>

<Sheet
  bind:open
  bind:height
  bind:level={() => layout.sheetLevels.properties ?? 0, (value) => (layout.sheetLevels.properties = value)}
  title={m.editor_mobile_properties()}
  heights={[0.4, 0.9]}
  modal={false}
  testid="properties-sheet"
>
  <PropertiesPanel {engine} {records} {readOnly} {tool} {preset} {pageName} {onpreset} {onexport} {onkeyframes} density="touch" />
</Sheet>
