<script lang="ts" module>
  type Entry =
    | { kind: 'item'; id: string; label: string; keys?: string; aria?: string; disabled?: boolean; reason?: string; danger?: boolean; run?: () => void }
    | { kind: 'separator'; id: string };
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ContextMenuRequest, Engine } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import { showToast } from '../../ui/toast.svelte.ts';

  type Props = {
    engine: Engine;
    request: ContextMenuRequest;
    readOnly: boolean;
    onclose: (returnFocus: boolean) => void;
    onanimate: () => void;
    oncopypng: () => void;
    onexport: () => void;
  };

  let { engine, request, readOnly, onclose, onanimate, oncopypng, onexport }: Props = $props();

  const uid = $props.id();
  const MARGIN = 8;
  let list = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);

  const pasteFailed = () => showToast({ message: m.editor_paste_error(), tone: 'error' });

  // Lo que hay seleccionado al abrir (el clic derecho ya la ajustó).
  const entries = $derived.by((): Entry[] => {
    const records = engine.state.selectionRecords.get();
    const selected = records.length > 0;
    const editable = !readOnly;
    const containers = records.some((record) => record.type === 'group' || record.type === 'frame');
    const allLocked = selected && records.every((record) => record.locked);
    const commands = engine.commands;
    const at = request.at;
    return [
    { kind: 'item', id: 'cut', label: m.editor_menu_cut(), keys: 'Ctrl+X', aria: 'Control+X', disabled: !selected || !editable, run: () => void engine.clipboard.cut() },
    { kind: 'item', id: 'copy', label: m.editor_menu_copy(), keys: 'Ctrl+C', aria: 'Control+C', disabled: !selected, run: () => void engine.clipboard.copy() },
    {
      kind: 'item',
      id: 'paste',
      label: m.editor_menu_paste(),
      keys: 'Ctrl+V',
      aria: 'Control+V',
      disabled: !editable,
      run: () =>
        void engine.clipboard.pasteFromSystem(at).then(
          (pasted) => {
            if (!pasted) pasteFailed();
          },
          pasteFailed,
        ),
    },
    { kind: 'item', id: 'duplicate', label: m.editor_menu_duplicate(), keys: 'Ctrl+D', aria: 'Control+D', disabled: !selected || !editable, run: () => commands.duplicateSelection() },
    { kind: 'item', id: 'delete', label: m.editor_menu_delete(), keys: 'Supr', aria: 'Delete', danger: true, disabled: !selected || !editable, run: () => commands.deleteSelection() },
    { kind: 'separator', id: 'sep-order' },
    { kind: 'item', id: 'front', label: m.editor_order_front(), keys: 'Ctrl+Shift+]', aria: 'Control+Shift+]', disabled: !selected || !editable, run: () => commands.zOrder('front') },
    { kind: 'item', id: 'forward', label: m.editor_order_forward(), keys: 'Ctrl+]', aria: 'Control+]', disabled: !selected || !editable, run: () => commands.zOrder('forward') },
    { kind: 'item', id: 'backward', label: m.editor_order_backward(), keys: 'Ctrl+[', aria: 'Control+[', disabled: !selected || !editable, run: () => commands.zOrder('backward') },
    { kind: 'item', id: 'back', label: m.editor_order_back(), keys: 'Ctrl+Shift+[', aria: 'Control+Shift+[', disabled: !selected || !editable, run: () => commands.zOrder('back') },
    { kind: 'separator', id: 'sep-group' },
    { kind: 'item', id: 'group', label: m.editor_menu_group(), keys: 'Ctrl+G', aria: 'Control+G', disabled: !selected || !editable, run: () => void commands.groupSelection() },
    { kind: 'item', id: 'ungroup', label: m.editor_menu_ungroup(), keys: 'Ctrl+Shift+G', aria: 'Control+Shift+G', disabled: !containers || !editable, run: () => void commands.ungroupSelection() },
    {
      kind: 'item',
      id: 'lock',
      label: allLocked ? m.editor_menu_unlock() : m.editor_menu_lock(),
      keys: 'Ctrl+Shift+L',
      aria: 'Control+Shift+L',
      disabled: !selected || !editable,
      run: () => commands.setLocked(!allLocked),
    },
    { kind: 'item', id: 'hide', label: m.editor_menu_hide(), disabled: !selected || !editable, run: () => commands.setVisible(false) },
    { kind: 'separator', id: 'sep-export' },
    { kind: 'item', id: 'copy-png', label: m.editor_menu_copy_png(), disabled: !selected, run: oncopypng },
    { kind: 'item', id: 'export', label: m.editor_menu_export(), disabled: !selected, run: onexport },
    { kind: 'item', id: 'animate', label: m.editor_menu_animate(), disabled: !selected || !editable, run: onanimate },
    ];
  });

  const items = () => [...(list?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  onMount(() => {
    void place();
  });

  // Se abre en el puntero y se recoloca dentro de la ventana; el foco va a la primera entrada que se puede usar.
  async function place() {
    left = request.clientX;
    top = request.clientY;
    await tick();
    if (!list) return;
    const box = list.getBoundingClientRect();
    left = Math.max(MARGIN, Math.min(request.clientX, window.innerWidth - box.width - MARGIN));
    top = Math.max(MARGIN, Math.min(request.clientY, window.innerHeight - box.height - MARGIN));
    const all = items();
    (all.find((item) => item.getAttribute('aria-disabled') !== 'true') ?? all[0])?.focus();
  }

  function choose(entry: Entry) {
    if (entry.kind !== 'item' || entry.disabled || !entry.run) return;
    onclose(true);
    entry.run();
  }

  function onKey(event: KeyboardEvent) {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      all[(next + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onclose(true);
    }
  }
</script>

<svelte:window
  onpointerdown={(event) => {
    if (list && !list.contains(event.target as Node)) onclose(false);
  }}
  onblur={() => onclose(false)}
  onresize={() => onclose(false)}
/>

<div
  bind:this={list}
  role="menu"
  tabindex="-1"
  aria-label={m.editor_menu_label()}
  data-own-keys
  onkeydown={onKey}
  oncontextmenu={(event) => event.preventDefault()}
  style:left="{left}px"
  style:top="{top}px"
  class="fixed z-50 w-64 rounded-panel bg-surface-2 p-1 text-sm text-ink shadow-float"
  data-testid="context-menu"
>
  {#each entries as entry (entry.id)}
    {#if entry.kind === 'separator'}
      <div role="separator" class="mx-2 my-1 h-px bg-petrol"></div>
    {:else}
      <div
        role="menuitem"
        tabindex="-1"
        aria-disabled={entry.disabled || undefined}
        aria-keyshortcuts={entry.aria}
        aria-describedby={entry.reason ? `${uid}-${entry.id}-reason` : undefined}
        onclick={() => choose(entry)}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            choose(entry);
          }
        }}
        class={[
          'flex min-h-9 cursor-pointer items-center gap-3 rounded-[6px] px-3 py-1.5 outline-none select-none hover:bg-petrol focus:bg-petrol',
          'aria-disabled:cursor-not-allowed',
          entry.danger && !entry.disabled ? 'text-danger' : '',
        ].join(' ')}
      >
        <span class="flex min-w-0 flex-1 flex-col">
          <span class={entry.disabled ? 'text-ink-muted' : ''}>{entry.label}</span>
          {#if entry.reason}
            <span id="{uid}-{entry.id}-reason" class="text-xs text-ink-muted">{entry.reason}</span>
          {/if}
        </span>
        {#if entry.keys}
          <span aria-hidden="true" class="shrink-0 text-xs text-ink-muted tabular">{entry.keys}</span>
        {/if}
      </div>
    {/if}
  {/each}
</div>
