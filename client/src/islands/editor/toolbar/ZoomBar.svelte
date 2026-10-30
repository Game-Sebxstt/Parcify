<script lang="ts">
  import MapIcon from '@lucide/svelte/icons/map';
  import Focus from '@lucide/svelte/icons/focus';
  import Minus from '@lucide/svelte/icons/minus';
  import Percent from '@lucide/svelte/icons/percent';
  import Plus from '@lucide/svelte/icons/plus';
  import Redo from '@lucide/svelte/icons/redo-2';
  import Scan from '@lucide/svelte/icons/scan';
  import Undo from '@lucide/svelte/icons/undo-2';
  import { m } from '../../../paraglide/messages.js';
  import DropdownMenu, { type MenuEntry } from '../../../ui/DropdownMenu.svelte';
  import { MOD_ARIA, MOD_KEY } from '../layout/ui-keys.ts';
  import ToolButton from '../ToolButton.svelte';

  type Props = {
    zoom: number;
    canUndo: boolean;
    canRedo: boolean;
    readOnly: boolean;
    minimapOpen: boolean;
    onundo: () => void;
    onredo: () => void;
    onzoomin: () => void;
    onzoomout: () => void;
    onzoomreset: () => void;
    onfitall: () => void;
    onfitselection: () => void;
    onminimap: () => void;
  };

  let {
    zoom,
    canUndo,
    canRedo,
    readOnly,
    minimapOpen,
    onundo,
    onredo,
    onzoomin,
    onzoomout,
    onzoomreset,
    onfitall,
    onfitselection,
    onminimap,
  }: Props = $props();

  let open = $state(false);
  const percent = $derived(Math.round(zoom * 100));

  // El atajo va en su columna, así que los nombres no lo repiten entre paréntesis.
  const items = $derived.by<MenuEntry[]>(() => [
    { kind: 'item', id: 'zoom-in', label: m.editor_zoom_in(), icon: Plus, keys: `${MOD_KEY}++`, ariaKeys: `${MOD_ARIA}++`, onSelect: onzoomin },
    { kind: 'item', id: 'zoom-out', label: m.editor_zoom_out(), icon: Minus, keys: `${MOD_KEY}+−`, ariaKeys: `${MOD_ARIA}+-`, onSelect: onzoomout },
    { kind: 'separator', id: 'zoom-sep-1' },
    { kind: 'item', id: 'fit-all', label: m.editor_zoom_fit_all_name(), icon: Scan, keys: 'Shift+1', ariaKeys: 'Shift+1', onSelect: onfitall },
    {
      kind: 'item',
      id: 'fit-selection',
      label: m.editor_zoom_fit_selection_name(),
      icon: Focus,
      keys: 'Shift+2',
      ariaKeys: 'Shift+2',
      onSelect: onfitselection,
    },
    { kind: 'item', id: 'zoom-reset', label: m.editor_zoom_100(), icon: Percent, keys: `${MOD_KEY}+0`, ariaKeys: `${MOD_ARIA}+0`, onSelect: onzoomreset },
    { kind: 'separator', id: 'zoom-sep-2' },
    { kind: 'item', id: 'minimap', label: minimapOpen ? m.editor_minimap_hide() : m.editor_minimap_show(), icon: MapIcon, onSelect: onminimap },
  ]);
</script>

<div class="pointer-events-auto flex h-9 touch-pan-x touch-pan-y items-center gap-0.5 rounded-panel border border-edge/40 bg-surface-2 p-1 shadow-float">
  {#if !readOnly}
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_undo()} disabled={!canUndo} onclick={onundo}>
      <Undo size={16} aria-hidden="true" />
    </ToolButton>
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_redo()} disabled={!canRedo} onclick={onredo}>
      <Redo size={16} aria-hidden="true" />
    </ToolButton>
    <span aria-hidden="true" class="mx-1 h-5 w-px bg-edge/30"></span>
  {/if}
  <ToolButton variant="tool" size="sm" side="top" label={m.editor_zoom_out()} onclick={onzoomout}>
    <Minus size={16} aria-hidden="true" />
  </ToolButton>
  <DropdownMenu bind:open {items} label={m.editor_zoom_menu()} side="top" align="center" sideOffset={8} class="min-w-56">
    {#snippet trigger(props)}
      <button
        {...props}
        type="button"
        aria-label={m.editor_zoom_value({ value: percent })}
        class={[
          'inline-flex h-8 min-w-13 cursor-pointer items-center justify-center rounded-control px-2 text-xs tabular transition-colors duration-150',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
          'text-ink-muted hover:bg-petrol hover:text-ink',
        ].join(' ')}
      >
        {percent} %
      </button>
    {/snippet}
  </DropdownMenu>
  <ToolButton variant="tool" size="sm" side="top" label={m.editor_zoom_in()} onclick={onzoomin}>
    <Plus size={16} aria-hidden="true" />
  </ToolButton>
</div>
