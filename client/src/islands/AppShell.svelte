<script lang="ts">
  import MenuIcon from '@lucide/svelte/icons/menu';
  import Plus from '@lucide/svelte/icons/plus';
  import { onMount, tick } from 'svelte';
  import { on } from 'svelte/events';
  import { innerWidth } from 'svelte/reactivity/window';
  import { ApiError, apiFetch, browser } from '../lib/api.ts';
  import { syncAppLocation } from '../lib/app-location.svelte.ts';
  import { assetUrl } from '../lib/assets.ts';
  import { FAVORITES_CHANGED, listSharedProjects, listWorkspaceProjects } from '../lib/projects.ts';
  import { loadSession, session } from '../lib/session.svelte.ts';
  import { TABLET_MIN_WIDTH } from '../lib/viewport.svelte.ts';
  import { activeWorkspaces, loadWorkspaces, trashedWorkspaces, workspaces, type Workspace } from '../lib/workspaces.svelte.ts';
  import { m } from '../paraglide/messages.js';
  import { WorkspaceDetailSchema } from '../shared/api/workspaces.js';
  import Sheet from '../ui/Sheet.svelte';
  import { showToast } from '../ui/toast.svelte.ts';
  import NameDialog from './dashboard/NameDialog.svelte';
  import { mergeProjects, SEARCH_MAX_WORKSPACES } from './shell/search.ts';
  import ShellNav, { type FavoritesState } from './shell/ShellNav.svelte';
  import NewProjectDialog from './templates/NewProjectDialog.svelte';

  type Props = { current: 'home' | 'workspace' | 'settings' };
  let { current }: Props = $props();

  // Lo lee también layouts/sidebar-boot.ts antes de pintar, para no saltar de 240 a 56 px al cargar.
  const PREFS_KEY = 'parcify:sidebar';
  const SPACE_KEY = 'parcify:workspace';
  const FAVORITES_SHOWN = 10;

  let pageSlug = $state<string | null>(null);
  let storedSlug = $state<string | null>(null);
  let collapsed = $state(false);
  let drawerOpen = $state(false);
  let asideSearch = $state(false);
  let drawerSearch = $state(false);
  let createSpaceOpen = $state(false);
  let createProjectOpen = $state(false);
  let restoring = $state<string | null>(null);
  let avatar = $state<string | null>(null);
  let favorites = $state<FavoritesState>({ open: false, status: 'idle', items: [] });
  let favoritesController: AbortController | null = null;

  const spaces = $derived(activeWorkspaces());
  const trashed = $derived(trashedWorkspaces());
  // En la página de un espacio manda ese espacio; si no, el último elegido, el personal o el primero.
  const selected = $derived<Workspace | null>(
    spaces.find((space) => space.slug === pageSlug) ??
      spaces.find((space) => space.slug === storedSlug) ??
      spaces.find((space) => space.personal) ??
      spaces[0] ??
      null,
  );
  const mobile = $derived((innerWidth.current ?? TABLET_MIN_WIDTH) < TABLET_MIN_WIDTH);
  const title = $derived(
    current === 'settings'
      ? m.shell_settings_short()
      : current === 'workspace'
        ? (workspaces.items.find((space) => space.slug === pageSlug)?.name ?? '')
        : m.shell_home(),
  );

  onMount(() => {
    pageSlug = /^\/app\/e\/([a-z0-9-]{1,48})\/?$/.exec(window.location.pathname)?.[1] ?? null;
    syncAppLocation();
    const prefs = readPrefs();
    collapsed = prefs.collapsed === true;
    favorites.open = prefs.favorites === true;
    try {
      storedSlug = localStorage.getItem(SPACE_KEY);
      if (pageSlug) localStorage.setItem(SPACE_KEY, pageSlug);
    } catch {
      storedSlug = null;
    }
    void loadSession();
    void loadWorkspaces().then(() => {
      if (favorites.open) void loadFavorites();
    });
    // La estrella de una tarjeta (otra isla) cambia los favoritos: la lista abierta se vuelve a pedir.
    const off = on(window, FAVORITES_CHANGED, () => {
      if (favorites.open) void loadFavorites();
    });
    return () => {
      off();
      favoritesController?.abort();
    };
  });

  $effect(() => {
    const id = session.me?.user.avatarAssetId;
    avatar = null;
    if (id) void assetUrl(id).then((url) => (avatar = url));
  });

  function readPrefs(): { collapsed?: boolean; favorites?: boolean } {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      return typeof value === 'object' && value !== null ? value : {};
    } catch {
      return {};
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ collapsed, favorites: favorites.open }));
    } catch {
      // Sin almacenamiento (modo privado estricto) la preferencia dura lo que la página.
    }
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    if (collapsed) document.documentElement.dataset.sidebar = 'collapsed';
    else delete document.documentElement.dataset.sidebar;
    savePrefs();
  }

  function toggleFavorites() {
    favorites.open = !favorites.open;
    savePrefs();
    if (favorites.open) void loadFavorites();
    else favoritesController?.abort();
  }

  async function loadFavorites() {
    favoritesController?.abort();
    const controller = (favoritesController = new AbortController());
    const { signal } = controller;
    if (favorites.status !== 'ready') favorites.status = 'loading';
    try {
      const [pages, shared] = await Promise.all([
        Promise.all(
          spaces
            .slice(0, SEARCH_MAX_WORKSPACES)
            .map((space) => listWorkspaceProjects(space.slug, { filter: 'favorites', sort: 'edited', dir: 'desc', limit: FAVORITES_SHOWN }, signal)),
        ),
        listSharedProjects(50, signal),
      ]);
      if (signal.aborted) return;
      favorites.items = mergeProjects([...pages.map((page) => page.items), shared.items.filter((item) => item.favorite)], FAVORITES_SHOWN);
      favorites.status = 'ready';
    } catch {
      if (signal.aborted) return;
      favorites.status = 'error';
    }
  }

  function selectSpace(slug: string) {
    storedSlug = slug;
    try {
      localStorage.setItem(SPACE_KEY, slug);
    } catch {
      // Ver savePrefs.
    }
    if (!(current === 'workspace' && pageSlug === slug)) browser.assign(`/app/e/${slug}`);
  }

  // Desde el cajón móvil, los diálogos se abren cuando el cajón ya se ha cerrado: dos capas modales a la vez se pelean
  // por el foco.
  async function fromDrawer(open: () => void) {
    if (drawerOpen) {
      drawerOpen = false;
      await tick();
    }
    open();
  }

  async function openSearch() {
    if (mobile) {
      drawerOpen = true;
      await tick();
      drawerSearch = true;
    } else {
      asideSearch = true;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() !== 'k') return;
    // Con otro diálogo modal abierto (crear un proyecto, confirmar), el atajo no lo tapa con otra capa.
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-testid="app-drawer"])')) return;
    event.preventDefault();
    void openSearch();
  }

  async function createWorkspace(name: string): Promise<string | null> {
    try {
      const created = await apiFetch('/v1/workspaces', { method: 'POST', body: { name }, schema: WorkspaceDetailSchema });
      await loadWorkspaces({ force: true });
      browser.assign(`/app/e/${created.slug}`);
      return null;
    } catch (error) {
      return error instanceof ApiError ? error.message : m.error_internal();
    }
  }

  async function restore(workspace: Workspace) {
    restoring = workspace.slug;
    try {
      await apiFetch(`/v1/workspaces/${encodeURIComponent(workspace.slug)}/restore`, { method: 'POST', schema: WorkspaceDetailSchema });
      await loadWorkspaces({ force: true });
      showToast({ message: m.workspace_restored({ name: workspace.name }), tone: 'success' });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    } finally {
      restoring = null;
    }
  }
</script>

<svelte:window {onkeydown} />

{#snippet nav(inDrawer: boolean)}
  <ShellNav
    {current}
    {pageSlug}
    {spaces}
    {trashed}
    status={workspaces.status}
    {selected}
    collapsed={inDrawer ? false : collapsed}
    collapsible={!inDrawer}
    {favorites}
    {avatar}
    {restoring}
    bind:searchOpen={() => (inDrawer ? drawerSearch : asideSearch), (value) => (inDrawer ? (drawerSearch = value) : (asideSearch = value))}
    onselectspace={selectSpace}
    oncreatespace={() => void fromDrawer(() => (createSpaceOpen = true))}
    ontogglecollapse={toggleCollapsed}
    ontogglefavorites={toggleFavorites}
    onrestore={(workspace) => void restore(workspace)}
  />
{/snippet}

<header
  class="sticky top-0 z-(--z-toolbar) flex h-12 items-center gap-1 border-b border-edge/25 bg-surface-1 px-1 pt-[env(safe-area-inset-top)] box-content sm:hidden"
>
  <button
    type="button"
    aria-label={m.shell_open_menu()}
    aria-haspopup="dialog"
    aria-expanded={drawerOpen}
    onclick={() => (drawerOpen = true)}
    data-testid="shell-menu"
    class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-card text-ink hover:bg-surface-2"
  >
    <MenuIcon size={20} aria-hidden="true" />
  </button>
  <p class="min-w-0 flex-1 truncate text-ui font-semibold">{title}</p>
  {#if spaces.length}
    <button
      type="button"
      aria-label={m.dashboard_new_project()}
      onclick={() => (createProjectOpen = true)}
      data-testid="shell-new-project"
      class="mr-1.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-card bg-coral text-coral-ink hover:bg-coral-hover"
    >
      <Plus size={20} aria-hidden="true" />
    </button>
  {/if}
</header>

<aside
  data-shell-aside
  aria-label={m.shell_label()}
  class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-edge/25 bg-surface-1 sm:flex collapsed:w-14"
>
  {@render nav(false)}
</aside>

<Sheet
  bind:open={() => drawerOpen && mobile, (value) => (drawerOpen = value)}
  side="left"
  title={m.brand_name()}
  testid="app-drawer"
>
  {@render nav(true)}
</Sheet>

<NameDialog
  bind:open={createSpaceOpen}
  title={m.shell_new_space_title()}
  label={m.shell_space_name()}
  submitLabel={m.shell_create_space()}
  onsubmit={createWorkspace}
/>

<NewProjectDialog bind:open={createProjectOpen} {spaces} {...selected ? { initialSlug: selected.slug } : {}} />
