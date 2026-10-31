<script lang="ts">
  import Film from '@lucide/svelte/icons/film';
  import Images from '@lucide/svelte/icons/images';
  import type { Tool } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import { CHECKER } from '../../../ui/color.ts';
  import Tooltip from '../../../ui/Tooltip.svelte';
  import ToolButton from '../ToolButton.svelte';
  import ToolGroup from './ToolGroup.svelte';
  import { toolAria, toolById, toolsOf, type ToolItem } from './tools.ts';

  type Props = {
    tool: Tool;
    toolLocked: boolean;
    readOnly: boolean;
    gallery: boolean;
    timelineOpen: boolean;
    timelineLoading: boolean;
    // Punto danger mientras se graba (Grabar encendido con la línea de tiempo abierta).
    recording?: boolean;
    aiAvailable: boolean;
    aiOpen: boolean;
    // Móvil: barra inferior a todo el ancho con botones de 44 px y scroll horizontal.
    dock?: boolean;
    // El último puntero fue un dedo: los desplegables de grupo terminan con «Mantener herramienta».
    touch?: boolean;
    // Con selección en el móvil: el botón «Propiedades» a la derecha, con la muestra del relleno (null sin relleno).
    properties?: { fill: string | null; open: boolean } | null;
    onselect: (tool: Tool, locked?: boolean) => void;
    onimage: () => void;
    ongallery: () => void;
    onanimate: () => void;
    onai: () => void;
    onproperties?: () => void;
  };

  let {
    tool,
    toolLocked,
    readOnly,
    gallery,
    timelineOpen,
    timelineLoading,
    recording = false,
    aiAvailable,
    aiOpen,
    dock = false,
    touch = false,
    properties = null,
    onselect,
    onimage,
    ongallery,
    onanimate,
    onai,
    onproperties,
  }: Props = $props();

  const NAVIGATION = toolsOf('navigation');
  const SHAPES = toolsOf('shapes');
  const LINES = toolsOf('lines');
  const FRAME = toolById('frame');
  const TEXT = toolById('text');
  const EDIT_STOPS = new Set(['frame', 'shapes', 'shapes-menu', 'lines', 'lines-menu', 'text']);
  // Sin color: muestra con tablero y una diagonal.
  const NONE = `linear-gradient(to top right, transparent calc(50% - 0.75px), var(--color-ink-muted) 50%, transparent calc(50% + 0.75px)), ${CHECKER}`;

  // Cada grupo muestra su herramienta activa o, si no, la última que se usó (también por atajo de teclado).
  // `last` no es reactivo: solo cambia dentro del derivado, que ya se recalcula cuando cambia `tool`.
  function remembered(tools: readonly ToolItem[]) {
    let last = tools[0]!;
    return (current: Tool) => {
      last = tools.find((item) => item.id === current) ?? last;
      return last;
    };
  }
  const navigationShown = remembered(NAVIGATION);
  const shapeShown = remembered(SHAPES);
  const lineShown = remembered(LINES);
  const shownNavigation = $derived(navigationShown(tool));
  const shownShape = $derived(shapeShown(tool));
  const shownLine = $derived(lineShown(tool));

  const size = $derived(dock ? 'lg' : 'md');
  const iconSize = $derived(dock ? 20 : 18);

  // Tabindex itinerante: solo un botón de la barra entra en el orden de Tab; ← y → recorren el resto.
  let current = $state('select');
  const focusable = $derived(
    (readOnly && EDIT_STOPS.has(current)) ||
      (current === 'animate' && timelineLoading) ||
      (current === 'ai' && !aiAvailable) ||
      (current === 'properties' && !properties)
      ? 'select'
      : current,
  );
  const tabindex = (stop: string) => (stop === focusable ? 0 : -1);

  function stops(bar: HTMLElement): HTMLElement[] {
    return [...bar.querySelectorAll<HTMLElement>('[data-stop]')].filter((el) => !(el as HTMLButtonElement).disabled);
  }

  function onFocusIn(event: FocusEvent) {
    const stop = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-stop]')?.dataset.stop;
    if (stop) current = stop;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onselect('select');
      return;
    }
    const keys: Record<string, (index: number, count: number) => number> = {
      ArrowRight: (index, count) => (index + 1) % count,
      ArrowLeft: (index, count) => (index - 1 + count) % count,
      Home: () => 0,
      End: (_index, count) => count - 1,
    };
    const step = keys[event.key];
    if (!step) return;
    const list = stops(event.currentTarget as HTMLElement);
    if (!list.length) return;
    event.preventDefault();
    const index = list.findIndex((el) => el === document.activeElement);
    const next = list[step(Math.max(0, index), list.length)]!;
    current = next.dataset.stop ?? 'select';
    next.focus();
  }

  const lockedTool = (id: Tool) => toolLocked && tool === id;
</script>

{#snippet separator()}
  <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge/30"></span>
{/snippet}

{#snippet tools()}
  <ToolGroup
    label={m.editor_tool_navigation()}
    stop="select"
    tools={NAVIGATION}
    {tool}
    locked={false}
    shown={shownNavigation}
    {tabindex}
    {dock}
    {onselect}
  />

  {@render separator()}

  <ToolButton
    variant="tool"
    {size}
    side="top"
    label={toolAria(FRAME)}
    tip={FRAME.label()}
    kbd={FRAME.shortcut}
    pressed={tool === 'frame'}
    locked={lockedTool('frame')}
    disabled={readOnly}
    stop="frame"
    tabindex={tabindex('frame')}
    onclick={() => onselect('frame')}
    ondblclick={() => onselect('frame', true)}
  >
    <span aria-hidden="true" class="inline-flex"><FRAME.icon size={iconSize} /></span>
  </ToolButton>
  <ToolGroup
    label={m.editor_tool_shapes()}
    stop="shapes"
    tools={SHAPES}
    {tool}
    locked={toolLocked}
    shown={shownShape}
    disabled={readOnly}
    onimage={readOnly ? undefined : onimage}
    {tabindex}
    {dock}
    {touch}
    {onselect}
  />
  <ToolGroup
    label={m.editor_tool_lines()}
    stop="lines"
    tools={LINES}
    {tool}
    locked={toolLocked}
    shown={shownLine}
    disabled={readOnly}
    {tabindex}
    {dock}
    {touch}
    {onselect}
  />
  <ToolButton
    variant="tool"
    {size}
    side="top"
    label={toolAria(TEXT)}
    tip={TEXT.label()}
    kbd={TEXT.shortcut}
    pressed={tool === 'text'}
    locked={lockedTool('text')}
    disabled={readOnly}
    stop="text"
    tabindex={tabindex('text')}
    onclick={() => onselect('text')}
    ondblclick={() => onselect('text', true)}
  >
    <span aria-hidden="true" class="inline-flex"><TEXT.icon size={iconSize} /></span>
  </ToolButton>

  {@render separator()}

  <ToolButton variant="tool" {size} side="top" label={m.editor_gallery()} pressed={gallery} stop="gallery" tabindex={tabindex('gallery')} onclick={ongallery}>
    <Images size={iconSize} aria-hidden="true" />
  </ToolButton>
  <ToolButton
    variant="tool"
    {size}
    side="top"
    label={recording ? m.editor_animate_recording() : m.editor_animate()}
    tip={timelineOpen ? m.timeline_hide() : m.timeline_show()}
    pressed={timelineOpen}
    disabled={timelineLoading}
    stop="animate"
    tabindex={tabindex('animate')}
    onclick={onanimate}
  >
    <span class="relative inline-flex">
      <Film size={iconSize} aria-hidden="true" />
      {#if recording}
        <span aria-hidden="true" class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-danger"></span>
      {/if}
    </span>
  </ToolButton>
  {#if aiAvailable}
    <Tooltip text={aiOpen ? m.editor_ai_hide() : m.editor_ai_show()} side="top">
      {#snippet children(props)}
        <button
          {...props}
          type="button"
          aria-label={m.editor_ai_toggle()}
          aria-pressed={aiOpen}
          tabindex={tabindex('ai')}
          data-stop="ai"
          onclick={onai}
          class={[
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-card text-xs font-semibold',
            dock ? 'size-11' : 'size-9',
            'transition-[color,background-color,scale] duration-120 active:scale-96 motion-reduce:active:scale-100',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
            aiOpen ? 'bg-coral text-coral-ink' : 'text-ink-muted hover:bg-petrol hover:text-ink',
          ].join(' ')}
        >
          {m.editor_ai_label()}
        </button>
      {/snippet}
    </Tooltip>
  {/if}
{/snippet}

{#if dock}
  <!-- El área segura va como padding: el fondo llega hasta el borde y los botones quedan por encima del indicador de
       inicio. Las herramientas se desplazan en horizontal; «Propiedades» se queda fija a la derecha. -->
  <div
    role="toolbar"
    tabindex="-1"
    aria-label={m.editor_toolbar_label()}
    aria-orientation="horizontal"
    onfocusin={onFocusIn}
    onkeydown={onKeydown}
    class="pointer-events-auto flex h-[calc(3.5rem+env(safe-area-inset-bottom))] w-full items-center gap-1 border-t border-edge/40 bg-surface-2 pr-[max(0.25rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(0.25rem,env(safe-area-inset-left))] [touch-action:pan-x_pan-y]"
    data-testid="dock"
  >
    <div class="scroll-thin flex min-w-0 flex-1 snap-x items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-x-contain">
      {@render tools()}
    </div>
    {#if properties}
      {@const fill = properties.fill}
      <span aria-hidden="true" class="h-6 w-px shrink-0 bg-edge/30"></span>
      <button
        type="button"
        aria-label={m.editor_mobile_properties()}
        aria-pressed={properties.open}
        tabindex={tabindex('properties')}
        data-stop="properties"
        onclick={() => onproperties?.()}
        class={[
          'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-card transition-colors duration-120',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
          properties.open ? 'bg-petrol' : 'hover:bg-petrol',
        ]}
        data-testid="dock-properties"
      >
        <span
          aria-hidden="true"
          class="size-6 rounded-xs border border-edge/40"
          style:background={fill ? `linear-gradient(${fill}, ${fill}), ${CHECKER}` : NONE}
        ></span>
      </button>
    {/if}
  </div>
{:else}
  <div
    role="toolbar"
    tabindex="-1"
    aria-label={m.editor_toolbar_label()}
    aria-orientation="horizontal"
    onfocusin={onFocusIn}
    onkeydown={onKeydown}
    class="pointer-events-auto flex h-11 items-center gap-0.5 rounded-panel border border-edge/40 bg-surface-2 p-1 shadow-float [touch-action:pan-x_pan-y]"
  >
    {@render tools()}
  </div>
{/if}
