<script lang="ts">
  import FileIcon from '@lucide/svelte/icons/file';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import Search from '@lucide/svelte/icons/search';
  import { onDestroy, tick, untrack } from 'svelte';
  import { browser } from '../../lib/api.ts';
  import { listSharedProjects, listWorkspaceProjects } from '../../lib/projects.ts';
  import { listTemplates } from '../../lib/templates.ts';
  import { loadWorkspaces, type Workspace } from '../../lib/workspaces.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import type { ProjectSummary } from '../../shared/api/projects.js';
  import Button from '../../ui/Button.svelte';
  import Popover from '../../ui/Popover.svelte';
  import { MOD_ARIA, MOD_KEY } from '../editor/layout/ui-keys.ts';
  import {
    SEARCH_DELAY_MS,
    SEARCH_MAX_CHARS,
    SEARCH_MAX_PROJECTS,
    SEARCH_MAX_TEMPLATES,
    SEARCH_MAX_WORKSPACES,
    mergeProjects,
    nameMatches,
    searchTerm,
    templateHref,
  } from './search.ts';

  type Props = {
    open?: boolean;
    // Espacios activos: en cada uno se buscan proyectos.
    spaces: Workspace[];
    // Estado de la lista de espacios: hasta que no está lista no se sabe dónde buscar.
    spacesStatus: 'idle' | 'loading' | 'ready' | 'error';
    // Las plantillas se buscan en el espacio elegido en la barra lateral.
    templateSpace: Workspace | null;
    collapsed?: boolean;
  };

  let { open = $bindable(false), spaces, spacesStatus, templateSpace, collapsed = false }: Props = $props();

  type Option = { kind: 'project' | 'template'; id: string; name: string; meta: string; href: string };
  type Results = { q: string; projects: Option[]; templates: Option[] };

  const uid = $props.id();
  let draft = $state('');
  let status = $state<'idle' | 'short' | 'loading' | 'ready' | 'error'>('idle');
  let results = $state.raw<Results | null>(null);
  let active = $state(0);
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Los compartidos no admiten q: se piden una vez por búsqueda abierta y se filtran aquí.
  let shared: Promise<ProjectSummary[]> | null = null;
  // Consulta que espera a que lleguen los espacios.
  let waiting: string | null = null;

  const term = $derived(searchTerm(draft));
  // Solo se pintan los resultados de la consulta que hay escrita; los de una anterior no llegan a verse.
  const shown = $derived(results && results.q === term ? results : null);
  const options = $derived(shown ? [...shown.projects, ...shown.templates] : []);
  const names = $derived(new Map(spaces.map((space) => [space.slug, space.name])));

  const optionId = (index: number) => `${uid}-option-${index}`;

  function reset() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    shared = null;
    waiting = null;
    draft = '';
    status = 'idle';
    results = null;
    active = 0;
  }

  function typed(value: string) {
    draft = value;
    clearTimeout(timer);
    controller?.abort();
    waiting = null;
    results = null;
    const q = searchTerm(value);
    if (!q) {
      status = value.trim() ? 'short' : 'idle';
      return;
    }
    status = 'loading';
    timer = setTimeout(() => void run(q), SEARCH_DELAY_MS);
  }

  function projectOption(project: ProjectSummary): Option {
    return {
      kind: 'project',
      id: project.id,
      name: project.name,
      meta: names.get(project.workspaceSlug) ?? m.shell_search_shared(),
      href: `/p/${project.id}`,
    };
  }

  // Cuando llegan los espacios se lanza la consulta que esperaba; si no llegan, se avisa del error.
  $effect(() => {
    const state = spacesStatus;
    untrack(() => {
      if (waiting === null) return;
      if (state === 'ready') {
        const q = waiting;
        waiting = null;
        if (q === term) void run(q);
      } else if (state === 'error') {
        waiting = null;
        status = 'error';
      }
    });
  });

  async function run(q: string) {
    controller?.abort();
    controller = null;
    status = 'loading';
    if (spacesStatus !== 'ready') {
      if (spacesStatus === 'error') {
        waiting = null;
        status = 'error';
      } else {
        waiting = q;
      }
      return;
    }
    waiting = null;
    const current = (controller = new AbortController());
    const { signal } = current;
    const space = templateSpace;
    shared ??= listSharedProjects(50).then(
      (page) => page.items,
      () => [],
    );
    try {
      const [pages, sharedItems, templatePage] = await Promise.all([
        Promise.all(
          spaces
            .slice(0, SEARCH_MAX_WORKSPACES)
            .map((workspace) => listWorkspaceProjects(workspace.slug, { q, sort: 'edited', dir: 'desc', limit: SEARCH_MAX_PROJECTS }, signal)),
        ),
        shared,
        space ? listTemplates(space.slug, { q, limit: SEARCH_MAX_TEMPLATES }, signal) : null,
      ]);
      if (signal.aborted) return;
      const projects = mergeProjects([...pages.map((page) => page.items), sharedItems.filter((item) => nameMatches(item.name, q))], SEARCH_MAX_PROJECTS);
      const templates = space
        ? (templatePage?.items ?? []).map(
            (template): Option => ({
              kind: 'template',
              id: template.id,
              name: template.name,
              meta: template.scope === 'parcify' ? m.brand_name() : space.name,
              href: templateHref(space.slug, template),
            }),
          )
        : [];
      results = { q, projects: projects.map(projectOption), templates };
      active = 0;
      status = 'ready';
    } catch {
      // Una respuesta cortada a medias por la cancelación llega como error de formato: también se ignora.
      if (signal.aborted) return;
      status = 'error';
    }
  }

  // Si lo que falló fue la lista de espacios, se vuelve a pedir y la consulta espera a que llegue.
  function retry() {
    if (!term) return;
    if (spacesStatus === 'error') {
      status = 'loading';
      waiting = term;
      void loadWorkspaces();
    } else {
      void run(term);
    }
  }

  function go(option: Option | undefined) {
    if (!option) return;
    open = false;
    browser.assign(option.href);
  }

  async function move(step: number) {
    if (!options.length) return;
    active = (active + step + options.length) % options.length;
    await tick();
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      void move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (options.length) go(options[active]);
      else if (term && status === 'loading') {
        clearTimeout(timer);
        void run(term);
      }
    }
  }

  onDestroy(reset);
</script>

{#snippet trigger(props: Record<string, unknown>)}
  <button
    {...props}
    type="button"
    aria-keyshortcuts="{MOD_ARIA}+K"
    data-testid="shell-search"
    class="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border border-transparent bg-surface-2 px-2 text-ui text-ink-muted transition-colors duration-(--dur-fast) hover:border-edge/60 hover:text-ink collapsed:w-10 collapsed:justify-center collapsed:px-0"
  >
    <Search size={14} aria-hidden="true" class="shrink-0" />
    <span class="min-w-0 flex-1 truncate text-left collapsed:sr-only">{m.shell_search_open()}</span>
    <kbd aria-hidden="true" class="shrink-0 rounded-xs bg-petrol px-1 font-sans text-2xs text-ink-muted tabular collapsed:hidden touch:hidden">{MOD_KEY} K</kbd>
  </button>
{/snippet}

{#snippet group(label: string, list: Option[], offset: number)}
  {#if list.length}
    <li role="presentation" class="flex flex-col">
      <p id="{uid}-{list[0]!.kind}" aria-hidden="true" class="px-2 pt-2 pb-1 text-2xs font-semibold text-ink-muted">{label}</p>
      <ul role="group" aria-labelledby="{uid}-{list[0]!.kind}" class="flex flex-col">
        {#each list as option, index (option.id)}
          {@const position = offset + index}
          {@const Icon = option.kind === 'project' ? FileIcon : LayoutTemplate}
          <!-- El teclado lo lleva el campo (combobox con aria-activedescendant): las opciones no reciben el foco. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id={optionId(position)}
            role="option"
            tabindex="-1"
            aria-selected={position === active}
            class={[
              'flex h-8 cursor-pointer items-center gap-2 rounded-control px-2 text-ui',
              position === active ? 'bg-petrol text-ink' : 'text-ink',
            ]}
            onmousemove={() => (active = position)}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => go(option)}
          >
            <Icon size={14} aria-hidden="true" class="shrink-0 text-ink-muted" />
            <span class="min-w-0 flex-1 truncate">{option.name}</span>
            <span class="max-w-[45%] shrink-0 truncate text-2xs text-ink-muted"><span class="sr-only">, </span>{option.meta}</span>
          </li>
        {/each}
      </ul>
    </li>
  {/if}
{/snippet}

<Popover
  bind:open
  {trigger}
  label={m.shell_search_dialog()}
  side={collapsed ? 'right' : 'bottom'}
  align="start"
  testid="shell-search-popover"
  class="flex w-[min(24rem,calc(100vw-1rem))] flex-col gap-1"
  onOpenChange={(value) => {
    if (!value) reset();
  }}
>
  <div class="relative">
    <Search size={14} aria-hidden="true" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted" />
    <input
      type="text"
      role="combobox"
      aria-label={m.shell_search_label()}
      aria-expanded={options.length > 0}
      aria-controls="{uid}-results"
      aria-autocomplete="list"
      aria-activedescendant={options.length ? optionId(active) : undefined}
      autocomplete="off"
      spellcheck="false"
      maxlength={SEARCH_MAX_CHARS}
      placeholder={m.shell_search_placeholder()}
      value={draft}
      oninput={(event) => typed(event.currentTarget.value)}
      {onkeydown}
      data-testid="shell-search-input"
      class="h-9 w-full rounded-control border border-edge/40 bg-surface-1 pr-2 pl-8 text-ui text-ink placeholder:text-ink-muted hover:border-edge/60 focus-visible:outline-1 focus-visible:-outline-offset-1"
    />
  </div>

  <ul
    id="{uid}-results"
    role="listbox"
    aria-label={m.shell_search_results()}
    class={['max-h-[min(60dvh,26rem)] overflow-y-auto scroll-thin', options.length ? '' : 'hidden']}
  >
    {#if shown}
      {@render group(m.shell_search_projects(), shown.projects, 0)}
      {@render group(m.shell_search_templates(), shown.templates, shown.projects.length)}
    {/if}
  </ul>

  <div role="status" class="px-2 text-ui text-ink-muted">
    {#if status === 'short'}
      <p class="py-2">{m.shell_search_short()}</p>
    {:else if status === 'loading'}
      <p class="py-2">{m.shell_search_loading()}</p>
    {:else if status === 'ready' && shown && options.length === 0}
      <p class="py-2">{m.shell_search_empty({ q: shown.q })}</p>
    {:else if status === 'idle'}
      <p class="py-2">{m.shell_search_idle()}</p>
    {/if}
  </div>
  {#if status === 'error'}
    <div role="alert" class="flex items-center gap-3 px-2 py-1">
      <p class="min-w-0 flex-1 text-ui text-ink">{spacesStatus === 'error' ? m.shell_search_spaces_error() : m.shell_search_error()}</p>
      <Button size="sm" onclick={retry}>{m.common_retry()}</Button>
    </div>
  {/if}
</Popover>
