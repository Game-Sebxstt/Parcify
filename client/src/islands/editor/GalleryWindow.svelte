<script lang="ts">
  import Images from '@lucide/svelte/icons/images';
  import type { Engine } from '../../engine/index.ts';
  import { getEditorLayout } from '../../lib/editor-layout.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import FloatingWindow from '../../ui/FloatingWindow.svelte';
  import type { WindowRect } from '../../ui/floating-window.svelte.ts';
  import GalleryPanel from './GalleryPanel.svelte';

  type Props = {
    engine: Engine;
    projectId: string;
    readOnly: boolean;
    assetEvent: { type: 'ready' | 'deleted'; assetId: string; n: number } | null;
    jobEvent: { jobId: string; status: string; n: number } | null;
    canGenerate: boolean;
    onsendtochat: ((asset: { assetId: string; name: string }) => void) | null;
    hidden: boolean;
    defaultRect: () => WindowRect;
    returnFocus: () => HTMLElement | null;
  };

  let { engine, projectId, readOnly, assetEvent, jobEvent, canGenerate, onsendtochat, hidden, defaultRect, returnFocus }: Props = $props();

  const layout = getEditorLayout();
  let floating = $state<ReturnType<typeof FloatingWindow> | null>(null);

  export function focus() {
    return floating?.focus();
  }
</script>

<FloatingWindow
  bind:this={floating}
  bind:rect={layout.gallery.rect}
  title={m.editor_gallery_title()}
  open={layout.gallery.open}
  minimizable={false}
  {hidden}
  {defaultRect}
  minSize={{ w: 300, h: 360 }}
  icon={Images}
  closeLabel={m.editor_gallery_close()}
  testid="gallery-window"
  onclose={() => (layout.gallery.open = false)}
  {returnFocus}
>
  <GalleryPanel {engine} {projectId} {readOnly} {assetEvent} {jobEvent} {canGenerate} {onsendtochat} />
</FloatingWindow>
