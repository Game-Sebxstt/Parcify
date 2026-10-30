<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Trash from '@lucide/svelte/icons/trash';
  import Upload from '@lucide/svelte/icons/upload';
  import X from '@lucide/svelte/icons/x';
  import { untrack } from 'svelte';
  import type { Engine } from '../../engine/index.ts';
  import { ApiError, apiFetch } from '../../lib/api.ts';
  import { assetUrl } from '../../lib/assets.ts';
  import { CANVAS_IMAGE_ACCEPT, downloadAsset, uploadGalleryImage } from '../../lib/canvas-images.ts';
  import { m } from '../../paraglide/messages.js';
  import { fetchAiJob, requestImages } from '../../lib/ai.ts';
  import { AI_IMAGE_ASPECTS, AI_IMAGE_LIMITS, type AiImageAspect } from '../../shared/api/ai.js';
  import { AssetListResponseSchema, type AssetDto } from '../../shared/api/assets.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Select from '../../ui/Select.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import ConfirmDialog from '../dashboard/ConfirmDialog.svelte';

  // `assetEvent` cambia con cada asset.ready o asset.deleted que llega del servidor.
  type Props = {
    engine: Engine;
    projectId: string;
    readOnly: boolean;
    assetEvent: { type: 'ready' | 'deleted'; assetId: string; n: number } | null;
    // Cambia con cada ai.job que llega del servidor (solo los trabajos propios).
    jobEvent: { jobId: string; status: string; n: number } | null;
    // Hay modelo de imágenes y permiso para usarlo.
    canGenerate: boolean;
    // «Enviar al chat de IA»; null si no hay chat de IA.
    onsendtochat: ((asset: { assetId: string; name: string }) => void) | null;
    onclose: () => void;
  };

  let { engine, projectId, readOnly, assetEvent, jobEvent, canGenerate, onsendtochat, onclose }: Props = $props();

  // Generaciones en curso de esta sesión; se consultan al llegar su ai.job y cada pocos segundos por si se pierde.
  const JOB_POLL_MS = 5_000;
  const COUNTS = Array.from({ length: AI_IMAGE_LIMITS.countMax }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  const ASPECTS = AI_IMAGE_ASPECTS.map((aspect) => ({ value: aspect, label: aspect }));
  let genPrompt = $state('');
  let genCount = $state(1);
  let genAspect = $state<AiImageAspect>('1:1');
  let submitting = $state(false);
  let jobs = $state.raw<Array<{ id: string; count: number }>>([]);
  const generating = $derived(jobs.reduce((sum, job) => sum + job.count, 0));

  async function generate() {
    const prompt = genPrompt.trim();
    if (!prompt || submitting) return;
    submitting = true;
    try {
      const id = await requestImages(projectId, { prompt, count: genCount, aspect: genAspect });
      jobs = [...jobs, { id, count: genCount }];
      genPrompt = '';
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 429)) {
        showToast({ message: error instanceof ApiError ? error.message : m.editor_gallery_generate_error(), tone: 'error' });
      }
    } finally {
      submitting = false;
    }
  }

  async function checkJob(id: string) {
    let job;
    try {
      job = await fetchAiJob(id);
    } catch (error) {
      // Caducado o perdido: se deja de seguir.
      if (error instanceof ApiError && error.status === 404) jobs = jobs.filter((item) => item.id !== id);
      return;
    }
    if (job.status !== 'done' && job.status !== 'failed') return;
    if (!jobs.some((item) => item.id === id)) return;
    jobs = jobs.filter((item) => item.id !== id);
    if (job.status === 'failed') {
      showToast({ message: job.error?.message ?? m.editor_gallery_generate_error(), tone: 'error' });
      return;
    }
    if (job.assetIds.length < job.count) showToast({ message: m.editor_gallery_generate_partial({ saved: job.assetIds.length, count: job.count }) });
    else showToast({ message: m.editor_gallery_generated() });
    void load();
  }

  $effect(() => {
    const event = jobEvent;
    if (!event) return;
    untrack(() => {
      if (jobs.some((job) => job.id === event.jobId)) void checkJob(event.jobId);
    });
  });

  $effect(() => {
    if (!jobs.length) return;
    const timer = setInterval(() => {
      for (const job of untrack(() => jobs)) void checkJob(job.id);
    }, JOB_POLL_MS);
    return () => clearInterval(timer);
  });

  function sendToChat(asset: AssetDto) {
    if (!onsendtochat) return;
    previewOpen = false;
    onsendtochat({ assetId: asset.id, name: nameOf(asset) });
  }

  const uid = $props.id();
  const PAGE_SIZE = 50;
  const MAX_UPLOADS = 10;

  let items = $state.raw<AssetDto[]>([]);
  let cursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingMore = $state(false);
  let uploading = $state(false);
  let thumbs = $state<Record<string, string | null>>({});
  let previews = $state<Record<string, string | null>>({});
  let previewing = $state<AssetDto | null>(null);
  let previewOpen = $state(false);
  let confirmOpen = $state(false);
  let deleting = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  const nameOf = (asset: AssetDto) => asset.name?.trim() || m.editor_gallery_untitled();

  async function load(more = false) {
    if (more) loadingMore = true;
    else status = 'loading';
    try {
      const after = more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await apiFetch(`/v1/projects/${projectId}/assets?limit=${PAGE_SIZE}${after}`, { schema: AssetListResponseSchema });
      items = more ? [...items, ...page.items.filter((item) => !items.some((known) => known.id === item.id))] : page.items;
      cursor = page.nextCursor;
      status = 'ready';
    } catch {
      if (!more) status = 'error';
      else showToast({ message: m.editor_gallery_load_error(), tone: 'error' });
    } finally {
      loadingMore = false;
    }
  }

  $effect(() => {
    void projectId;
    untrack(() => void load());
  });

  // Lo que suben o borran los demás aparece sin recargar el panel.
  $effect(() => {
    const event = assetEvent;
    if (!event) return;
    untrack(() => {
      if (event.type === 'deleted') {
        items = items.filter((item) => item.id !== event.assetId);
        if (previewing?.id === event.assetId) previewOpen = false;
      } else if (status === 'ready' && !items.some((item) => item.id === event.assetId)) {
        void load();
      }
    });
  });

  $effect(() => {
    for (const item of items) {
      if (item.id in untrack(() => thumbs)) continue;
      thumbs[item.id] = null;
      void assetUrl(item.id, 'thumb').then((url) => (thumbs[item.id] = url));
    }
  });

  function open(asset: AssetDto) {
    previewing = asset;
    previewOpen = true;
    if (!(asset.id in previews)) {
      previews[asset.id] = null;
      void assetUrl(asset.id, 'full').then((url) => (previews[asset.id] = url));
    }
  }

  async function onPicked(event: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(event.currentTarget.files ?? [])].slice(0, MAX_UPLOADS);
    event.currentTarget.value = '';
    if (!files.length) return;
    uploading = true;
    showToast({ message: m.editor_gallery_uploading() });
    for (const file of files) {
      try {
        const asset = await uploadGalleryImage(file, projectId);
        items = [asset, ...items.filter((item) => item.id !== asset.id)];
      } catch (error) {
        showToast({ message: error instanceof ApiError ? error.message : m.editor_image_upload_error(), tone: 'error' });
      }
    }
    uploading = false;
  }

  function insert(asset: AssetDto) {
    const id = engine.commands.insertImage({ assetId: asset.id, width: asset.width, height: asset.height }, engine.viewCenter());
    if (!id) return;
    previewOpen = false;
    showToast({ message: m.editor_gallery_inserted() });
  }

  async function download(asset: AssetDto) {
    try {
      await downloadAsset(asset.id);
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.editor_gallery_download_error(), tone: 'error' });
    }
  }

  async function remove() {
    const asset = previewing;
    if (!asset) return;
    deleting = true;
    try {
      await apiFetch(`/v1/assets/${asset.id}`, { method: 'DELETE' });
      items = items.filter((item) => item.id !== asset.id);
      engine.assetDeleted(asset.id);
      confirmOpen = false;
      previewOpen = false;
      showToast({ message: m.editor_gallery_deleted() });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.editor_gallery_delete_error(), tone: 'error' });
    } finally {
      deleting = false;
    }
  }
</script>

<aside aria-labelledby="{uid}-title" class="flex w-72 shrink-0 flex-col gap-3 overflow-hidden bg-surface-1 px-3 py-3 text-sm" data-testid="gallery-panel">
  <div class="flex items-center justify-between gap-2">
    <h2 id="{uid}-title" class="font-semibold">{m.editor_gallery_title()}</h2>
    <button
      type="button"
      aria-label={m.editor_gallery_close()}
      onclick={onclose}
      class="inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <X size={16} aria-hidden="true" />
    </button>
  </div>

  {#if !readOnly}
    <input bind:this={input} type="file" accept={CANVAS_IMAGE_ACCEPT} multiple class="hidden" tabindex="-1" aria-hidden="true" onchange={onPicked} data-testid="gallery-input" />
    <Button size="sm" loading={uploading} onclick={() => input?.click()}>
      <Upload size={14} aria-hidden="true" />
      {m.editor_gallery_upload()}
    </Button>
  {/if}

  {#if canGenerate}
    <form
      aria-labelledby="{uid}-gen-title"
      class="flex flex-col gap-2 rounded-panel bg-surface-2 p-2"
      onsubmit={(event) => {
        event.preventDefault();
        void generate();
      }}
      data-testid="gallery-generate"
    >
      <h3 id="{uid}-gen-title" class="text-xs font-semibold">{m.editor_gallery_generate_title()}</h3>
      <label for="{uid}-gen-prompt" class="sr-only">{m.editor_gallery_generate_prompt()}</label>
      <textarea
        id="{uid}-gen-prompt"
        bind:value={genPrompt}
        rows="2"
        maxlength={AI_IMAGE_LIMITS.promptMax}
        placeholder={m.editor_gallery_generate_placeholder()}
        onkeydown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void generate();
          }
        }}
        class="w-full resize-none rounded-[6px] bg-surface-1 px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-coral"
        data-testid="gallery-generate-prompt"
      ></textarea>
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1 text-xs text-ink-muted">
          <label for="{uid}-gen-count">{m.editor_gallery_generate_count()}</label>
          <Select
            id="{uid}-gen-count"
            items={COUNTS}
            bind:value={() => String(genCount), (next) => (genCount = Number(next))}
            label={m.editor_gallery_generate_count()}
            size="sm"
            class="h-7 bg-surface-1 tabular"
          />
        </div>
        <div class="flex items-center gap-1 text-xs text-ink-muted">
          <label for="{uid}-gen-aspect">{m.editor_gallery_generate_aspect()}</label>
          <Select
            id="{uid}-gen-aspect"
            items={ASPECTS}
            bind:value={() => genAspect, (next) => (genAspect = next as AiImageAspect)}
            label={m.editor_gallery_generate_aspect()}
            size="sm"
            class="h-7 bg-surface-1 tabular"
          />
        </div>
        <span class="flex-1"></span>
        <Button type="submit" size="sm" variant="primary" loading={submitting} disabled={!genPrompt.trim()} data-testid="gallery-generate-submit">
          <Sparkles size={14} aria-hidden="true" />
          {m.editor_gallery_generate_submit()}
        </Button>
      </div>
      <p role="status" class={generating ? 'text-xs text-ink-muted' : 'sr-only'}>
        {generating ? m.editor_gallery_generating({ count: generating }) : ''}
      </p>
    </form>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if status === 'loading'}
      <ul class="grid grid-cols-3 gap-2" aria-hidden="true">
        {#each [0, 1, 2, 3, 4, 5] as slot (slot)}
          <li class="aspect-square animate-pulse rounded-[6px] bg-surface-2"></li>
        {/each}
      </ul>
    {:else if status === 'error'}
      <div class="flex flex-col items-start gap-2" role="alert">
        <p class="text-ink-muted">{m.editor_gallery_load_error()}</p>
        <Button size="sm" variant="ghost" onclick={() => void load()}>{m.editor_gallery_retry()}</Button>
      </div>
    {:else if !items.length}
      <p class="text-ink-muted">{m.editor_gallery_empty()}</p>
    {:else}
      <ul class="grid grid-cols-3 gap-2" aria-labelledby="{uid}-title">
        {#each items as item (item.id)}
          <li>
            <button
              type="button"
              aria-label={m.editor_gallery_open({ name: nameOf(item) })}
              onclick={() => open(item)}
              class="relative block aspect-square w-full cursor-pointer overflow-hidden rounded-[6px] bg-surface-2 hover:ring-2 hover:ring-edge"
              data-testid="gallery-item"
            >
              {#if thumbs[item.id]}
                <img src={thumbs[item.id]} alt="" class="size-full object-cover" loading="lazy" decoding="async" />
              {/if}
              {#if item.source === 'ai'}
                <span class="absolute top-1 left-1 rounded-full bg-ground/80 px-1.5 text-[10px] font-semibold text-ink">{m.editor_gallery_ai_badge()}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if cursor}
        <div class="mt-3 flex justify-center">
          <Button size="sm" variant="ghost" loading={loadingMore} onclick={() => void load(true)}>{m.editor_gallery_more()}</Button>
        </div>
      {/if}
    {/if}
  </div>
</aside>

<Dialog bind:open={previewOpen} title={previewing ? nameOf(previewing) : ''} size="lg">
  {#if previewing}
    <div class="flex flex-col gap-4">
      <div class="grid max-h-[60dvh] min-h-48 place-items-center overflow-hidden rounded-[6px] bg-ground">
        {#if previews[previewing.id]}
          <img src={previews[previewing.id]} alt={nameOf(previewing)} class="max-h-[60dvh] max-w-full object-contain" data-testid="gallery-preview" />
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if previewing.width && previewing.height}
          <p class="mr-auto text-xs text-ink-muted tabular">{m.editor_gallery_size({ w: previewing.width, h: previewing.height })}</p>
        {:else}
          <span class="mr-auto"></span>
        {/if}
        {#if !readOnly}
          <Button size="sm" variant="danger-ghost" onclick={() => (confirmOpen = true)}>
            <Trash size={14} aria-hidden="true" />
            {m.editor_gallery_delete()}
          </Button>
        {/if}
        {#if onsendtochat}
          <Button size="sm" variant="ghost" onclick={() => sendToChat(previewing!)} data-testid="gallery-send-chat">
            <MessageSquare size={14} aria-hidden="true" />
            {m.editor_gallery_send_chat()}
          </Button>
        {/if}
        <Button size="sm" variant="ghost" onclick={() => void download(previewing!)}>
          <Download size={14} aria-hidden="true" />
          {m.editor_gallery_download()}
        </Button>
        {#if !readOnly}
          <Button size="sm" variant="secondary" onclick={() => insert(previewing!)}>
            <ImagePlus size={14} aria-hidden="true" />
            {m.editor_gallery_insert()}
          </Button>
        {/if}
      </div>
    </div>
  {/if}
</Dialog>

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.editor_gallery_delete_title({ name: previewing ? nameOf(previewing) : '' })}
  description={m.editor_gallery_delete_body()}
  confirmLabel={m.editor_gallery_delete()}
  danger
  busy={deleting}
  onconfirm={() => void remove()}
/>
