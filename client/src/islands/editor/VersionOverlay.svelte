<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import { formatDate } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Select from '../../ui/Select.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import { getVersionViewer, versionLabel } from './versions/version-viewer.svelte.ts';

  type Props = {
    canEdit: boolean;
    // Bordes en px desde la ventana: entre los paneles abiertos, sin tapar sus pastillas.
    left: number;
    right: number;
    top: number;
    // Lo que flota encima de la barra en sus esquinas (pastillas de los paneles plegados): ancho a cada lado y alto.
    pills: { left: number; right: number; height: number };
    // Móvil: ocupa toda la pantalla.
    fullscreen: boolean;
  };

  let { canEdit, left, right, top, pills, fullscreen }: Props = $props();

  const BAR_HEIGHT = 48;
  const PILL_GAP = 8;
  const bar = $derived(
    fullscreen
      ? { left: 12, right: 8, height: BAR_HEIGHT }
      : {
          left: pills.left ? pills.left + PILL_GAP : 12,
          right: pills.right ? pills.right + PILL_GAP : 8,
          height: Math.max(BAR_HEIGHT, pills.height ? pills.height + PILL_GAP : 0),
        },
  );

  const viewer = getVersionViewer();

  const version = $derived(viewer.viewing);
  const label = $derived(version ? versionLabel(version) : '');
  const pageItems = $derived(viewer.pages.map((page) => ({ value: page.id, label: page.name })));
  const errorText = $derived(
    viewer.failure === 'canvas'
      ? m.editor_versions_canvas_error()
      : viewer.failure === 'load'
        ? m.editor_versions_state_error()
        : m.editor_versions_preview_error(),
  );

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    viewer.close(true);
  }
</script>

{#if version}
  <!-- Superposición no modal: el panel de versiones sigue al alcance para elegir otra. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    data-own-stage=""
    aria-label={m.editor_versions_overlay_label({ name: label })}
    onkeydown={onKey}
    class={[
      'z-(--z-stage) flex flex-col overflow-hidden bg-surface-1 text-ui text-ink',
      fullscreen ? 'fixed inset-0 pt-[env(safe-area-inset-top)]' : 'absolute bottom-2 rounded-panel border border-edge/40 shadow-float',
    ]}
    style:left={fullscreen ? null : `${left}px`}
    style:right={fullscreen ? null : `${right}px`}
    style:top={fullscreen ? null : `${top}px`}
    data-testid="version-overlay"
  >
    <div
      class="flex shrink-0 items-center gap-2 border-b border-edge/25"
      style:height="{bar.height}px"
      style:padding-left="{bar.left}px"
      style:padding-right="{bar.right}px"
      data-testid="version-overlay-bar"
    >
      <Eye size={16} aria-hidden="true" class="shrink-0 text-ink-muted" />
      <h2 class="min-w-0 flex-1 truncate">
        <span class="text-ink-muted">{m.editor_versions_viewing()}</span>
        <span class="font-semibold">{label}</span>
        <span class="text-ink-muted">
          · <time datetime={version.createdAt}>{formatDate(version.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </span>
      </h2>
      {#if viewer.status === 'ready' && pageItems.length > 0}
        <Select
          items={pageItems}
          value={viewer.pageId ?? ''}
          label={m.editor_versions_page_label()}
          disabled={pageItems.length < 2}
          class="max-w-48"
          testid="version-page"
          onValueChange={(id) => viewer.setPage(id)}
        />
      {/if}
      {#if canEdit}
        <Button variant="primary" size="sm" onclick={() => viewer.askRestore(version)}>
          <RotateCcw size={14} aria-hidden="true" />
          {m.editor_versions_restore()}
        </Button>
      {/if}
      <Tooltip text={m.editor_versions_close_preview()} kbd="Esc" side="bottom">
        {#snippet children(props)}
          <button
            {...props}
            type="button"
            aria-label={m.editor_versions_close_preview()}
            aria-keyshortcuts="Escape"
            onclick={() => viewer.close(true)}
            class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink pointer-coarse:size-11"
            data-testid="version-overlay-close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
    </div>
    <div class="relative min-h-0 flex-1 bg-ground">
      <!-- El motor de la vista previa crea y quita aquí su propio canvas. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        {@attach (node) => viewer.attach(node)}
        tabindex="0"
        role="application"
        aria-label={m.editor_versions_preview_canvas()}
        class="absolute inset-0 touch-none overflow-hidden outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral"
        data-testid="version-preview"
        data-state={viewer.status}
        data-version-id={version.id}
      ></div>
      {#if viewer.status === 'loading'}
        <p class="pointer-events-none absolute inset-0 grid place-items-center text-ink-muted" role="status">{m.editor_versions_preview_loading()}</p>
      {:else if viewer.status === 'error'}
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ground px-6 text-center" role="alert">
          <p class="max-w-96 text-ink-muted">{errorText}</p>
          <Button variant="secondary" size="sm" onclick={() => viewer.retry()}>{m.common_retry()}</Button>
        </div>
      {/if}
    </div>
  </section>
{/if}
