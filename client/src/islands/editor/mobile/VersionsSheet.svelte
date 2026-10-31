<script lang="ts">
  import { getEditorLayout } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import Sheet from '../../../ui/Sheet.svelte';
  import VersionsPanel from '../VersionsPanel.svelte';

  // Mientras se ve una versión, el editor cierra esta hoja; al cerrar la vista previa vuelve con la altura que tenía.
  type Props = {
    open?: boolean;
    height?: number;
    projectId: string;
    canEdit: boolean;
    activePage: string | null;
  };

  let { open = $bindable(false), height = $bindable(0), projectId, canEdit, activePage }: Props = $props();

  const layout = getEditorLayout();
</script>

<Sheet
  bind:open
  bind:height
  bind:level={() => layout.sheetLevels.versions ?? 0, (value) => (layout.sheetLevels.versions = value)}
  title={m.editor_versions_title()}
  heights={[0.6, 0.92]}
  modal={false}
  testid="versions-sheet"
>
  <VersionsPanel {projectId} open={true} {canEdit} {activePage} sheet onclose={() => (open = false)} />
</Sheet>
