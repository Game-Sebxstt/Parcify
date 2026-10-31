<script lang="ts">
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Upload from '@lucide/svelte/icons/upload';
  import type { Engine } from '../../../engine/index.ts';
  import { getEditorLayout } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import Sheet from '../../../ui/Sheet.svelte';
  import GalleryPanel from '../GalleryPanel.svelte';

  type Props = {
    open?: boolean;
    height?: number;
    engine: Engine;
    projectId: string;
    readOnly: boolean;
    assetEvent: { type: 'ready' | 'deleted'; assetId: string; n: number } | null;
    jobEvent: { jobId: string; status: string; n: number } | null;
    canGenerate: boolean;
    onsendtochat: ((asset: { assetId: string; name: string }) => void) | null;
  };

  let { open = $bindable(false), height = $bindable(0), engine, projectId, readOnly, assetEvent, jobEvent, canGenerate, onsendtochat }: Props = $props();

  const layout = getEditorLayout();
  let panel = $state<ReturnType<typeof GalleryPanel> | null>(null);
  let generateOpen = $state(false);

  const HEAD_BUTTON =
    'inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-card px-3 text-sm font-semibold transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral';
</script>

{#snippet actions()}
  {#if !readOnly}
    <button type="button" onclick={() => panel?.pickFiles()} class={[HEAD_BUTTON, 'text-ink hover:bg-surface-2']} data-testid="gallery-sheet-upload">
      <Upload size={20} aria-hidden="true" />
      {m.editor_gallery_upload()}
    </button>
  {/if}
  {#if canGenerate}
    <button
      type="button"
      aria-pressed={generateOpen}
      onclick={() => (generateOpen = !generateOpen)}
      class={[HEAD_BUTTON, generateOpen ? 'bg-petrol text-ink' : 'text-ink hover:bg-surface-2']}
      data-testid="gallery-sheet-generate"
    >
      <Sparkles size={20} aria-hidden="true" />
      {m.editor_gallery_generate()}
    </button>
  {/if}
{/snippet}

<!-- Al insertar, la hoja baja a su altura menor para que se vea lo insertado en el centro de la vista. -->
<Sheet
  bind:open
  bind:height
  bind:level={() => layout.sheetLevels.gallery ?? 0, (value) => (layout.sheetLevels.gallery = value)}
  title={m.editor_gallery_title()}
  heights={[0.6, 0.92]}
  modal={false}
  {actions}
  testid="gallery-sheet"
>
  <GalleryPanel
    bind:this={panel}
    bind:generateOpen
    {engine}
    {projectId}
    {readOnly}
    {assetEvent}
    {jobEvent}
    {canGenerate}
    {onsendtochat}
    sheet
    oninserted={() => (layout.sheetLevels.gallery = 0)}
  />
</Sheet>
