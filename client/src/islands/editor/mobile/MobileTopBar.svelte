<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { assetUrl } from '../../../lib/assets.ts';
  import type { CollabState } from '../../../lib/collab.ts';
  import { m } from '../../../paraglide/messages.js';
  import Avatar from '../../../ui/Avatar.svelte';
  import type { Collaborator } from '../layout/SessionBar.svelte';

  type Props = {
    name: string;
    canRename: boolean;
    collab: CollabState;
    people: Collaborator[];
    following: number | null;
    canUndo: boolean;
    canRedo: boolean;
    readOnly: boolean;
    menuOpen: boolean;
    // Alto en pantalla, con el área segura de arriba.
    height?: number;
    // Se espera antes de salir al inicio (la subida de la vista previa).
    onleave: () => Promise<void>;
    onrename: () => void;
    onundo: () => void;
    onredo: () => void;
    onfollow: (clientId: number | null) => void;
    onmenu: () => void;
  };

  let {
    name,
    canRename,
    collab,
    people,
    following,
    canUndo,
    canRedo,
    readOnly,
    menuOpen,
    height = $bindable(0),
    onleave,
    onrename,
    onundo,
    onredo,
    onfollow,
    onmenu,
  }: Props = $props();

  const MAX_AVATARS = 2;
  let leaving = false;
  let avatars = $state<Record<string, string | null>>({});

  $effect(() => {
    for (const person of people.slice(0, MAX_AVATARS)) {
      const id = person.avatarAssetId;
      if (!id || id in avatars) continue;
      avatars[id] = null;
      void assetUrl(id).then((url) => (avatars[id] = url));
    }
  });

  const statusText = $derived.by(() => {
    switch (collab.status) {
      case 'connected':
        return m.editor_status_connected();
      case 'reconnecting':
        return m.editor_status_reconnecting();
      case 'compacting':
        return m.editor_status_compacting();
      case 'offline':
        return collab.localCopy ? m.editor_status_offline_saved() : m.editor_status_offline_unsaved();
      default:
        return m.editor_status_connecting();
    }
  });
  const dotClass = $derived(collab.status === 'connected' ? 'bg-sage' : collab.status === 'offline' ? 'bg-danger' : 'bg-ink-muted');

  function leave() {
    if (leaving) return;
    leaving = true;
    void onleave().finally(() => window.location.assign('/app'));
  }

  const BUTTON =
    'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-card text-ink-muted transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
</script>

<!-- El único sitio con desenfoque de fondo: la barra se superpone al lienzo. -->
<header
  bind:offsetHeight={height}
  aria-label={m.editor_mobile_top_bar()}
  class="absolute inset-x-0 top-0 z-(--z-toolbar) touch-pan-x touch-pan-y border-b border-edge/25 bg-surface-1/95 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] backdrop-blur-sm"
  data-testid="mobile-top-bar"
>
  <div class="flex h-12 items-center gap-0.5 px-0.5">
    <button type="button" aria-label={m.editor_mobile_back()} onclick={leave} class={BUTTON}>
      <ArrowLeft size={20} aria-hidden="true" />
    </button>
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <p role="status" aria-live="polite" class="flex shrink-0 items-center pl-1" data-testid="connection-status">
        <span aria-hidden="true" class={['size-1.5 rounded-full', dotClass]}></span>
        <span class="sr-only">{statusText}</span>
      </p>
      {#if canRename}
        <button
          type="button"
          aria-label={m.editor_mobile_rename_project({ name })}
          aria-haspopup="dialog"
          onclick={onrename}
          class="flex h-11 min-w-0 cursor-pointer items-center rounded-card px-1.5 text-ui font-semibold text-ink hover:bg-surface-2"
          data-testid="mobile-project-name"
        >
          <span class="truncate">{name}</span>
        </button>
      {:else}
        <h1 class="min-w-0 truncate px-1.5 text-ui font-semibold">{name}</h1>
      {/if}
      {#if collab.readOnly}
        <span class="shrink-0 rounded-xs bg-petrol px-1.5 text-2xs font-medium">{m.editor_read_only()}</span>
      {/if}
    </div>
    <button type="button" aria-label={m.editor_mobile_undo()} aria-keyshortcuts="Control+Z" disabled={readOnly || !canUndo} onclick={onundo} class={BUTTON} data-testid="mobile-undo">
      <Undo2 size={20} aria-hidden="true" />
    </button>
    <button
      type="button"
      aria-label={m.editor_mobile_redo()}
      aria-keyshortcuts="Control+Shift+Z"
      disabled={readOnly || !canRedo}
      onclick={onredo}
      class={BUTTON}
      data-testid="mobile-redo"
    >
      <Redo2 size={20} aria-hidden="true" />
    </button>
    {#if people.length}
      <ul aria-label={m.editor_presence_label()} class="flex shrink-0 items-center">
        {#each people.slice(0, MAX_AVATARS) as person (person.id)}
          {@const active = following === person.clientId}
          <li>
            <button
              type="button"
              aria-label={m.editor_follow({ name: person.name })}
              aria-pressed={active}
              onclick={() => onfollow(active ? null : person.clientId)}
              class="inline-flex size-11 cursor-pointer items-center justify-center rounded-full"
            >
              <span style:--tw-ring-color={active ? person.color : undefined} class={['rounded-full ring-2', active ? '' : 'ring-transparent']}>
                <Avatar name={person.name} color={person.color} src={person.avatarAssetId ? (avatars[person.avatarAssetId] ?? null) : null} size="sm" />
              </span>
            </button>
          </li>
        {/each}
        {#if people.length > MAX_AVATARS}
          <li class="pr-1 text-2xs text-ink-muted tabular">
            <span aria-hidden="true">+{people.length - MAX_AVATARS}</span>
            <span class="sr-only">{m.editor_presence_more({ count: people.length - MAX_AVATARS })}</span>
          </li>
        {/if}
      </ul>
    {/if}
    <button
      type="button"
      aria-label={m.editor_mobile_menu()}
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      onclick={onmenu}
      class={[BUTTON, menuOpen ? 'bg-surface-2 text-ink' : '']}
      data-testid="mobile-menu"
    >
      <Ellipsis size={20} aria-hidden="true" />
    </button>
  </div>
</header>
