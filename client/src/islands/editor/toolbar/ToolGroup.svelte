<script lang="ts">
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Lock from '@lucide/svelte/icons/lock';
  import type { Tool } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import DropdownMenu, { type MenuEntry } from '../../../ui/DropdownMenu.svelte';
  import Tooltip from '../../../ui/Tooltip.svelte';
  import { IMAGE_SHORTCUT, toolAria, type ToolItem } from './tools.ts';

  type Props = {
    // Nombre del desplegable («Formas»); también es el nombre accesible del chevron.
    label: string;
    stop: string;
    tools: readonly ToolItem[];
    tool: Tool;
    locked: boolean;
    // La herramienta que muestra el botón: la activa si es del grupo, si no la última usada.
    shown: ToolItem;
    // Solo Formas lleva «Imagen» al final. Es una acción (hallazgo 12): no cambia el icono, no lleva marca ni se bloquea.
    onimage?: (() => void) | undefined;
    disabled?: boolean;
    tabindex: (stop: string) => number;
    onselect: (tool: Tool, locked?: boolean) => void;
  };

  let { label, stop, tools, tool, locked, shown, onimage, disabled = false, tabindex, onselect }: Props = $props();

  const LONG_PRESS_MS = 300;

  let open = $state(false);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  // La pulsación larga ya abrió el desplegable: el click que llega al soltar no activa la herramienta.
  let swallowClick = false;

  const active = $derived(tools.some((item) => item.id === tool));
  const ShownIcon = $derived(shown.icon);
  const menuStop = $derived(`${stop}-menu`);

  const items = $derived.by<MenuEntry[]>(() => {
    const entries: MenuEntry[] = tools.map((item) => ({
      kind: 'check',
      id: item.id,
      label: item.label(),
      icon: item.icon,
      keys: item.shortcut,
      ariaKeys: item.shortcut,
      checked: tool === item.id,
      onSelect: () => onselect(item.id),
    }));
    if (onimage) {
      entries.push({ kind: 'separator', id: `${stop}-image-sep` });
      entries.push({
        kind: 'item',
        id: `${stop}-image`,
        label: m.editor_tool_image(),
        icon: ImagePlus,
        keys: IMAGE_SHORTCUT,
        ariaKeys: 'Control+Shift+K',
        inset: true,
        onSelect: onimage,
      });
    }
    return entries;
  });

  function call(handler: unknown, event: Event) {
    if (typeof handler === 'function') handler(event);
  }

  function clearPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

  function onPointerDown(event: PointerEvent, props: Record<string, unknown>) {
    call(props.onpointerdown, event);
    if (disabled || event.button !== 0) return;
    swallowClick = false;
    clearPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      swallowClick = true;
      open = true;
    }, LONG_PRESS_MS);
  }

  function onPointerEnd(event: PointerEvent, handler: unknown) {
    call(handler, event);
    clearPress();
  }

  function onClick(event: MouseEvent, props: Record<string, unknown>) {
    call(props.onclick, event);
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    onselect(shown.id);
  }

  function onKeydown(event: KeyboardEvent, handler: unknown) {
    call(handler, event);
    if (event.key !== 'ArrowUp' || disabled) return;
    event.preventDefault();
    open = true;
  }
</script>

<div class={['flex items-center rounded-card', active ? 'bg-coral text-coral-ink' : ''].join(' ')}>
  <Tooltip text={shown.label()} kbd={shown.shortcut} side="top">
    {#snippet children(props)}
      <button
        {...props}
        type="button"
        aria-label={toolAria(shown)}
        aria-pressed={active}
        aria-keyshortcuts={shown.shortcut}
        {disabled}
        tabindex={tabindex(stop)}
        data-stop={stop}
        onpointerdown={(event) => onPointerDown(event, props)}
        onpointerup={(event) => onPointerEnd(event, props.onpointerup)}
        onpointerleave={(event) => onPointerEnd(event, props.onpointerleave)}
        onpointercancel={(event) => onPointerEnd(event, props.onpointercancel)}
        oncontextmenu={(event) => event.preventDefault()}
        onclick={(event) => onClick(event, props)}
        ondblclick={() => onselect(shown.id, true)}
        onkeydown={(event) => onKeydown(event, props.onkeydown)}
        class={[
          'relative inline-flex h-9 w-8 cursor-pointer touch-manipulation items-center justify-center rounded-l-card select-none',
          'transition-[color,background-color,scale] duration-120 active:scale-96 motion-reduce:active:scale-100',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
          active ? '' : 'text-ink-muted hover:bg-petrol hover:text-ink',
        ].join(' ')}
      >
        <span aria-hidden="true" class="inline-flex"><ShownIcon size={18} /></span>
        {#if locked && active}
          <span aria-hidden="true" class="absolute right-0.5 bottom-0.5 text-current"><Lock size={8} strokeWidth={3} /></span>
        {/if}
      </button>
    {/snippet}
  </Tooltip>
  <DropdownMenu bind:open {items} {label} side="top" align="start" sideOffset={8} focusFirst class="min-w-58">
    {#snippet trigger(props)}
      <button
        {...props}
        type="button"
        aria-label={label}
        {disabled}
        tabindex={tabindex(menuStop)}
        data-stop={menuStop}
        onkeydown={(event) => onKeydown(event, props.onkeydown)}
        class={[
          'inline-flex h-9 w-3.5 cursor-pointer items-center justify-center rounded-r-card transition-colors duration-120',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
          active ? '' : 'text-ink-muted hover:bg-petrol hover:text-ink',
        ].join(' ')}
      >
        <ChevronUp size={14} aria-hidden="true" />
      </button>
    {/snippet}
  </DropdownMenu>
</div>
