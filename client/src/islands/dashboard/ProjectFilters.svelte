<script lang="ts" module>
  export type ProjectFilter = 'all' | 'mine' | 'shared' | 'favorites' | 'trash';
  export type ProjectSort = 'edited' | 'name' | 'created';
  export type ProjectQuery = { q: string; filter: ProjectFilter; sort: ProjectSort };

  export const SEARCH_DEBOUNCE_MS = 250;
</script>

<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import { onDestroy } from 'svelte';
  import { m } from '../../paraglide/messages.js';

  type Props = {
    value: ProjectQuery;
    onchange: (value: ProjectQuery) => void;
  };

  let { value, onchange }: Props = $props();

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
          if (draft.trim() !== value.q) onchange({ ...value, q: draft.trim() });
        }
      }}
      class="h-10 w-full rounded-panel border border-edge bg-surface-2 pr-3 pl-9 text-sm text-ink placeholder:text-ink-muted hover:border-ink-muted focus-visible:border-coral"
    />
  </div>

  <fieldset class="flex flex-wrap gap-1 rounded-full bg-surface-1 p-1">
    <legend class="sr-only">{m.dashboard_filter_label()}</legend>
    {#each FILTERS as option (option.value)}
      <label
        class="relative inline-flex h-8 cursor-pointer items-center rounded-full px-3.5 text-sm font-medium text-ink-muted hover:text-ink has-checked:bg-surface-2 has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-coral"
      >
        <input
          type="radio"
          name="{uid}-filter"
          value={option.value}
          checked={value.filter === option.value}
          onchange={() => onchange({ ...value, filter: option.value })}
          class="sr-only"
        />
        {option.label()}
      </label>
    {/each}
  </fieldset>

  <div class="flex items-center gap-2">
    <label for="{uid}-sort" class="text-sm text-ink-muted">{m.dashboard_sort_label()}</label>
    <select
      id="{uid}-sort"
      value={value.sort}
      onchange={(event) => onchange({ ...value, sort: event.currentTarget.value as ProjectSort })}
      class="h-10 cursor-pointer rounded-panel border border-edge bg-surface-2 px-3 text-sm text-ink hover:border-ink-muted focus-visible:border-coral"
    >
      {#each SORTS as option (option.value)}
        <option value={option.value}>{option.label()}</option>
      {/each}
    </select>
  </div>
</div>
