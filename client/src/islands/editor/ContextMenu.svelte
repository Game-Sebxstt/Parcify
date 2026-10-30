<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import BringToFront from '@lucide/svelte/icons/bring-to-front';
  import CircleMinus from '@lucide/svelte/icons/circle-minus';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import Copy from '@lucide/svelte/icons/copy';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Download from '@lucide/svelte/icons/download';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Film from '@lucide/svelte/icons/film';
  import Group from '@lucide/svelte/icons/group';
  import ImageIcon from '@lucide/svelte/icons/image';
  import Layers from '@lucide/svelte/icons/layers';
  import Lock from '@lucide/svelte/icons/lock';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Scissors from '@lucide/svelte/icons/scissors';
  import SendToBack from '@lucide/svelte/icons/send-to-back';
  import Trash from '@lucide/svelte/icons/trash';
  import Ungroup from '@lucide/svelte/icons/ungroup';
  import type { ContextMenuRequest, Engine } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import type { MenuEntry } from '../../ui/DropdownMenu.svelte';
  import PointMenu from '../../ui/PointMenu.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';

  type Props = {
    engine: Engine;
    request: ContextMenuRequest;
    readOnly: boolean;
    onclose: (returnFocus: boolean) => void;
    onanimate: () => void;
    oncopypng: () => void;
    onexport: () => void;
    onrename: (id: string) => void;
  };

  let { engine, request, readOnly, onclose, onanimate, oncopypng, onexport, onrename }: Props = $props();

  const pasteFailed = () => showToast({ message: m.editor_paste_error(), tone: 'error' });

  // Lo que hay seleccionado al abrir (el clic derecho o la pulsación larga ya la ajustaron).
  const entries = $derived.by((): MenuEntry[] => {
    const records = engine.state.selectionRecords.get();
    const selected = records.length > 0;
    const editable = !readOnly;
    const containers = records.some((record) => record.type === 'group' || record.type === 'frame');
    const allLocked = selected && records.every((record) => record.locked);
    const single = records.length === 1 ? records[0]! : null;
    const commands = engine.commands;
    const at = request.at;
    const off = !selected || !editable;
    // El clic derecho o la pulsación larga sobre un vértice lo dejaron marcado.
    const vertex = engine.state.activeVertex.get();
    const point: MenuEntry[] =
      vertex && editable && single?.id === vertex.id
        ? [
            { kind: 'item', id: 'delete-point', label: m.editor_point_delete(), icon: CircleMinus, keys: 'Supr', ariaKeys: 'Delete', onSelect: () => void commands.removeVertex(vertex.id, vertex.index) },
            { kind: 'separator', id: 'sep-point' },
          ]
        : [];
    return [
      ...point,
      { kind: 'item', id: 'cut', label: m.editor_menu_cut(), icon: Scissors, keys: 'Ctrl+X', ariaKeys: 'Control+X', disabled: off, onSelect: () => void engine.clipboard.cut() },
      { kind: 'item', id: 'copy', label: m.editor_menu_copy(), icon: Copy, keys: 'Ctrl+C', ariaKeys: 'Control+C', disabled: !selected, onSelect: () => void engine.clipboard.copy() },
      {
        kind: 'item',
        id: 'paste',
        label: m.editor_menu_paste(),
        icon: ClipboardPaste,
        keys: 'Ctrl+V',
        ariaKeys: 'Control+V',
        disabled: !editable,
        onSelect: () =>
          void engine.clipboard.pasteFromSystem(at).then(
            (pasted) => {
              if (!pasted) pasteFailed();
            },
            pasteFailed,
          ),
      },
      { kind: 'item', id: 'duplicate', label: m.editor_menu_duplicate(), icon: CopyPlus, keys: 'Ctrl+D', ariaKeys: 'Control+D', disabled: off, onSelect: () => commands.duplicateSelection() },
      ...(single
        ? [{ kind: 'item', id: 'rename', label: m.editor_menu_rename(), icon: PencilLine, disabled: !editable, onSelect: () => onrename(single.id) } satisfies MenuEntry]
        : []),
      {
        kind: 'item',
        id: 'delete',
        label: m.editor_menu_delete(),
        icon: Trash,
        ...(point.length ? {} : { keys: 'Supr', ariaKeys: 'Delete' }),
        danger: true,
        disabled: off,
        onSelect: () => commands.deleteNodes(),
      },
      { kind: 'separator', id: 'sep-order' },
      {
        kind: 'sub',
        id: 'order',
        label: m.editor_menu_order(),
        icon: Layers,
        disabled: off,
        items: [
          { kind: 'item', id: 'front', label: m.editor_order_front(), icon: BringToFront, keys: 'Ctrl+Shift+]', ariaKeys: 'Control+Shift+]', onSelect: () => commands.zOrder('front') },
          { kind: 'item', id: 'forward', label: m.editor_order_forward(), icon: ArrowUp, keys: 'Ctrl+]', ariaKeys: 'Control+]', onSelect: () => commands.zOrder('forward') },
          { kind: 'item', id: 'backward', label: m.editor_order_backward(), icon: ArrowDown, keys: 'Ctrl+[', ariaKeys: 'Control+[', onSelect: () => commands.zOrder('backward') },
          { kind: 'item', id: 'back', label: m.editor_order_back(), icon: SendToBack, keys: 'Ctrl+Shift+[', ariaKeys: 'Control+Shift+[', onSelect: () => commands.zOrder('back') },
        ],
      },
      { kind: 'item', id: 'group', label: m.editor_menu_group(), icon: Group, keys: 'Ctrl+G', ariaKeys: 'Control+G', disabled: off, onSelect: () => void commands.groupSelection() },
      {
        kind: 'item',
        id: 'ungroup',
        label: m.editor_menu_ungroup(),
        icon: Ungroup,
        keys: 'Ctrl+Shift+G',
        ariaKeys: 'Control+Shift+G',
        disabled: !containers || !editable,
        onSelect: () => void commands.ungroupSelection(),
      },
      {
        kind: 'item',
        id: 'lock',
        label: allLocked ? m.editor_menu_unlock() : m.editor_menu_lock(),
        icon: allLocked ? LockOpen : Lock,
        keys: 'Ctrl+Shift+L',
        ariaKeys: 'Control+Shift+L',
        disabled: off,
        onSelect: () => commands.setLocked(!allLocked),
      },
      { kind: 'item', id: 'hide', label: m.editor_menu_hide(), icon: EyeOff, disabled: off, onSelect: () => commands.setVisible(false) },
      { kind: 'separator', id: 'sep-export' },
      { kind: 'item', id: 'copy-png', label: m.editor_menu_copy_png(), icon: ImageIcon, disabled: !selected, onSelect: oncopypng },
      { kind: 'item', id: 'export', label: m.editor_menu_export(), icon: Download, disabled: !selected, onSelect: onexport },
      { kind: 'item', id: 'animate', label: m.editor_menu_animate(), icon: Film, disabled: off, onSelect: onanimate },
    ];
  });
</script>

<PointMenu
  items={entries}
  at={{ x: request.clientX, y: request.clientY }}
  {onclose}
  label={m.editor_menu_label()}
  testid="context-menu"
  class="w-64"
/>
