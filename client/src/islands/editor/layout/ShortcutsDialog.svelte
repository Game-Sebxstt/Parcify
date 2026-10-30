<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import Dialog from '../../../ui/Dialog.svelte';
  import { TOOLS } from '../toolbar/tools.ts';
  import { MOD_KEY, type UiKeys } from './ui-keys.ts';

  type Props = { open: boolean; uiKeys: UiKeys };

  let { open = $bindable(false), uiKeys }: Props = $props();

  const uid = $props.id();
  const mod = (key: string) => `${MOD_KEY}+${key}`;

  type Row = { label: string; keys: string };

  const groups = $derived<{ id: string; title: string; rows: Row[] }[]>([
    {
      id: 'tools',
      title: m.editor_shortcuts_tools(),
      rows: [
        ...TOOLS.filter((item) => item.shortcut).map((item) => ({ label: item.label(), keys: item.shortcut! })),
        { label: m.editor_tool_image(), keys: mod('Shift+K') },
      ],
    },
    {
      id: 'edit',
      title: m.editor_shortcuts_edit(),
      rows: [
        { label: m.editor_shortcut_undo(), keys: mod('Z') },
        { label: m.editor_shortcut_redo(), keys: mod('Shift+Z') },
        { label: m.editor_duplicate(), keys: mod('D') },
        { label: m.editor_menu_delete(), keys: m.editor_shortcut_delete_keys() },
        { label: m.editor_shortcut_select_all(), keys: mod('A') },
        { label: m.editor_menu_group(), keys: mod('G') },
        { label: m.editor_menu_ungroup(), keys: mod('Shift+G') },
        { label: m.editor_shortcut_lock(), keys: mod('Shift+L') },
        { label: m.editor_order_forward(), keys: mod(']') },
        { label: m.editor_order_backward(), keys: mod('[') },
        { label: m.editor_order_front(), keys: mod('Shift+]') },
        { label: m.editor_order_back(), keys: mod('Shift+[') },
        { label: m.editor_shortcut_save_version(), keys: mod('S') },
      ],
    },
    {
      id: 'view',
      title: m.editor_shortcuts_view(),
      rows: [
        { label: m.editor_zoom_in(), keys: mod('+') },
        { label: m.editor_zoom_out(), keys: mod('−') },
        { label: m.editor_zoom_fit_all_name(), keys: 'Shift+1' },
        { label: m.editor_zoom_fit_selection_name(), keys: 'Shift+2' },
        { label: m.editor_zoom_100(), keys: mod('0') },
        { label: m.editor_shortcut_pan(), keys: m.editor_shortcut_pan_keys() },
      ],
    },
    {
      id: 'ui',
      title: m.editor_shortcuts_ui(),
      rows: [
        { label: m.editor_menu_minimize_ui(), keys: uiKeys.minimize },
        { label: m.editor_menu_hide_ui(), keys: uiKeys.hide },
      ],
    },
  ]);
</script>

<Dialog bind:open title={m.editor_menu_shortcuts()}>
  <div class="scroll-thin -mr-2 flex max-h-[60dvh] flex-col gap-5 overflow-y-auto pr-2">
    {#each groups as group (group.id)}
      <section aria-labelledby="{uid}-{group.id}">
        <h3 id="{uid}-{group.id}" class="mb-1.5 text-xs font-semibold text-ink-muted">{group.title}</h3>
        <dl class="flex flex-col">
          {#each group.rows as row (row.label)}
            <div class="flex min-h-8 items-center justify-between gap-4 border-b border-edge/25 text-ui last:border-b-0">
              <dt class="min-w-0 truncate">{row.label}</dt>
              <dd><kbd class="rounded-xs bg-petrol px-1.5 py-0.5 font-sans text-2xs text-ink tabular">{row.keys}</kbd></dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
</Dialog>
