<script lang="ts">
  import type { Engine } from '../../../engine/index.ts';
  import { getEditorLayout } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import Sheet from '../../../ui/Sheet.svelte';
  import AnimationsPanel from '../animations/AnimationsPanel.svelte';

  type Props = { open?: boolean; height?: number; engine: Engine };

  let { open = $bindable(false), height = $bindable(0), engine }: Props = $props();

  const layout = getEditorLayout();
</script>

<Sheet
  bind:open
  bind:height
  bind:level={() => layout.sheetLevels.animations ?? 0, (value) => (layout.sheetLevels.animations = value)}
  title={m.editor_mobile_animations()}
  heights={[0.6, 0.92]}
  modal={false}
  testid="animations-sheet"
>
  <AnimationsPanel {engine} density="touch" />
</Sheet>
