<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, browser } from '../../lib/api.ts';
  import { createProject } from '../../lib/projects.ts';
  import { listTemplates, setTemplateFavorite, setTemplateLike } from '../../lib/templates.ts';
  import { m } from '../../paraglide/messages.js';
  import type { TemplateSummary } from '../../shared/api/templates.js';
  import Button from '../../ui/Button.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { SEARCH_DEBOUNCE_MS } from '../dashboard/ProjectFilters.svelte';
  import { templateByline } from './byline.ts';
  import TemplateCard from './TemplateCard.svelte';
  import TemplatePreview from './TemplatePreview.svelte';

  type Filter = 'all' | 'favorites';
  type Props = { slug: string; meId: string; onshowprojects: () => void };
  let { slug, meId, onshowprojects }: Props = $props();

  const uid = $props.id();
  let q = $state('');
  let draft = $state('');
  let filter = $state<Filter>('all');
  let items = $state<TemplateSummary[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadingMore = $state(false);
  let liking = $state<string[]>([]);
  let using = $state<string | null>(null);
  let previewId = $state<string | null>(null);
  let previewOpen = $state(false);
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const previewing = $derived(items.find((item) => item.id === previewId) ?? null);

  const FILTERS: Array<{ value: Filter; label: () => string }> = [
    { value: 'all', label: m.templates_filter_all },
    { value: 'favorites', label: m.templates_filter_favorites },
  ];

  onMount(() => {
    void load();
    return () => controller?.abort();
  });

  onDestroy(() => clearTimeout(timer));

  async function load(more = false) {
    controller?.abort();
    const current = (controller = new AbortController());
    if (more) loadingMore = true;
    else status = 'loading';
    try {
      const page = await listTemplates(slug, { q, filter, cursor: more ? nextCursor : null }, current.signal);
      const known = new Set(items.map((item) => item.id));
      items = more ? [...items, ...page.items.filter((item) => !known.has(item.id))] : page.items;
      nextCursor = page.nextCursor;
      status = 'ready';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!more) status = 'error';
      else showToast({ message: messageOf(error), tone: 'error' });
    } finally {
      if (controller === current) loadingMore = false;
    }
  }

  function messageOf(error: unknown) {
    return error instanceof ApiError ? error.message : m.error_internal();
  }

  function search(next: string) {
    const value = next.trim();
    if (value === q) return;
    q = value;
    void load();
  }

  function typed(next: string) {
    draft = next;
    clearTimeout(timer);
    timer = setTimeout(() => search(next), SEARCH_DEBOUNCE_MS);
  }

  function setFilter(next: Filter) {
    filter = next;
    void load();
  }

  function clearSearch() {
    draft = '';
    q = '';
    filter = 'all';
    void load();
  }

  function replace(template: TemplateSummary) {
    items = items.map((item) => (item.id === template.id ? template : item));
  }

  // El contador lo devuelve el servidor: un «Me gusta» repetido no suma.
  async function toggleLike(template: TemplateSummary) {
    if (liking.includes(template.id)) return;
    liking = [...liking, template.id];
    try {
      const result = await setTemplateLike(template.id, !template.liked);
      const current = items.find((item) => item.id === template.id);
      if (current) replace({ ...current, ...result });
    } catch (error) {
      showToast({ message: messageOf(error), tone: 'error' });
    } finally {
      liking = liking.filter((id) => id !== template.id);
    }
  }

  async function toggleFavorite(template: TemplateSummary) {
    const favorite = !template.favorite;
    replace({ ...template, favorite });
    try {
      await setTemplateFavorite(template.id, favorite);
      if (!favorite && filter === 'favorites' && !previewOpen) items = items.filter((item) => item.id !== template.id);
    } catch (error) {
      replace(template);
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  async function use(template: TemplateSummary) {
    if (using) return;
    using = template.id;
    try {
      const project = await createProject(slug, template.name, template.id);
      browser.assign(`/p/${project.id}`);
    } catch (error) {
      using = null;
      showToast({ message: messageOf(error), tone: 'error' });
    }
  }

  function preview(template: TemplateSummary) {
    previewId = template.id;
    previewOpen = true;
  }
</script>

<section aria-labelledby="{uid}-heading" class="flex flex-col gap-5">
  <h2 id="{uid}-heading" class="sr-only">{m.templates_heading()}</h2>

  <div class="flex flex-wrap items-center gap-3">
    <div class="relative min-w-0 flex-1 basis-56">
      <label for="{uid}-q" class="sr-only">{m.templates_search_label()}</label>
      <Search size={16} aria-hidden="true" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
      <input
        id="{uid}-q"
        type="search"
        value={draft}
        maxlength={80}
        autocomplete="off"
        placeholder={m.dashboard_search_placeholder()}
        oninput={(event) => typed(event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            clearTimeout(timer);
            search(draft);
          }
        }}
        class="h-10 w-full rounded-panel border border-edge bg-surface-2 pr-3 pl-9 text-sm text-ink placeholder:text-ink-muted hover:border-ink-muted focus-visible:border-coral"
      />
    </div>

    <SegmentedControl
      items={FILTERS.map((option) => ({ value: option.value, label: option.label() }))}
      bind:value={() => filter, (next) => setFilter(next as Filter)}
      label={m.dashboard_filter_label()}
    />
  </div>

  {#if status === 'loading'}
    <p class="sr-only" role="status">{m.templates_loading()}</p>
    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {#each [0, 1, 2, 3] as index (index)}
        <li class="rounded-panel bg-surface-1 p-2">
          <Skeleton class="aspect-[16/10] w-full" />
          <Skeleton class="mt-3 h-4 w-2/3" />
          <Skeleton class="mt-2 h-3 w-1/2" />
        </li>
      {/each}
    </ul>
  {:else if status === 'error'}
    <div role="alert" class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      <p class="text-sm">{m.templates_error()}</p>
      <Button size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
    </div>
  {:else if items.length === 0}
    <div class="flex flex-col items-start gap-3 rounded-panel bg-surface-1 p-6">
      {#if q}
        <p class="text-sm">{m.templates_empty_search({ q })}</p>
        <Button size="sm" onclick={clearSearch}>{m.dashboard_clear_filters()}</Button>
      {:else if filter === 'favorites'}
        <p class="text-sm">{m.templates_empty_favorites()}</p>
      {:else}
        <p class="text-sm">{m.templates_empty()}</p>
        <Button size="sm" onclick={onshowprojects}>{m.templates_go_projects()}</Button>
      {/if}
    </div>
  {:else}
    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={m.templates_heading()}>
      {#each items as template (template.id)}
        <TemplateCard
          {template}
          byline={templateByline(template, meId)}
          liking={liking.includes(template.id)}
          using={using === template.id}
          busy={using !== null}
          onpreview={() => preview(template)}
          onlike={() => void toggleLike(template)}
          onfavorite={() => void toggleFavorite(template)}
          onuse={() => void use(template)}
        />
      {/each}
    </ul>
    {#if nextCursor}
      <div>
        <Button size="sm" loading={loadingMore} onclick={() => void load(true)}>{m.dashboard_load_more()}</Button>
      </div>
    {/if}
  {/if}
</section>

<TemplatePreview
  bind:open={previewOpen}
  template={previewing}
  byline={previewing ? templateByline(previewing, meId) : ''}
  liking={previewing ? liking.includes(previewing.id) : false}
  using={previewing !== null && using === previewing.id}
  onlike={() => previewing && void toggleLike(previewing)}
  onfavorite={() => previewing && void toggleFavorite(previewing)}
  onuse={() => previewing && void use(previewing)}
  onclose={() => {
    if (filter === 'favorites') items = items.filter((item) => item.favorite);
  }}
/>
