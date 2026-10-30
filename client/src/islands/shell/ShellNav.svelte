<script lang="ts" module>
  export type FavoritesState = { open: boolean; status: 'idle' | 'loading' | 'ready' | 'error'; items: ProjectSummary[] };
</script>

<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import Clock from '@lucide/svelte/icons/clock';
  import Folder from '@lucide/svelte/icons/folder';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import Plus from '@lucide/svelte/icons/plus';
  import Settings from '@lucide/svelte/icons/settings';
  import Star from '@lucide/svelte/icons/star';
  import Trash from '@lucide/svelte/icons/trash';
  import Users from '@lucide/svelte/icons/users';
  import { browser } from '../../lib/api.ts';
  import { appLocation } from '../../lib/app-location.svelte.ts';
  import { formatDate } from '../../lib/format.ts';
  import { session, signOut } from '../../lib/session.svelte.ts';
  import type { Workspace } from '../../lib/workspaces.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import type { ProjectSummary } from '../../shared/api/projects.js';
  import Avatar from '../../ui/Avatar.svelte';
  import Button from '../../ui/Button.svelte';
  import DropdownMenu, { type MenuEntry, type MenuIcon } from '../../ui/DropdownMenu.svelte';
  import MenuList from '../../ui/Menu.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import ShellSearch from './ShellSearch.svelte';
  import WorkspaceMark from './WorkspaceMark.svelte';

  type Props = {
    current: 'home' | 'workspace' | 'settings';
    // Espacio de la página abierta (solo en la página de un espacio).
    pageSlug: string | null;
    spaces: Workspace[];
    trashed: Workspace[];
    status: 'idle' | 'loading' | 'ready' | 'error';
    // Espacio elegido arriba: de él salen Plantillas y las plantillas del buscador.
    selected: Workspace | null;
    // Plegada a 56 px: solo iconos y tooltips. El cajón móvil nunca va plegado.
    collapsed: boolean;
    collapsible: boolean;
    favorites: FavoritesState;
    avatar: string | null;
    restoring: string | null;
    searchOpen?: boolean;
    onselectspace: (slug: string) => void;
    oncreatespace: () => void;
    ontogglecollapse?: () => void;
    ontogglefavorites: () => void;
    onrestore: (workspace: Workspace) => void;
  };

  let {
    current,
    pageSlug,
    spaces,
    trashed,
    status,
    selected,
    collapsed,
    collapsible,
    favorites,
    avatar,
    restoring,
    searchOpen = $bindable(false),
    onselectspace,
    oncreatespace,
    ontogglecollapse,
    ontogglefavorites,
    onrestore,
  }: Props = $props();

  const uid = $props.id();

  const params = $derived(new URLSearchParams(appLocation.search));
  const tab = $derived(current === 'home' ? (params.get('pestana') ?? 'recientes') : null);
  const view = $derived(current === 'workspace' ? (params.get('vista') ?? 'proyectos') : null);
  const inTrash = $derived(view === 'proyectos' && params.get('filtro') === 'trash');

  const isAdmin = $derived(selected?.role === 'owner' || selected?.role === 'admin');

  const switchItems = $derived<MenuEntry[]>([
    {
      kind: 'label',
      id: 'spaces',
      label: m.shell_spaces(),
      items: spaces.map((space) => ({
        kind: 'check' as const,
        id: space.id,
        label: space.name,
        checked: space.slug === selected?.slug,
        onSelect: () => onselectspace(space.slug),
      })),
    },
    { kind: 'separator', id: 'separator' },
    { kind: 'item', id: 'create', label: m.shell_create_space(), icon: Plus, onSelect: oncreatespace },
    ...(selected && isAdmin
      ? [
          {
            kind: 'item' as const,
            id: 'settings',
            label: m.shell_space_settings(),
            icon: Settings,
            onSelect: () => browser.assign(`/app/e/${selected.slug}?vista=ajustes`),
          },
        ]
      : []),
  ]);

  const ROW = [
    'flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-ui transition-colors duration-(--dur-fast)',
    'collapsed:w-10 collapsed:justify-center collapsed:px-0',
  ].join(' ');
  const rowClass = (selectedRow: boolean) =>
    [ROW, selectedRow ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'].join(' ');
</script>

{#snippet row(href: string, label: string, icon: MenuIcon, active: boolean, extra: string = '')}
  {@const Icon = icon}
  <Tooltip text={label} side="right" disabled={!collapsed}>
    {#snippet children(props)}
      <a {...props} {href} aria-current={active ? 'page' : undefined} class={[rowClass(active), extra]}>
        <span aria-hidden="true" class="inline-flex shrink-0"><Icon size={16} /></span>
        <span class="min-w-0 flex-1 truncate collapsed:sr-only">{label}</span>
      </a>
    {/snippet}
  </Tooltip>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex shrink-0 flex-col gap-2 p-2">
    <div class="flex items-center gap-1 collapsed:flex-col">
      {#if selected}
        <DropdownMenu items={switchItems} label={m.shell_spaces()} side="bottom" align="start" class="min-w-56">
          {#snippet trigger(props)}
            <button
              {...props}
              type="button"
              data-testid="shell-workspace"
              class="flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control px-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 collapsed:w-10 collapsed:flex-none collapsed:justify-center collapsed:px-0"
            >
              <WorkspaceMark name={selected.name} logoAssetId={selected.logoAssetId} />
              <span class="min-w-0 flex-1 truncate text-left text-ui font-semibold text-ink collapsed:sr-only">
                {selected.name}<span class="sr-only">, {m.shell_switch_space()}</span>
              </span>
              <ChevronsUpDown size={14} aria-hidden="true" class="shrink-0 text-ink-muted collapsed:hidden" />
            </button>
          {/snippet}
        </DropdownMenu>
      {:else if status === 'error'}
        <span class="min-w-0 flex-1 px-2 text-2xs text-ink-muted collapsed:sr-only">{m.shell_spaces_error()}</span>
      {:else}
        <div class="flex h-10 min-w-0 flex-1 items-center gap-2 px-2 collapsed:w-10 collapsed:flex-none collapsed:px-2" aria-hidden="true">
          <Skeleton class="size-6 shrink-0" />
          <Skeleton class="h-4 flex-1 collapsed:hidden" />
        </div>
      {/if}
      {#if collapsible}
        <Tooltip text={collapsed ? m.shell_expand() : m.shell_collapse()} side="right">
          {#snippet children(props)}
            <button
              {...props}
              type="button"
              aria-label={collapsed ? m.shell_expand() : m.shell_collapse()}
              aria-expanded={!collapsed}
              onclick={ontogglecollapse}
              data-testid="shell-collapse"
              class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink"
            >
              {#if collapsed}<PanelLeftOpen size={16} aria-hidden="true" />{:else}<PanelLeftClose size={16} aria-hidden="true" />{/if}
            </button>
          {/snippet}
        </Tooltip>
      {/if}
    </div>
    <ShellSearch bind:open={searchOpen} {spaces} spacesStatus={status} templateSpace={selected} {collapsed} />
  </div>

  <nav aria-label={m.shell_nav()} class="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto scroll-thin px-2 pt-1 pb-3">
    <ul class="flex flex-col gap-0.5">
      <li>{@render row('/app', m.shell_recent(), Clock, tab === 'recientes')}</li>
      <li>{@render row('/app?pestana=compartidos', m.shell_shared(), Users, tab === 'compartidos')}</li>
      {#if selected}
        <li>{@render row(`/app/e/${selected.slug}?vista=plantillas`, m.shell_templates(), LayoutTemplate, view === 'plantillas')}</li>
      {/if}
      <li>
        <div class="flex items-center gap-0.5">
          {@render row('/app?pestana=favoritos', m.shell_favorites(), Star, tab === 'favoritos', 'flex-1')}
          <button
            type="button"
            aria-label={favorites.open ? m.shell_favorites_hide() : m.shell_favorites_show()}
            aria-expanded={favorites.open}
            aria-controls="{uid}-favorites"
            onclick={ontogglefavorites}
            class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink collapsed:hidden"
          >
            <ChevronRight size={14} aria-hidden="true" class={['transition-transform duration-(--dur-fast)', favorites.open ? 'rotate-90' : '']} />
          </button>
        </div>
        {#if favorites.open}
          <div id="{uid}-favorites" class="flex flex-col py-0.5 collapsed:hidden">
            {#if favorites.status === 'ready' && favorites.items.length}
              <ul aria-label={m.shell_favorites_list()} class="flex flex-col">
                {#each favorites.items as project (project.id)}
                  <li>
                    <a
                      href="/p/{project.id}"
                      class="flex h-7 min-w-0 items-center rounded-control pr-2 pl-8 text-ui text-ink-muted transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink"
                    >
                      <span class="truncate">{project.name}</span>
                    </a>
                  </li>
                {/each}
              </ul>
            {:else if favorites.status === 'ready'}
              <p class="py-1 pr-2 pl-8 text-2xs text-ink-muted">{m.shell_favorites_empty()}</p>
            {:else if favorites.status === 'error'}
              <p class="py-1 pr-2 pl-8 text-2xs text-ink-muted">{m.shell_favorites_error()}</p>
            {:else}
              <div class="flex flex-col gap-1.5 py-1 pr-2 pl-8" aria-hidden="true">
                <Skeleton class="h-3.5 w-32" />
                <Skeleton class="h-3.5 w-24" />
              </div>
            {/if}
          </div>
        {/if}
      </li>
    </ul>

    <section aria-labelledby="{uid}-spaces" class="flex flex-col gap-1">
      <div class="flex h-7 items-center justify-between pl-2 collapsed:justify-center collapsed:pl-0">
        <h2 id="{uid}-spaces" class="text-2xs font-semibold text-ink-muted collapsed:sr-only">{m.shell_spaces()}</h2>
        <button
          type="button"
          aria-label={m.shell_new_space()}
          onclick={oncreatespace}
          class="inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink collapsed:hidden"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <span aria-hidden="true" class="hidden h-px w-6 bg-edge/25 collapsed:block"></span>
      </div>
      {#if status === 'loading' || status === 'idle'}
        <div class="flex flex-col gap-1.5 px-2" aria-hidden="true">
          <Skeleton class="h-5 w-36 collapsed:w-6" />
          <Skeleton class="h-5 w-28 collapsed:w-6" />
        </div>
      {:else if status === 'error'}
        <p class="px-2 text-2xs text-ink-muted collapsed:sr-only">{m.shell_spaces_error()}</p>
      {:else}
        <ul aria-labelledby="{uid}-spaces" class="flex flex-col gap-2 collapsed:gap-0.5">
          {#each spaces as space (space.id)}
            {@const here = current === 'workspace' && pageSlug === space.slug}
            <li>
              <p id="{uid}-space-{space.id}" class="flex h-7 min-w-0 items-center gap-2 px-2 text-ui font-medium text-ink collapsed:hidden">
                <WorkspaceMark name={space.name} logoAssetId={space.logoAssetId} size="sm" />
                <span class="truncate">{space.name}</span>
              </p>
              <ul aria-labelledby="{uid}-space-{space.id}" class="flex flex-col gap-0.5">
                <li>
                  <Tooltip text={space.name} side="right" disabled={!collapsed}>
                    {#snippet children(props)}
                      <a
                        {...props}
                        href="/app/e/{space.slug}"
                        aria-label={m.shell_space_projects_of({ name: space.name })}
                        aria-current={here && view === 'proyectos' && !inTrash ? 'page' : undefined}
                        class={[rowClass(here && view === 'proyectos' && !inTrash), 'pl-8 collapsed:pl-0']}
                      >
                        <Folder size={16} aria-hidden="true" class="shrink-0 collapsed:hidden" />
                        <span class="hidden collapsed:inline-flex"><WorkspaceMark name={space.name} logoAssetId={space.logoAssetId} /></span>
                        <span class="min-w-0 flex-1 truncate collapsed:sr-only">{m.shell_space_projects()}</span>
                      </a>
                    {/snippet}
                  </Tooltip>
                </li>
                <li class="collapsed:hidden">
                  <a
                    href="/app/e/{space.slug}?filtro=trash"
                    aria-label={m.shell_space_trash_of({ name: space.name })}
                    aria-current={here && inTrash ? 'page' : undefined}
                    class={[rowClass(here && inTrash), 'pl-8']}
                  >
                    <Trash size={16} aria-hidden="true" class="shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{m.shell_space_trash()}</span>
                  </a>
                </li>
              </ul>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if trashed.length}
      <section aria-labelledby="{uid}-trashed" class="flex flex-col gap-1 collapsed:hidden">
        <h2 id="{uid}-trashed" class="flex h-7 items-center pl-2 text-2xs font-semibold text-ink-muted">{m.shell_trashed_spaces()}</h2>
        <ul aria-labelledby="{uid}-trashed" class="flex flex-col gap-0.5">
          {#each trashed as space (space.id)}
            <li class="flex min-w-0 items-center gap-2 rounded-control py-1 pr-1 pl-2">
              <div class="min-w-0 flex-1">
                <a href="/app/e/{space.slug}" class="block truncate rounded-xs text-ui text-ink-muted hover:text-ink">{space.name}</a>
                {#if space.purgeAt}
                  <p class="truncate text-2xs text-ink-muted">{m.shell_purge_on({ date: formatDate(space.purgeAt) })}</p>
                {/if}
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={restoring === space.slug}
                label={m.shell_restore_space({ name: space.name })}
                onclick={() => onrestore(space)}
              >
                {m.workspace_restore()}
              </Button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </nav>

  <div class="flex shrink-0 flex-col gap-0.5 border-t border-edge/25 p-2">
    {@render row('/app/ajustes', m.shell_settings_short(), Settings, current === 'settings')}
    {#if session.me}
      {@const me = session.me}
      <MenuList
        align="start"
        side="top"
        items={[
          { label: m.shell_settings_short(), onSelect: () => browser.assign('/app/ajustes') },
          { label: m.app_sign_out(), onSelect: () => void signOut() },
        ]}
      >
        {#snippet trigger(props)}
          <button
            {...props}
            type="button"
            data-testid="shell-account"
            class="flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-control px-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2 collapsed:w-10 collapsed:justify-center collapsed:px-0"
          >
            <Avatar name={me.user.name} src={avatar} size="nav" />
            <span aria-hidden="true" class="min-w-0 flex-1 truncate text-ui font-semibold text-ink collapsed:hidden">{me.user.name}</span>
          </button>
        {/snippet}
      </MenuList>
    {:else}
      <div class="flex h-10 items-center gap-2 px-1.5" aria-hidden="true">
        <Skeleton rounded="full" class="size-7 shrink-0" />
        <Skeleton class="h-4 flex-1 collapsed:hidden" />
      </div>
    {/if}
  </div>
</div>
