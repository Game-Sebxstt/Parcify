<script lang="ts" module>
  import type { ProjectSort as Sort, ProjectView as View } from './view.ts';

  export type ProjectSort = Sort;
  export type ProjectView = View;
  export type ProjectFilter = 'all' | 'mine' | 'shared' | 'favorites' | 'trash';
  export type ProjectQuery = { q: string; filter: ProjectFilter; sort: ProjectSort };

  export const SEARCH_DEBOUNCE_MS = 250;
</script>

<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import { onDestroy } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import Select from '../../ui/Select.svelte';
  import ViewToggle from './ViewToggle.svelte';

  type Props = {
    value: ProjectQuery;
    onchange: (value: ProjectQuery) => void;
    // Sin onview no se muestra el conmutador de cuadrícula y lista.
    view?: ProjectView;
    onview?: ((view: ProjectView) => void) | undefined;
  };

  let { value, onchange, view = 'grid', onview }: Props = $props();

  const uid = $props.id();
  let draft = $derived(value.q);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const FILTERS: Array<{ value: ProjectFilter; label: () => string }> = [
    { value: 'all', label: m.dashboard_filter_all },
    { value: 'mine', label: m.dashboard_filter_mine },
    { value: 'shared', label: m.dashboard_filter_shared },
    { value: 'favorites', label: m.dashboard_filter_favorites },
    { value: 'trash', label: m.dashboard_filter_trash },
  ];

  const SORTS: Array<{ value: ProjectSort; label: () => string }> = [
    { value: 'edited', label: m.dashboard_sort_edited },
    { value: 'name', label: m.dashboard_sort_name },
    { value: 'created', label: m.dashboard_sort_created },
  ];

  function typed(next: string) {
    draft = next;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (next.trim() !== value.q) onchange({ ...value, q: next.trim() });
    }, SEARCH_DEBOUNCE_MS);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="flex flex-wrap items-center gap-3">
  <div class="relative min-w-0 flex-1 basis-56">
    <label for="{uid}-q" class="sr-only">{m.dashboard_search_label()}</label>
    <Search size={14} aria-hidden="true" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted" />
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
          if (draft.trim() !== value.q) onchange({ ...value, q: draft.trim() });
        }
      }}
      class="h-8 w-full rounded-control border border-transparent bg-surface-2 pr-3 pl-8 text-ui text-ink placeholder:text-ink-muted hover:border-edge/60 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral"
    />
  </div>

  <SegmentedControl
    items={FILTERS.map((option) => ({ value: option.value, label: option.label() }))}
    bind:value={() => value.filter, (filter) => onchange({ ...value, filter: filter as ProjectFilter })}
    label={m.dashboard_filter_label()}
    class="flex-wrap"
  />

  <div class="flex items-center gap-2">
    <label for="{uid}-sort" class="text-ui text-ink-muted">{m.dashboard_sort_label()}</label>
    <Select
      id="{uid}-sort"
      items={SORTS.map((option) => ({ value: option.value, label: option.label() }))}
      bind:value={() => value.sort, (sort) => onchange({ ...value, sort: sort as ProjectSort })}
      label={m.dashboard_sort_label()}
    />
    {#if onview}
      <ViewToggle {view} onchange={onview} />
    {/if}
  </div>
</div>
