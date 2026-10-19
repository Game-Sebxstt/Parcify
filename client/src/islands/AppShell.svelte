<script lang="ts">
  import House from '@lucide/svelte/icons/house';
  import Menu from '@lucide/svelte/icons/menu';
  import Plus from '@lucide/svelte/icons/plus';
  import Settings from '@lucide/svelte/icons/settings';
  import X from '@lucide/svelte/icons/x';
  import { onMount } from 'svelte';
  import { ApiError, apiFetch, browser } from '../lib/api.ts';
  import { assetUrl } from '../lib/assets.ts';
  import { formatDate } from '../lib/format.ts';
  import { loadSession, session, signOut } from '../lib/session.svelte.ts';
  import { activeWorkspaces, loadWorkspaces, trashedWorkspaces, workspaces } from '../lib/workspaces.svelte.ts';
  import { m } from '../paraglide/messages.js';
  import { WorkspaceDetailSchema } from '../shared/api/workspaces.js';
  import Avatar from '../ui/Avatar.svelte';
  import Button from '../ui/Button.svelte';
  import MenuList from '../ui/Menu.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import { showToast } from '../ui/toast.svelte.ts';
  import NameDialog from './dashboard/NameDialog.svelte';

  type Props = { current: 'home' | 'workspace' | 'settings' };
  let { current }: Props = $props();

  let activeSlug = $state<string | null>(null);
  let drawerOpen = $state(false);
  let createOpen = $state(false);
  let restoring = $state<string | null>(null);
  let avatar = $state<string | null>(null);

  const active = $derived(activeWorkspaces());
  const trashed = $derived(trashedWorkspaces());

  onMount(() => {
    activeSlug = /^\/app\/e\/([a-z0-9-]{1,48})\/?$/.exec(window.location.pathname)?.[1] ?? null;
    void loadSession();
    void loadWorkspaces();
  });

  $effect(() => {
    const id = session.me?.user.avatarAssetId;
    avatar = null;
    if (id) void assetUrl(id).then((url) => (avatar = url));
  });

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

  async function restore(slug: string, name: string) {
    restoring = slug;
    try {
      await apiFetch(`/v1/workspaces/${encodeURIComponent(slug)}/restore`, { method: 'POST', schema: WorkspaceDetailSchema });
      await loadWorkspaces({ force: true });
      showToast({ message: m.workspace_restored({ name }), tone: 'success' });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    } finally {
      restoring = null;
    }
  }

  const linkClass = (selected: boolean) =>
    [
      'flex h-9 items-center gap-2.5 rounded-panel px-2.5 text-sm',
      selected ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
    ].join(' ');
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && drawerOpen) drawerOpen = false;
  }}
/>

<div class="flex h-14 items-center gap-2 bg-surface-1 px-3 md:hidden">
  <button
    type="button"
    aria-label={m.shell_open_menu()}
    aria-expanded={drawerOpen}
    aria-controls="app-sidebar"
    onclick={() => (drawerOpen = true)}
    class="inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2"
  >
    <Menu size={20} aria-hidden="true" />
  </button>
  <a href="/app" class="flex items-center gap-2 font-bold">
    <img src="/brand/Logo-no-background-no-text.png" alt="" width="24" height="24" class="size-6" />
    {m.brand_name()}
  </a>
</div>

{#if drawerOpen}
  <button
    type="button"
    tabindex="-1"
    aria-hidden="true"
    class="fixed inset-0 z-30 bg-ground/70 md:hidden"
    onclick={() => (drawerOpen = false)}
  ></button>
{/if}

<aside
  id="app-sidebar"
  aria-label={m.shell_label()}
  class={[
    'fixed inset-y-0 left-0 z-40 w-64 flex-col overscroll-contain bg-surface-1 md:sticky md:top-0 md:flex md:h-dvh',
    drawerOpen ? 'flex shadow-float' : 'hidden',
  ].join(' ')}
>
  <div class="flex h-14 shrink-0 items-center justify-between px-4">
    <a href="/app" class="flex items-center gap-2 font-bold tracking-[-0.02em]">
      <img src="/brand/Logo-no-background-no-text.png" alt="" width="24" height="24" class="size-6" />
      {m.brand_name()}
    </a>
    <button
      type="button"
      aria-label={m.shell_close_menu()}
      onclick={() => (drawerOpen = false)}
      class="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink md:hidden"
    >
      <X size={18} aria-hidden="true" />
    </button>
  </div>

  <nav aria-label={m.shell_nav()} class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-2 pb-4">
    <ul class="flex flex-col gap-0.5">
      <li>
        <a href="/app" class={linkClass(current === 'home')} aria-current={current === 'home' ? 'page' : undefined}>
          <House size={16} aria-hidden="true" />{m.shell_home()}
        </a>
      </li>
      <li>
        <a href="/app/ajustes" class={linkClass(current === 'settings')} aria-current={current === 'settings' ? 'page' : undefined}>
          <Settings size={16} aria-hidden="true" />{m.shell_settings()}
        </a>
      </li>
    </ul>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between pr-1 pl-2.5">
        <h2 id="spaces-nav" class="text-sm font-semibold text-ink">{m.shell_spaces()}</h2>
        <button
          type="button"
          aria-label={m.shell_new_space()}
          onclick={() => (createOpen = true)}
          class="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {#if workspaces.status === 'loading' || workspaces.status === 'idle'}
        <div class="flex flex-col gap-1.5 px-2.5" aria-hidden="true">
          <Skeleton class="h-6 w-40" />
          <Skeleton class="h-6 w-32" />
        </div>
      {:else if workspaces.status === 'error'}
        <p class="px-2.5 text-sm text-ink-muted">{m.shell_spaces_error()}</p>
      {:else}
        <ul aria-labelledby="spaces-nav" class="flex flex-col gap-0.5">
          {#each active as workspace (workspace.id)}
            {@const selected = current === 'workspace' && activeSlug === workspace.slug}
            <li>
              <a href="/app/e/{workspace.slug}" class={linkClass(selected)} aria-current={selected ? 'page' : undefined}>
                <span class="truncate">{workspace.name}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if trashed.length}
      <div class="flex flex-col gap-1">
        <h2 id="trash-nav" class="pl-2.5 text-sm font-semibold text-ink">{m.shell_trash()}</h2>
        <ul aria-labelledby="trash-nav" class="flex flex-col gap-1">
          {#each trashed as workspace (workspace.id)}
            <li class="flex items-center gap-2 rounded-panel px-2.5 py-1.5">
              <div class="min-w-0 flex-1">
                <a href="/app/e/{workspace.slug}" class="block truncate text-sm text-ink-muted hover:text-ink">{workspace.name}</a>
                {#if workspace.purgeAt}
                  <p class="text-xs text-ink-muted">{m.shell_purge_on({ date: formatDate(workspace.purgeAt) })}</p>
                {/if}
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={restoring === workspace.slug}
                label={m.shell_restore_space({ name: workspace.name })}
                onclick={() => void restore(workspace.slug, workspace.name)}
              >
                {m.workspace_restore()}
              </Button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </nav>

  <div class="shrink-0 p-2">
    {#if session.me}
      {@const me = session.me}
      <MenuList
        align="start"
        side="top"
        items={[
          { label: m.shell_settings(), onSelect: () => browser.assign('/app/ajustes') },
          { label: m.app_sign_out(), onSelect: () => void signOut() },
        ]}
      >
        {#snippet trigger(props)}
          <button
            {...props}
            type="button"
            class="flex w-full cursor-pointer items-center gap-2.5 rounded-panel px-2 py-2 text-left hover:bg-surface-2"
          >
            <Avatar name={me.user.name} src={avatar} />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{me.user.name}</span>
              <span class="block truncate text-xs text-ink-muted">{me.user.email}</span>
            </span>
          </button>
        {/snippet}
      </MenuList>
    {:else}
      <div class="flex items-center gap-2.5 px-2 py-2" aria-hidden="true">
        <Skeleton rounded="full" class="size-8" />
        <Skeleton class="h-4 w-32" />
      </div>
    {/if}
  </div>
</aside>

<NameDialog
  bind:open={createOpen}
  title={m.shell_new_space_title()}
  label={m.shell_space_name()}
  submitLabel={m.shell_create_space()}
  onsubmit={createWorkspace}
/>
