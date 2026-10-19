<script lang="ts">
  import type { Engine } from '../../engine/index.ts';
  import {
    EXPORT_SCALES,
    collectScene,
    exportFileName,
    planExport,
    renderRaster,
    type ExportFormat,
    type ExportScene,
    type ExportTarget,
  } from '../../engine/export/raster.ts';
  import { ApiError } from '../../lib/api.ts';
  import { exportProjectArchive } from '../../lib/projects.ts';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';

  type Props = { open: boolean; engine: Engine; projectId: string; projectName: string };

  let { open = $bindable(false), engine, projectId, projectName }: Props = $props();

  type TargetKind = 'selection' | 'frame' | 'page';
  type Choice = { kind: TargetKind; label: string; target: ExportTarget; name: string };

  type FileFormat = ExportFormat | 'svg' | 'pdf' | 'parcify';
  const FORMATS: Array<{ value: FileFormat; label: string }> = [
    { value: 'png', label: 'PNG' },
    { value: 'jpeg', label: 'JPG' },
    { value: 'svg', label: 'SVG' },
    { value: 'pdf', label: 'PDF' },
    { value: 'parcify', label: m.export_format_parcify() },
  ];

  let kind = $state<TargetKind>('page');
  let format = $state<FileFormat>('png');
  let scale = $state<number>(1);
  let transparent = $state(false);
  let busy = $state(false);
  let controller: AbortController | null = null;
  const uid = $props.id();

  // Lo que se puede exportar al abrir: la selección, el frame que la contiene y la página actual.
  let choices = $state.raw<Choice[]>([]);

  $effect(() => {
    if (!open) {
      controller?.abort();
      return;
    }
    const list: Choice[] = [];
    const core = engine.core;
    const ids = engine.state.selection.get();
    if (ids.length) list.push({ kind: 'selection', label: m.export_target_selection(), target: { kind: 'nodes', ids: [...ids] }, name: projectName });
    const frame = ids.length ? frameAround(ids[0]!) : null;
    if (frame) {
      const name = core.record(frame)?.name ?? '';
      list.push({ kind: 'frame', label: m.export_target_frame({ name }), target: { kind: 'nodes', ids: [frame] }, name: name || projectName });
    }
    const pageId = engine.state.pageId.get();
    const page = engine.state.pages.get().find((item) => item.id === pageId);
    if (page) list.push({ kind: 'page', label: m.export_target_page({ name: page.name }), target: { kind: 'page', pageId: page.id }, name: page.name || projectName });
    choices = list;
    kind = list[0]?.kind ?? 'page';
  });

  // El frame más cercano que contiene al nodo (o el propio nodo si es un frame).
  function frameAround(id: string): string | null {
    for (let current: string | null = id; current; current = engine.core.tree.parent(current)) {
      if (engine.core.record(current)?.type === 'frame') return current;
    }
    return null;
  }

  const choice = $derived(choices.find((item) => item.kind === kind) ?? null);
  const scene = $derived(open && choice ? collectScene(engine.core, choice.target) : null);
  const raster = $derived(format === 'png' || format === 'jpeg');
  const plan = $derived(scene && raster ? planExport(scene.bounds, scale, engine.renderer.maxTextureSize) : null);
  const pdfScenes = $derived(open && choice && scene && format === 'pdf' ? scenesForPdf(choice, scene) : []);

  // Una página por frame seleccionado; si la selección no tiene frames, o es un frame o la página, una sola.
  function scenesForPdf(target: Choice, whole: ExportScene): ExportScene[] {
    if (target.kind !== 'selection' || target.target.kind !== 'nodes') return [whole];
    const frames = target.target.ids.filter((id) => engine.core.record(id)?.type === 'frame');
    const scenes = frames.flatMap((id) => collectScene(engine.core, { kind: 'nodes', ids: [id] }) ?? []);
    return scenes.length ? scenes : [whole];
  }

  async function render(target: Choice, current: ExportScene, signal: AbortSignal): Promise<Blob> {
    if (format === 'svg') {
      const { renderSvg } = await import('../../engine/export/svg.ts');
      return renderSvg(engine.renderer, current, { title: target.name, transparent, signal });
    }
    if (format === 'pdf') {
      const { renderPdf } = await import('../../engine/export/pdf.ts');
      return renderPdf(engine.renderer, pdfScenes, { title: target.name, signal });
    }
    return (await renderRaster(engine.renderer, current, { scale, format: format === 'jpeg' ? 'jpeg' : 'png', transparent, signal })).blob;
  }

  // El .parcify lo genera el servidor con el estado vivo del documento y las imágenes.
  async function submitProject() {
    busy = true;
    controller = new AbortController();
    try {
      const blob = await exportProjectArchive(projectId, controller.signal);
      download(blob, exportFileName(projectName, 'parcify'));
      showToast({ message: m.export_parcify_done(), tone: 'success' });
      open = false;
    } catch (error) {
      // Sin red o con demasiadas peticiones, apiFetch ya avisó.
      const notified = error instanceof ApiError && (error.code === 'NETWORK' || error.code === 'RATE_LIMITED');
      if (!(error instanceof DOMException && error.name === 'AbortError') && !notified) {
        showToast({ message: error instanceof ApiError ? error.message : m.export_parcify_error(), tone: 'error' });
      }
    } finally {
      busy = false;
      controller = null;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (format === 'parcify') return submitProject();
    if (!scene || !choice) return;
    busy = true;
    controller = new AbortController();
    try {
      const blob = await render(choice, scene, controller.signal);
      download(blob, exportFileName(choice.name, format));
      showToast({ message: m.export_done(), tone: 'success' });
      open = false;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) showToast({ message: m.export_error(), tone: 'error' });
    } finally {
      busy = false;
      controller = null;
    }
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
</script>

<Dialog bind:open title={m.export_title()}>
  <form onsubmit={submit} class="flex flex-col gap-5 text-sm" novalidate>
    <fieldset class="flex flex-col gap-2" disabled={format === 'parcify'}>
      <legend class="mb-2 font-semibold {format === 'parcify' ? 'text-ink-muted' : ''}">{m.export_target()}</legend>
      {#each choices as item (item.kind)}
        <label class="flex min-h-6 items-center gap-2 {format === 'parcify' ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer'}">
          <input type="radio" name="{uid}-target" value={item.kind} bind:group={kind} class="size-4 accent-coral" />
          <span class="truncate">{item.label}</span>
        </label>
      {/each}
    </fieldset>

    <fieldset class="flex flex-col gap-2">
      <legend class="mb-2 font-semibold">{m.export_format()}</legend>
      <div class="flex flex-wrap gap-x-4 gap-y-2">
        {#each FORMATS as item (item.value)}
          <label class="flex min-h-6 cursor-pointer items-center gap-2">
            <input type="radio" name="{uid}-format" value={item.value} bind:group={format} class="size-4 accent-coral" />{item.label}
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-2" disabled={!raster}>
      <legend class="mb-2 font-semibold {raster ? '' : 'text-ink-muted'}">{m.export_scale()}</legend>
      <div class="flex gap-4">
        {#each EXPORT_SCALES as value (value)}
          <label class="flex min-h-6 items-center gap-2 tabular {raster ? 'cursor-pointer' : 'cursor-not-allowed text-ink-muted'}">
            <input type="radio" name="{uid}-scale" {value} bind:group={scale} class="size-4 accent-coral" />{value}×
          </label>
        {/each}
      </div>
    </fieldset>

    <label class="flex min-h-6 items-center gap-2 {format === 'png' || format === 'svg' ? 'cursor-pointer' : 'cursor-not-allowed text-ink-muted'}">
      <input
        type="checkbox"
        bind:checked={transparent}
        disabled={format !== 'png' && format !== 'svg'}
        aria-describedby="{uid}-transparent"
        class="size-4 accent-coral"
      />
      {m.export_transparent()}
      <span id="{uid}-transparent" class="text-xs text-ink-muted">{m.export_transparent_hint()}</span>
    </label>

    {#if format === 'svg'}
      <p class="text-xs text-ink-muted">{m.export_svg_hint()}</p>
    {:else if format === 'pdf'}
      <p class="text-xs text-ink-muted">{m.export_pdf_hint()}</p>
    {/if}

    <p role="status" class="text-ink-muted tabular">
      {#if format === 'parcify'}
        {m.export_parcify_hint()}
      {:else if !scene}
        {m.export_empty()}
      {:else if format === 'pdf'}
        {m.export_pdf_pages({ count: pdfScenes.length })}
      {:else if format === 'svg'}
        {m.export_size({ width: Math.ceil(scene.bounds.w), height: Math.ceil(scene.bounds.h) })}
      {:else if plan?.reduced}
        {m.export_reduced({ width: plan.width, height: plan.height })}
      {:else if plan}
        {m.export_size({ width: plan.width, height: plan.height })}
      {/if}
    </p>

    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button type="submit" variant="primary" loading={busy} disabled={!scene && format !== 'parcify'}>{busy ? m.export_busy() : m.export_submit()}</Button>
    </div>
  </form>
</Dialog>
