<script lang="ts">
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus';
  import Eye from '@lucide/svelte/icons/eye';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { untrack } from 'svelte';
  import { ApiError } from '../../lib/api.ts';
  import { formatDate } from '../../lib/format.ts';
  import { createVersion, listVersions } from '../../lib/versions.ts';
  import { m } from '../../paraglide/messages.js';
  import type { VersionDto } from '../../shared/api/versions.js';
  import Button from '../../ui/Button.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import Tooltip from '../../ui/Tooltip.svelte';
  import NameDialog from '../dashboard/NameDialog.svelte';
  import { getVersionViewer, versionLabel } from './versions/version-viewer.svelte.ts';
  import VersionThumb from './VersionThumb.svelte';

  type Props = {
    projectId: string;
    open: boolean;
    canEdit: boolean;
    // Página activa del editor: las miniaturas la pintan si la versión la tiene.
    activePage: string | null;
    onclose: () => void;
  };

  let { projectId, open, canEdit, activePage, onclose }: Props = $props();

  // La vista previa y la confirmación de Restaurar viven en el editor: sobreviven a que se desmonte este panel.
  const viewer = getVersionViewer();

  const uid = $props.id();
  // Un 409 DOCUMENT_RELOADED se reintenta una vez cuando el documento ya se recargó.
  const RELOADED_RETRY_MS = 1_000;

  let versions = $state.raw<VersionDto[]>([]);
  let cursor = $state<string | null>(null);
  let phase = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let loadingMore = $state(false);
  let saving = $state(false);
  let nameOpen = $state(false);

  // Se recarga cada vez que se abre y tras cada restauración: otras personas también crean y restauran versiones.
  $effect(() => {
    void viewer.restored;
    if (open) untrack(() => void load());
  });

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

  // Con una vista previa abierta, el primer Esc la cierra; el siguiente vuelve a Diseño.
  function onPanelKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (viewer.viewing) {
      event.preventDefault();
      viewer.close(true);
      return;
    }
    onclose();
  }
</script>

<!-- Vista «Versiones» del panel derecho; «←» y Esc vuelven a Diseño. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  hidden={!open}
  aria-labelledby="{uid}-title"
  onkeydown={onPanelKey}
  class="flex min-h-0 w-full flex-1 flex-col overflow-hidden text-sm"
  data-testid="versions-panel"
>
  <div class="flex h-10 shrink-0 items-center gap-1 px-2">
    <Tooltip text={m.editor_versions_back()} side="bottom">
      {#snippet children(props)}
        <button
          {...props}
          type="button"
          aria-label={m.editor_versions_back()}
          onclick={onclose}
          class="inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-petrol hover:text-ink"
          data-testid="versions-back"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
    <h2 id="{uid}-title" class="text-ui font-semibold">{m.editor_versions_title()}</h2>
  </div>

  {#if canEdit}
    <div class="px-3 pb-3">
      <Button variant="secondary" size="sm" class="w-full" loading={saving} onclick={() => (nameOpen = true)}>
        <BookmarkPlus size={14} aria-hidden="true" />
        {m.editor_versions_create_named()}
      </Button>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-3" data-thumb-root>
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
          {@const label = versionLabel(version)}
          {@const viewing = viewer.viewing?.id === version.id}
          <li
            class="group relative py-1.5 pr-1 pl-3"
            aria-current={viewing ? 'true' : undefined}
            data-testid="version-item"
            data-version-id={version.id}
          >
            <span
              aria-hidden="true"
              class={[
                'absolute top-4 -left-[5px] size-2.5 rounded-full ring-2 ring-surface-1',
                version.kind === 'manual' ? 'bg-coral' : version.kind === 'restore_point' ? 'bg-sage' : 'bg-ink-muted',
              ].join(' ')}
            ></span>
            <div
              class={[
                'rounded-panel px-2 py-1.5 group-hover:bg-surface-2 group-focus-within:bg-surface-2',
                viewing ? 'bg-surface-2 ring-1 ring-coral/60' : '',
              ]}
            >
              <div class="flex items-center gap-2">
                <VersionThumb {version} pageId={activePage} />
                <div class="min-w-0 flex-1">
                  <p class={['truncate', version.kind === 'manual' ? 'font-semibold' : 'text-ink-muted'].join(' ')}>{label}</p>
                  <p class="truncate text-xs text-ink-muted">
                    <time datetime={version.createdAt}>{formatDate(version.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                    {#if version.createdBy?.name}
                      · {version.createdBy.name}
                    {/if}
                  </p>
                </div>
              </div>
              <div class="mt-1 flex gap-1">
                <button
                  type="button"
                  aria-label={m.editor_versions_preview_of({ name: label })}
                  onclick={() => viewer.open(version)}
                  class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap text-ink-muted hover:bg-petrol hover:text-ink"
                >
                  <Eye size={13} aria-hidden="true" />
                  {m.editor_versions_preview()}
                </button>
                {#if canEdit}
                  <button
                    type="button"
                    aria-label={m.editor_versions_restore_of({ name: label })}
                    onclick={() => viewer.askRestore(version)}
                    class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap text-ink-muted hover:bg-petrol hover:text-ink"
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
</section>

<NameDialog
  bind:open={nameOpen}
  title={m.editor_versions_create_named()}
  label={m.editor_versions_name_label()}
  submitLabel={m.editor_versions_create()}
  primary
  onsubmit={(name) => create(name)}
/>
