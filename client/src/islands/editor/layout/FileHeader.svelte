<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import House from '@lucide/svelte/icons/house';
  import ImageDown from '@lucide/svelte/icons/image-down';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import Minimize from '@lucide/svelte/icons/minimize-2';
  import Mouse from '@lucide/svelte/icons/mouse';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import type { CollabState } from '../../../lib/collab.ts';
  import { m } from '../../../paraglide/messages.js';
  import DropdownMenu, { type MenuEntry } from '../../../ui/DropdownMenu.svelte';
  import Tooltip from '../../../ui/Tooltip.svelte';
  import type { UiKeys } from './ui-keys.ts';

  type Props = {
    name: string;
    canRename: boolean;
    collab: CollabState;
    // Pastilla del panel plegado: logo, nombre sin editar y el botón para desplegar.
    compact: boolean;
    canPublish: boolean;
    uiKeys: UiKeys;
    onrename: (name: string) => Promise<boolean>;
    // Se espera antes de salir al inicio (p. ej. la subida de la vista previa).
    onleave: () => Promise<void>;
    onexport: () => void;
    ondownload: () => void;
    onpublish: () => void;
    onminimize: () => void;
    onhide: () => void;
    onwheel: () => void;
    onshortcuts: () => void;
    ontoggle: () => void;
  };

  let {
    name,
    canRename,
    collab,
    compact,
    canPublish,
    uiKeys,
    onrename,
    onleave,
    onexport,
    ondownload,
    onpublish,
    onminimize,
    onhide,
    onwheel,
    onshortcuts,
    ontoggle,
  }: Props = $props();

  // Borrador editable que vuelve al nombre real cada vez que este cambia.
  let draft = $derived(name);
  let saving = $state(false);
  let leaving = false;

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

  const items = $derived.by<MenuEntry[]>(() => [
    { kind: 'item', id: 'home', label: m.editor_menu_home(), icon: House, onSelect: leave },
    { kind: 'separator', id: 'sep-file' },
    { kind: 'item', id: 'export', label: m.editor_menu_export_file(), icon: ImageDown, onSelect: onexport },
    { kind: 'item', id: 'download', label: m.editor_menu_download_local(), icon: Download, onSelect: ondownload },
    ...(canPublish ? [{ kind: 'item' as const, id: 'publish', label: m.publish_template_title(), icon: LayoutTemplate, onSelect: onpublish }] : []),
    { kind: 'separator', id: 'sep-ui' },
    {
      kind: 'item',
      id: 'minimize',
      label: m.editor_menu_minimize_ui(),
      icon: Minimize,
      keys: uiKeys.minimize,
      ariaKeys: uiKeys.minimizeAria,
      onSelect: onminimize,
    },
    { kind: 'item', id: 'hide', label: m.editor_menu_hide_ui(), icon: EyeOff, keys: uiKeys.hide, ariaKeys: uiKeys.hideAria, onSelect: onhide },
    { kind: 'separator', id: 'sep-prefs' },
    { kind: 'item', id: 'wheel', label: m.editor_menu_wheel(), icon: Mouse, onSelect: onwheel },
    { kind: 'item', id: 'shortcuts', label: m.editor_menu_shortcuts(), icon: Keyboard, onSelect: onshortcuts },
  ]);

  async function commit() {
    const next = draft.trim();
    if (!next || next === name) {
      draft = name;
      return;
    }
    saving = true;
    const ok = await onrename(next);
    saving = false;
    if (!ok) draft = name;
  }
</script>

{#snippet logo()}
  <DropdownMenu {items} label={m.editor_file_menu()} side="bottom" align="start" class="min-w-60">
    {#snippet trigger(props)}
      <button
        {...props}
        type="button"
        aria-label={m.editor_file_menu()}
        class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control transition-colors duration-(--dur-fast) hover:bg-petrol data-[state=open]:bg-petrol"
        data-testid="file-menu"
      >
        <img src="/brand/Logo-no-background-no-text.png" alt="" width="20" height="20" class="size-5" />
      </button>
    {/snippet}
  </DropdownMenu>
{/snippet}

{#snippet status(visible: boolean)}
  <p role="status" aria-live="polite" class="flex min-w-0 items-center gap-1.5 text-2xs text-ink-muted" data-testid="connection-status">
    <span aria-hidden="true" class={['size-1.5 shrink-0 rounded-full', dotClass]}></span>
    <span class={visible ? 'truncate' : 'sr-only'}>{statusText}</span>
  </p>
{/snippet}

{#snippet toggle()}
  <Tooltip text={compact ? m.editor_panel_expand_left() : m.editor_panel_collapse_left()} side="bottom">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-label={compact ? m.editor_panel_expand_left() : m.editor_panel_collapse_left()}
        aria-expanded={!compact}
        onclick={ontoggle}
        class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-petrol hover:text-ink"
        data-testid="left-panel-toggle"
      >
        {#if compact}<PanelLeftOpen size={16} aria-hidden="true" />{:else}<PanelLeftClose size={16} aria-hidden="true" />{/if}
      </button>
    {/snippet}
  </Tooltip>
{/snippet}

{#if compact}
  <div class="flex h-10 items-center gap-1.5 pr-1 pl-1">
    {@render logo()}
    <div class="flex min-w-0 items-center gap-1.5">
      {@render status(false)}
      <span class="max-w-50 truncate text-ui font-semibold">{name}</span>
    </div>
    {@render toggle()}
  </div>
{:else}
  <div class="flex h-12 shrink-0 items-center gap-1.5 pr-2 pl-2">
    {@render logo()}
    <div class="flex min-w-0 flex-1 flex-col">
      {#if canRename}
        <input
          aria-label={m.editor_name_label()}
          bind:value={draft}
          maxlength={80}
          disabled={saving}
          onblur={commit}
          onkeydown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              draft = name;
              event.currentTarget.blur();
            }
          }}
          class="-ml-1 h-6 min-w-0 truncate rounded-control bg-transparent px-1 text-ui font-semibold text-ink hover:bg-surface-2 focus:bg-surface-2"
        />
      {:else}
        <h1 class="truncate text-ui font-semibold">{name}</h1>
      {/if}
      <div class="flex min-w-0 items-center gap-2">
        {@render status(true)}
        {#if collab.readOnly}
          <span class="shrink-0 rounded-xs bg-petrol px-1.5 text-2xs font-medium">{m.editor_read_only()}</span>
        {/if}
      </div>
    </div>
    {@render toggle()}
  </div>
{/if}
