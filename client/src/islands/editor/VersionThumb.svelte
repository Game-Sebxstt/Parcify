<script lang="ts">
  import ImageOff from '@lucide/svelte/icons/image-off';
  import SquareDashed from '@lucide/svelte/icons/square-dashed';
  import { untrack } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import type { VersionDto } from '../../shared/api/versions.js';
  import { getVersionThumbnails, type ThumbResult } from './versions/version-thumbnails.ts';

  type Props = {
    version: VersionDto;
    // Página que se pinta: la activa del editor (si la versión no la tiene, la primera).
    pageId: string | null;
  };

  let { version, pageId }: Props = $props();

  const thumbs = getVersionThumbnails();
  // Miniaturas a 200 px o menos de la parte visible de la lista: se piden un poco antes de verse.
  const ROOT_MARGIN = '200px';

  let visible = $state(false);
  // Último resultado que llegó para esta versión y página; los fallos no se guardan en la caché.
  let loaded = $state.raw<{ key: string; result: ThumbResult } | null>(null);
  // Sube si la imagen ya no carga (su URL salió de la caché y se revocó): se vuelve a pedir, como mucho dos veces.
  let attempt = $state(0);
  const MAX_ATTEMPTS = 2;

  function onImageError() {
    thumbs.forget(version, pageId);
    if (attempt < MAX_ATTEMPTS) attempt++;
  }

  const key = $derived(`${version.id}:${pageId ?? ''}:${attempt}`);
  const result = $derived(thumbs.cached(version, pageId) ?? (loaded?.key === key ? loaded.result : null));

  // Depende de la clave y no del objeto: al recargar la lista llegan objetos nuevos de las mismas versiones.
  $effect(() => {
    const current = key;
    if (!visible) return;
    const [target, page] = untrack(() => [version, pageId] as const);
    if (thumbs.cached(target, page)) return;
    const controller = new AbortController();
    void thumbs.request(target, page, controller.signal).then((next) => {
      if (next && !controller.signal.aborted) loaded = { key: current, result: next };
    });
    return () => controller.abort();
  });

  // Fuera de la lista visible (o con el panel oculto) no se pide nada.
  function observe(node: HTMLElement) {
    const root = node.closest<HTMLElement>('[data-thumb-root]');
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries.at(-1);
        if (last) visible = last.isIntersecting;
      },
      { root, rootMargin: ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }

  const status = $derived(result?.kind ?? 'loading');
</script>

<div
  {@attach observe}
  class={[
    'relative h-10 w-16 shrink-0 overflow-hidden rounded-control border border-edge/25 bg-surface-2',
    status === 'loading' && 'motion-safe:animate-pulse',
  ]}
  data-testid="version-thumb"
  data-state={status}
>
  {#if result?.kind === 'image'}
    <img
      src={result.url}
      alt=""
      width="64"
      height="40"
      decoding="async"
      draggable="false"
      class="block size-full object-contain"
      onerror={onImageError}
    />
  {:else if result}
    {@const label =
      result.kind === 'empty' ? m.editor_versions_thumb_empty() : result.kind === 'large' ? m.editor_versions_thumb_large() : m.editor_versions_thumb_error()}
    <div
      role="img"
      aria-label={result.kind === 'large' ? m.editor_versions_thumb_large_label() : label}
      class="flex size-full flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] leading-none text-ink-muted"
    >
      {#if result.kind === 'empty'}
        <SquareDashed size={12} aria-hidden="true" />
      {:else}
        <ImageOff size={12} aria-hidden="true" />
      {/if}
      <span aria-hidden="true">{label}</span>
    </div>
  {/if}
</div>
