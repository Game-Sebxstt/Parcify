<script lang="ts">
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus';
  import Eye from '@lucide/svelte/icons/eye';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import { tick, untrack } from 'svelte';
  import type { EngineUser } from '../../engine/index.ts';
  import { ApiError } from '../../lib/api.ts';
  import { canvasAssets } from '../../lib/canvas-images.ts';
  import { formatDate } from '../../lib/format.ts';
  import { createVersion, fetchVersionState, listVersions, restoreVersion } from '../../lib/versions.ts';
  import { m } from '../../paraglide/messages.js';
  import type { VersionDto } from '../../shared/api/versions.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import ConfirmDialog from '../dashboard/ConfirmDialog.svelte';
  import NameDialog from '../dashboard/NameDialog.svelte';
  import type { VersionPreview } from './version-preview.ts';

  type Props = {
    projectId: string;
    open: boolean;
    canEdit: boolean;
    user: EngineUser;
    onclose: () => void;
  };

  let { projectId, open, canEdit, user, onclose }: Props = $props();

  const uid = $props.id();
  // Un 409 DOCUMENT_RELOADED se reintenta una vez cuando el documento ya se recargó.
  const RELOADED_RETRY_MS = 1_000;

  let versions = $state.raw<VersionDto[]>([]);
  let cursor = $state<string | null>(null);
  let phase = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let loadingMore = $state(false);
  let saving = $state(false);
  let nameOpen = $state(false);
  let restoring = $state<VersionDto | null>(null);
  let confirmOpen = $state(false);
  let restoreBusy = $state(false);
  let previewing = $state<VersionDto | null>(null);
  let previewOpen = $state(false);
  let previewPhase = $state<'loading' | 'ready' | 'error'>('loading');
  let previewContainer = $state<HTMLDivElement | null>(null);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let preview: VersionPreview | null = null;
  let previewRun = 0;

  // Se recarga cada vez que se abre: otras personas también crean y restauran versiones.
  $effect(() => {
    if (open) untrack(() => void load());
  });

  $effect(() => {
    if (!previewOpen) untrack(closePreview);
  });

  $effect(() => () => closePreview());

  function labelOf(version: VersionDto): string {
    if (version.name) return version.name;
    if (version.kind === 'auto') return m.editor_versions_kind_auto();
    if (version.kind === 'restore_point') return m.editor_versions_kind_restore_point();
    return m.editor_versions_kind_manual();
  }

  async function load() {
    phase = versions.length ? phase : 'loading';
    try {
      const page = await listVersions(projectId);
      versions = page.items;
      cursor = page.nextCursor;
      phase = 'ready';
    } catch {
      if (!versions.length) phase = 'error';
    }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await listVersions(projectId, cursor);
      const known = new Set(versions.map((version) => version.id));
      versions = [...versions, ...page.items.filter((version) => !known.has(version.id))];
      cursor = page.nextCursor;
    } catch {
      showToast({ message: m.editor_versions_load_error(), tone: 'error' });
    } finally {
      loadingMore = false;
    }
  }

  async function create(name?: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        const version = await createVersion(projectId, name);
        versions = [version, ...versions.filter((item) => item.id !== version.id)];
        if (phase !== 'ready') phase = 'ready';
        showToast({ message: m.editor_versions_created() });
        return null;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'DOCUMENT_RELOADED' && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RELOADED_RETRY_MS));
          continue;
        }
        return error instanceof ApiError ? error.message : m.editor_versions_create_error();
      }
    }
  }

  // Ctrl+S: versión sin nombre.
  export async function saveVersion() {
    if (!canEdit || saving) return;
    saving = true;
    const error = await create();
    saving = false;
    if (error) showToast({ message: error, tone: 'error' });
  }

  function askRestore(version: VersionDto) {
    restoring = version;
    confirmOpen = true;
  }

  async function restore() {
    const version = restoring;
    if (!version) return;
    restoreBusy = true;
    try {
      await restoreVersion(projectId, version.id);
      confirmOpen = false;
      previewOpen = false;
      showToast({ message: m.editor_versions_restored() });
      void load();
    } catch (error) {
      const message =
        error instanceof ApiError && error.code !== 'COLLAB_UNAVAILABLE' && error.code !== 'INTERNAL'
          ? error.message
          : m.editor_versions_restore_error();
      showToast({ message, tone: 'error' });
    } finally {
      restoreBusy = false;
    }
  }

  async function openPreview(version: VersionDto) {
    closePreview();
    const run = ++previewRun;
    previewing = version;
    previewPhase = 'loading';
    previewOpen = true;
    try {
      const [state, module] = await Promise.all([fetchVersionState(projectId, version.id), import('./version-preview.ts')]);
      await tick();
      if (run !== previewRun || !previewCanvas || !previewContainer) return;
      const mounted = await module.mountVersionPreview({
        canvas: previewCanvas,
        container: previewContainer,
        state,
        user,
        assets: canvasAssets,
        label: m.editor_text_label(),
      });
      if (run !== previewRun) {
        mounted.destroy();
        return;
      }
      preview = mounted;
      previewPhase = 'ready';
    } catch {
      if (run === previewRun) previewPhase = 'error';
    }
  }

  // Dos diálogos apilados no se pueden usar: la confirmación sustituye a la vista previa.
  function restoreFromPreview() {
    const version = previewing;
    if (!version) return;
    previewOpen = false;
    askRestore(version);
  }

  function closePreview() {
    previewRun++;
    preview?.destroy();
    preview = null;
  }

  function onPanelKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented) onclose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  hidden={!open}
  aria-labelledby="{uid}-title"
  onkeydown={onPanelKey}
  class="flex w-80 shrink-0 flex-col overflow-hidden bg-surface-1 text-sm"
  data-testid="versions-panel"
>
  <div class="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
    <h2 id="{uid}-title" class="font-semibold">{m.editor_versions_title()}</h2>
    <button
      type="button"
      aria-label={m.editor_versions_close()}
      onclick={onclose}
      class="inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <X size={16} aria-hidden="true" />
    </button>
  </div>

  {#if canEdit}
    <div class="px-3 pb-3">
      <Button variant="secondary" size="sm" class="w-full" loading={saving} onclick={() => (nameOpen = true)}>
        <BookmarkPlus size={14} aria-hidden="true" />
        {m.editor_versions_create_named()}
      </Button>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
    {#if phase === 'loading' || phase === 'idle'}
      <p class="px-2 py-4 text-ink-muted" role="status">{m.editor_versions_loading()}</p>
    {:else if phase === 'error'}
      <div class="flex flex-col items-start gap-2 px-2 py-4" role="alert">
        <p class="text-ink-muted">{m.editor_versions_load_error()}</p>
        <button type="button" class="cursor-pointer font-semibold text-coral hover:underline" onclick={() => void load()}>
          {m.common_retry()}
        </button>
      </div>
    {:else if versions.length === 0}
      <p class="px-2 py-4 text-ink-muted">{m.editor_versions_empty()}</p>
    {:else}
      <!-- Línea de tiempo: de la más reciente a la más antigua. -->
      <ol aria-labelledby="{uid}-title" class="relative ml-3 border-l border-petrol">
        {#each versions as version (version.id)}
          {@const label = labelOf(version)}
          <li class="group relative py-1.5 pr-1 pl-3" data-testid="version-item" data-version-id={version.id}>
            <span
              aria-hidden="true"
              class={[
                'absolute top-4 -left-[5px] size-2.5 rounded-full ring-2 ring-surface-1',
                version.kind === 'manual' ? 'bg-coral' : version.kind === 'restore_point' ? 'bg-sage' : 'bg-ink-muted',
              ].join(' ')}
            ></span>
            <div class="rounded-panel px-2 py-1.5 group-hover:bg-surface-2 group-focus-within:bg-surface-2">
              <p class={['truncate', version.kind === 'manual' ? 'font-semibold' : 'text-ink-muted'].join(' ')}>{label}</p>
              <p class="truncate text-xs text-ink-muted">
                <time datetime={version.createdAt}>{formatDate(version.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                {#if version.createdBy?.name}
                  · {version.createdBy.name}
                {/if}
              </p>
              <div class="mt-1 flex gap-1">
                <button
                  type="button"
                  aria-label={m.editor_versions_preview_of({ name: label })}
                  onclick={() => void openPreview(version)}
                  class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-ink-muted hover:bg-petrol hover:text-ink"
                >
                  <Eye size={13} aria-hidden="true" />
                  {m.editor_versions_preview()}
                </button>
                {#if canEdit}
                  <button
                    type="button"
                    aria-label={m.editor_versions_restore_of({ name: label })}
                    onclick={() => askRestore(version)}
                    class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-ink-muted hover:bg-petrol hover:text-ink"
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    {m.editor_versions_restore()}
                  </button>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ol>
      {#if cursor}
        <div class="flex justify-center pt-2">
          <button
            type="button"
            disabled={loadingMore}
            onclick={() => void loadMore()}
            class="h-7 cursor-pointer rounded-full px-3 text-xs font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink disabled:cursor-wait"
          >
            {loadingMore ? m.editor_versions_loading() : m.editor_versions_more()}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</aside>

<NameDialog
  bind:open={nameOpen}
  title={m.editor_versions_create_named()}
  label={m.editor_versions_name_label()}
  submitLabel={m.editor_versions_create()}
  primary
  onsubmit={(name) => create(name)}
/>

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.editor_versions_restore_title()}
  description={m.editor_versions_restore_body()}
  confirmLabel={m.editor_versions_restore()}
  busy={restoreBusy}
  onconfirm={() => void restore()}
/>

<Dialog bind:open={previewOpen} title={previewing ? labelOf(previewing) : m.editor_versions_preview_title()} size="lg">
  <div class="flex flex-col gap-4">
    <div class="relative h-[min(60dvh,32rem)] overflow-hidden rounded-panel bg-ground">
      <div
        bind:this={previewContainer}
        role="img"
        aria-label={m.editor_versions_preview_canvas()}
        class="absolute inset-0"
        data-testid="version-preview"
        data-state={previewPhase}
      >
        <canvas bind:this={previewCanvas} class="block h-full w-full"></canvas>
      </div>
      {#if previewPhase !== 'ready'}
        <p class="absolute inset-0 grid place-items-center text-ink-muted" role={previewPhase === 'error' ? 'alert' : 'status'}>
          {previewPhase === 'error' ? m.editor_versions_preview_error() : m.editor_versions_preview_loading()}
        </p>
      {/if}
    </div>
    {#if previewing}
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-ink-muted">
          <time datetime={previewing.createdAt}>{formatDate(previewing.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          · {m.editor_versions_nodes({ count: previewing.nodeCount })}
        </p>
        {#if canEdit}
          <Button variant="primary" size="sm" onclick={() => restoreFromPreview()}>
            <RotateCcw size={14} aria-hidden="true" />
            {m.editor_versions_restore()}
          </Button>
        {/if}
      </div>
    {/if}
  </div>
</Dialog>
