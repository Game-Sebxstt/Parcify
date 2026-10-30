<script lang="ts">
  import AlignCenterHorizontal from '@lucide/svelte/icons/align-center-horizontal';
  import AlignCenterVertical from '@lucide/svelte/icons/align-center-vertical';
  import AlignEndHorizontal from '@lucide/svelte/icons/align-end-horizontal';
  import AlignEndVertical from '@lucide/svelte/icons/align-end-vertical';
  import AlignHorizontalSpaceBetween from '@lucide/svelte/icons/align-horizontal-space-between';
  import AlignStartHorizontal from '@lucide/svelte/icons/align-start-horizontal';
  import AlignStartVertical from '@lucide/svelte/icons/align-start-vertical';
  import AlignVerticalSpaceBetween from '@lucide/svelte/icons/align-vertical-space-between';
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import ALargeSmall from '@lucide/svelte/icons/a-large-small';
  import Bold from '@lucide/svelte/icons/bold';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import CircleMinus from '@lucide/svelte/icons/circle-minus';
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
  import Crop from '@lucide/svelte/icons/crop';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Group from '@lucide/svelte/icons/group';
  import Italic from '@lucide/svelte/icons/italic';
  import Minus from '@lucide/svelte/icons/minus';
  import RectangleHorizontal from '@lucide/svelte/icons/rectangle-horizontal';
  import Spline from '@lucide/svelte/icons/spline';
  import SquareRoundCorner from '@lucide/svelte/icons/square-round-corner';
  import TextAlignCenter from '@lucide/svelte/icons/text-align-center';
  import TextAlignEnd from '@lucide/svelte/icons/text-align-end';
  import TextAlignStart from '@lucide/svelte/icons/text-align-start';
  import TextCursorInput from '@lucide/svelte/icons/text-cursor-input';
  import Ungroup from '@lucide/svelte/icons/ungroup';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import {
    FRAME_PRESETS,
    type ActiveVertex,
    type AlignMode,
    type Engine,
    type FramePresetId,
    type NodeRecord,
    type ScreenRect,
    type StylePatch,
  } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import { cssFamily } from '../../../engine/text/fonts.ts';
  import { FONT_FAMILIES, type FontFamily } from '../../../shared/document/schema.js';
  import { placeOverCanvas } from '../../../ui/anchor.ts';
  import { CHECKER, topColors } from '../../../ui/color.ts';
  import ColorPicker from '../../../ui/ColorPicker.svelte';
  import DropdownMenu, { type MenuEntry, type MenuIcon } from '../../../ui/DropdownMenu.svelte';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import Tooltip from '../../../ui/Tooltip.svelte';
  import { ALT_KEY, MOD_ARIA, MOD_KEY } from '../layout/ui-keys.ts';
  import ToolButton from '../ToolButton.svelte';

  export type Avoid = { top: number; right: number; bottom: number; left: number };

  type Props = {
    engine: Engine;
    records: readonly NodeRecord[];
    // Caja de la selección en px del contenedor del lienzo; null mientras el motor la oculta.
    rect: ScreenRect | null;
    container: HTMLElement;
    // Algo de la selección está bloqueado (también por un antecesor): solo queda «Más…».
    locked: boolean;
    // Distancia a cada borde de la ventana que la barra no pisa: paneles, pastillas y barras de abajo.
    avoid: Avoid;
    // El último puntero fue un dedo: la selección lleva tirador de giro encima.
    touch: boolean;
    // Vértice marcado de la línea o el conector seleccionado: la barra ofrece «Eliminar punto».
    vertex: ActiveVertex | null;
    // Con la Pluma activa, los puntos fijados de la línea en curso: la barra ofrece «Terminar» y «Cancelar», encima de
    // la barra de herramientas, y no sigue a la selección.
    pen: number | null;
    onmore: (at: { clientX: number; clientY: number }) => void;
    onreplaceimage: (id: string) => void;
    // Devuelve el foco al lienzo.
    onescape: () => void;
  };

  let { engine, records, rect, container, locked, avoid, touch, vertex, pen, onmore, onreplaceimage, onescape }: Props = $props();

  const GAP = 12;
  // Con el dedo hay un tirador de giro 24 px por encima de la caja (círculo de 14 px): la barra queda por encima.
  const TOUCH_GAP = 40;
  const SHAPES = new Set(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc']);
  const DEFAULT_FILL = '#D9D9D9FF';
  const DEFAULT_STROKE = '#EEF2F6FF';

  type Kind = 'shape' | 'text' | 'line' | 'image' | 'frame' | 'group' | 'multi' | 'locked' | 'pen';
  type Single<T extends NodeRecord['type']> = Extract<NodeRecord, { type: T }>;
  type Shape = Single<'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'polygon' | 'arc'>;
  type Fit = Single<'image'>['fit'];

  const kind = $derived.by((): Kind => {
    if (pen !== null) return 'pen';
    if (locked || !records.length) return 'locked';
    if (records.length > 1) return 'multi';
    const type = records[0]!.type;
    if (SHAPES.has(type)) return 'shape';
    if (type === 'line' || type === 'connector') return 'line';
    if (type === 'text' || type === 'image' || type === 'frame' || type === 'group') return type;
    return 'locked';
  });
  const gap = $derived(touch && kind !== 'line' && kind !== 'locked' && kind !== 'pen' ? TOUCH_GAP : GAP);
  const single = $derived(records.length === 1 ? records[0]! : null);
  const shape = $derived(single && SHAPES.has(single.type) ? (single as Shape) : null);
  const text = $derived(single?.type === 'text' ? single : null);
  const line = $derived(single?.type === 'line' || single?.type === 'connector' ? single : null);
  const image = $derived(single?.type === 'image' ? single : null);
  const frame = $derived(single?.type === 'frame' ? single : null);

  const commands = $derived(engine.commands);
  const preview = (patch: StylePatch) => commands.previewStyle(patch, { autoCommit: false });
  const commit = (patch: StylePatch) => commands.setStyle(patch);
  const cancel = () => commands.cancelPreview();

  // Mientras la cámara se mueve la barra se oculta; si el foco está dentro, se queda donde estaba hasta que vuelva.
  let focusInside = $state(false);
  let last: ScreenRect | null = null;
  const anchorRect = $derived.by(() => {
    if (rect) last = rect;
    return rect ?? last;
  });
  const visible = $derived(kind === 'pen' || rect !== null || focusInside);

  let viewportWidth = $state(0);
  let viewportHeight = $state(0);

  // Se recoloca cuando el motor publica otra caja, cambian los márgenes o cambia el contenido (y con él el ancho).
  function place(el: HTMLElement) {
    const target = anchorRect;
    const padding = avoid;
    const offset = gap;
    void kind;
    void vertex;
    void pen;
    if (kind === 'pen') {
      // Fija encima de la barra de herramientas, centrada en el hueco entre los paneles: no salta con cada punto.
      const width = Math.max(0, viewportWidth - padding.left - padding.right);
      const strip = { x: padding.left, y: viewportHeight - padding.bottom, width, height: 0 };
      void placeOverCanvas(el, strip, { placement: 'top', gap: 0, padding, hidePadding: 0 });
      return;
    }
    if (!target) return;
    const box = container.getBoundingClientRect();
    void placeOverCanvas(el, { x: box.left + target.x, y: box.top + target.y, width: target.width, height: target.height }, {
      placement: 'top',
      gap: offset,
      padding,
      hidePadding: { top: 0, right: padding.right, bottom: 0, left: padding.left },
    });
  }

  function onFocusOut(event: FocusEvent & { currentTarget: HTMLElement }) {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) focusInside = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Esc solo saca el foco de la barra: sin cortarlo aquí, el atajo del lienzo vaciaría también la selección.
    event.preventDefault();
    event.stopPropagation();
    onescape();
  }

  let bar = $state<HTMLElement | null>(null);

  function more() {
    const button = bar?.querySelector<HTMLElement>('[data-testid="context-more"]');
    const box = (button ?? bar)?.getBoundingClientRect();
    if (box) onmore({ clientX: box.left, clientY: box.bottom + 4 });
  }

  // Los 12 colores más usados en la página, al abrir un selector.
  function pageColors(): string[] {
    const page = engine.state.pageId.get();
    const colors: string[] = [];
    for (const record of engine.core.store.all()) {
      if (record.pageId !== page) continue;
      for (const key of ['fill', 'stroke', 'color', 'labelColor'] as const) {
        const value = (record as Partial<Record<typeof key, unknown>>)[key];
        if (typeof value === 'string') colors.push(value);
      }
    }
    return topColors(colors);
  }

  let fillOpen = $state(false);
  let strokeOpen = $state(false);
  let colorOpen = $state(false);
  const fillColors = $derived(fillOpen ? pageColors() : []);
  const strokeColors = $derived(strokeOpen ? pageColors() : []);
  const textColors = $derived(colorOpen ? pageColors() : []);

  const ALIGNS = [
    { id: 'left', label: m.editor_props_align_left, icon: TextAlignStart },
    { id: 'center', label: m.editor_props_align_center, icon: TextAlignCenter },
    { id: 'right', label: m.editor_props_align_right, icon: TextAlignEnd },
  ] as const;
  const CAPS = [
    { id: 'none', label: m.editor_props_cap_none },
    { id: 'arrow', label: m.editor_props_cap_arrow },
    { id: 'triangle', label: m.editor_props_cap_triangle },
    { id: 'circle', label: m.editor_props_cap_circle },
    { id: 'diamond', label: m.editor_props_cap_diamond },
    { id: 'bar', label: m.editor_props_cap_bar },
  ] as const;
  const ROUTES = [
    { id: 'straight', label: m.editor_props_route_straight, icon: Minus },
    { id: 'elbow', label: m.editor_props_route_elbow, icon: CornerDownRight },
    { id: 'curved', label: m.editor_props_route_curved, icon: Spline },
  ] as const;
  const FITS = [
    { value: 'fill', label: m.editor_props_fit_fill() },
    { value: 'contain', label: m.editor_props_fit_contain() },
    { value: 'cover', label: m.editor_props_fit_cover() },
  ];
  const PRESET_LABELS: Record<FramePresetId, () => string> = {
    '16:9': m.editor_preset_16_9,
    '4:3': m.editor_preset_4_3,
    '1:1': m.editor_preset_1_1,
    A4: m.editor_preset_a4,
    'A4-landscape': m.editor_preset_a4_landscape,
    letter: m.editor_preset_letter,
    phone: m.editor_preset_phone,
    story: m.editor_preset_story,
  };
  const PRESETS = FRAME_PRESETS.map((item) => ({ value: item.id, label: PRESET_LABELS[item.id]() }));
  // Cada familia con su fuente si el lienzo ya la cargó; si no, con la de la interfaz.
  const FONTS = FONT_FAMILIES.map((family) => ({ value: family, label: family, style: `font-family: '${cssFamily(family)}', var(--font-sans)` }));

  const alignIcon = $derived(ALIGNS.find((item) => item.id === text?.align)?.icon ?? TextAlignStart);
  const alignItems = $derived.by<MenuEntry[]>(() =>
    ALIGNS.map((item) => ({
      kind: 'check',
      id: `align-${item.id}`,
      label: item.label(),
      icon: item.icon,
      checked: text?.align === item.id,
      onSelect: () => commit({ align: item.id }),
    })),
  );
  const capItems = $derived.by<MenuEntry[]>(() => {
    if (!line) return [];
    const group = (key: 'startCap' | 'endCap', label: string): MenuEntry => ({
      kind: 'label',
      id: key,
      label,
      items: CAPS.map((cap) => ({
        kind: 'check',
        id: `${key}-${cap.id}`,
        label: cap.label(),
        checked: line[key] === cap.id,
        onSelect: () => commit({ [key]: cap.id }),
      })),
    });
    return [group('startCap', m.editor_props_start_cap()), { kind: 'separator', id: 'caps-sep' }, group('endCap', m.editor_props_end_cap())];
  });
  const ARRANGE = [
    { id: 'left', label: m.editor_arrange_left, icon: AlignStartVertical, key: 'A' },
    { id: 'hcenter', label: m.editor_arrange_hcenter, icon: AlignCenterVertical, key: 'H' },
    { id: 'right', label: m.editor_arrange_right, icon: AlignEndVertical, key: 'D' },
    { id: 'top', label: m.editor_arrange_top, icon: AlignStartHorizontal, key: 'W' },
    { id: 'vcenter', label: m.editor_arrange_vcenter, icon: AlignCenterHorizontal, key: 'V' },
    { id: 'bottom', label: m.editor_arrange_bottom, icon: AlignEndHorizontal, key: 'S' },
  ] as const satisfies ReadonlyArray<{ id: AlignMode; label: () => string; icon: MenuIcon; key: string }>;
  const arrangeItems = $derived.by<MenuEntry[]>(() => {
    const ids = records.map((record) => record.id);
    const few = ids.length < 3;
    return [
      ...ARRANGE.map(
        (item): MenuEntry => ({
          kind: 'item',
          id: `arrange-${item.id}`,
          label: item.label(),
          icon: item.icon,
          keys: `${ALT_KEY}+${item.key}`,
          ariaKeys: `Alt+${item.key}`,
          onSelect: () => commands.align(ids, item.id),
        }),
      ),
      { kind: 'separator', id: 'arrange-sep' },
      { kind: 'item', id: 'distribute-h', label: m.editor_arrange_distribute_h(), icon: AlignHorizontalSpaceBetween, disabled: few, onSelect: () => commands.distribute(ids, 'h') },
      { kind: 'item', id: 'distribute-v', label: m.editor_arrange_distribute_v(), icon: AlignVerticalSpaceBetween, disabled: few, onSelect: () => commands.distribute(ids, 'v') },
    ];
  });

  const route = $derived(line?.type === 'connector' ? line.route : null);
  const routeIcon = $derived(ROUTES.find((item) => item.id === route)?.icon ?? CornerDownRight);
  const routeItems = $derived.by<MenuEntry[]>(() =>
    ROUTES.map((item) => ({
      kind: 'check',
      id: `route-${item.id}`,
      label: item.label(),
      icon: item.icon,
      checked: route === item.id,
      onSelect: () => commit({ route: item.id }),
    })),
  );

  const TRIGGER = [
    'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-control text-ink-muted transition-colors duration-(--dur-fast)',
    'hover:bg-petrol hover:text-ink data-[state=open]:bg-petrol data-[state=open]:text-ink',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
  ].join(' ');
  // Sin color: muestra con tablero y una diagonal.
  const NONE = `linear-gradient(to top right, transparent calc(50% - 0.75px), var(--color-ink-muted) 50%, transparent calc(50% + 0.75px)), ${CHECKER}`;
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

<!-- Tooltip al pasar el ratón por encima de un control que ya abre su propio popover o menú. -->
{#snippet hint(text: string, content: Snippet)}
  <Tooltip {text} side="top">
    {#snippet children(props)}
      <span {...props} class="inline-flex">{@render content()}</span>
    {/snippet}
  </Tooltip>
{/snippet}

{#snippet separator()}
  <span aria-hidden="true" class="mx-0.5 h-5 w-px shrink-0 bg-edge/30"></span>
{/snippet}

{#snippet menuTrigger(props: Record<string, unknown>, label: string, Icon: MenuIcon)}
  <button {...props} type="button" aria-label={label} class={[TRIGGER, 'w-11 pl-1']}>
    <span aria-hidden="true" class="inline-flex"><Icon size={16} /></span>
    <ChevronDown size={12} aria-hidden="true" />
  </button>
{/snippet}

{#snippet fillPicker(color: string | null)}
  {#snippet content()}
    <ColorPicker
      bind:open={fillOpen}
      value={color ?? DEFAULT_FILL}
      label={m.editor_props_fill()}
      documentColors={fillColors}
      side="top"
      align="center"
      oninput={(next) => preview({ fill: next })}
      oncommit={(next) => commit({ fill: next })}
      oncancel={cancel}
    >
      {#snippet trigger(props)}
        <button {...props} type="button" aria-label={m.editor_props_fill()} class={[TRIGGER, 'w-8']} data-testid="context-fill">
          <span aria-hidden="true" class="size-4.5 rounded-xs border border-edge/40" style:background={color ? `linear-gradient(${color}, ${color}), ${CHECKER}` : NONE}></span>
        </button>
      {/snippet}
    </ColorPicker>
  {/snippet}
  {@render hint(m.editor_props_fill(), content)}
{/snippet}

{#snippet strokePicker(color: string | null)}
  {#snippet content()}
    <ColorPicker
      bind:open={strokeOpen}
      value={color ?? DEFAULT_STROKE}
      label={m.editor_props_stroke()}
      documentColors={strokeColors}
      side="top"
      align="center"
      oninput={(next) => preview({ stroke: next })}
      oncommit={(next) => commit({ stroke: next })}
      oncancel={cancel}
    >
      {#snippet trigger(props)}
        <button {...props} type="button" aria-label={m.editor_props_stroke()} class={[TRIGGER, 'w-8']} data-testid="context-stroke">
          {#if color}
            <span aria-hidden="true" class="size-4.5 rounded-xs border-[3px]" style:border-color={color}></span>
          {:else}
            <span aria-hidden="true" class="size-4.5 rounded-xs border border-edge/40" style:background={NONE}></span>
          {/if}
        </button>
      {/snippet}
    </ColorPicker>
  {/snippet}
  {@render hint(m.editor_props_stroke(), content)}
{/snippet}

<div
  bind:this={bar}
  role="toolbar"
  tabindex="-1"
  aria-label={kind === 'pen' ? m.editor_pen_bar() : m.editor_context_bar()}
  aria-orientation="horizontal"
  data-testid="context-bar"
  data-kind={kind}
  style="visibility: hidden"
  class={[
    'pointer-events-auto fixed top-0 left-0 z-(--z-toolbar) flex h-9 items-center gap-0.5 rounded-panel border border-edge/40 bg-surface-2 p-0.5 text-ui text-ink shadow-float [touch-action:pan-x_pan-y]',
    !visible && 'invisible',
  ]}
  onfocusin={() => (focusInside = true)}
  onfocusout={onFocusOut}
  onkeydown={onKeydown}
  {@attach place}
>
  {#if kind === 'pen'}
    <span class="px-2 text-ui text-ink-muted" data-testid="pen-hint">{touch ? m.editor_pen_hint_touch() : m.editor_pen_hint()}</span>
    {@render separator()}
    <Tooltip text={m.editor_pen_finish_hint()} kbd="Enter" side="top">
      {#snippet children(props)}
        <button
          {...props}
          type="button"
          disabled={(pen ?? 0) < 2}
          class={[TRIGGER, 'px-2 font-semibold text-coral disabled:cursor-default disabled:text-ink-muted disabled:opacity-60 disabled:hover:bg-transparent']}
          data-testid="pen-finish"
          onclick={() => {
            commands.finishPen();
            onescape();
          }}
        >
          <Check size={16} aria-hidden="true" />
          {m.editor_pen_finish()}
        </button>
      {/snippet}
    </Tooltip>
    <Tooltip text={m.editor_pen_cancel_hint()} side="top">
      {#snippet children(props)}
        <button
          {...props}
          type="button"
          class={[TRIGGER, 'px-2 text-ink']}
          data-testid="pen-cancel"
          onclick={() => {
            commands.cancelPen();
            onescape();
          }}
        >
          <X size={16} aria-hidden="true" />
          {m.editor_pen_cancel()}
        </button>
      {/snippet}
    </Tooltip>
  {:else if kind === 'shape' && shape}
    {@render fillPicker(shape.fill)}
    {@render strokePicker(shape.stroke)}
    {#if shape.type === 'rect'}
      {@const max = Math.floor(Math.min(shape.w, shape.h) / 2)}
      <ScrubInput
        class="mx-1 w-16"
        value={Math.min(shape.cornerRadius, max)}
        label={m.editor_props_radius()}
        icon={SquareRoundCorner}
        min={0}
        {max}
        decimals={0}
        testid="context-radius"
        oninput={(value) => preview({ cornerRadius: value })}
        oncommit={(value) => commit({ cornerRadius: value })}
        oncancel={cancel}
      />
    {/if}
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_context_edit_label()} kbd="Enter" onclick={() => commands.editSelectedText()}>
      <TextCursorInput size={16} aria-hidden="true" />
    </ToolButton>
  {:else if kind === 'text' && text}
    <Select
      class="w-30"
      items={FONTS}
      value={text.fontFamily}
      label={m.editor_props_font()}
      testid="context-font"
      onValueChange={(value) => commit({ fontFamily: value as FontFamily })}
    />
    <ScrubInput
      class="mx-1 w-13"
      value={text.fontSize}
      label={m.editor_context_font_size()}
      icon={ALargeSmall}
      min={4}
      max={800}
      decimals={0}
      testid="context-font-size"
      oninput={(value) => preview({ fontSize: value })}
      oncommit={(value) => commit({ fontSize: value })}
      oncancel={cancel}
    />
    <ToolButton
      variant="tool"
      size="sm"
      side="top"
      label={m.editor_props_weight_700()}
      pressed={text.fontWeight >= 600}
      onclick={() => commit({ fontWeight: text.fontWeight >= 600 ? 400 : 700 })}
    >
      <Bold size={16} aria-hidden="true" />
    </ToolButton>
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_props_italic()} pressed={text.italic} onclick={() => commit({ italic: !text.italic })}>
      <Italic size={16} aria-hidden="true" />
    </ToolButton>
    {#snippet alignMenu()}
      <DropdownMenu items={alignItems} label={m.editor_props_align()} side="bottom" align="start" class="min-w-44">
        {#snippet trigger(props)}
          {@render menuTrigger(props, m.editor_props_align(), alignIcon)}
        {/snippet}
      </DropdownMenu>
    {/snippet}
    {@render hint(m.editor_props_align(), alignMenu)}
    {#snippet textColor()}
      <ColorPicker
        bind:open={colorOpen}
        value={text.color}
        label={m.editor_props_text_color()}
        documentColors={textColors}
        side="top"
        align="center"
        oninput={(next) => preview({ color: next })}
        oncommit={(next) => commit({ color: next })}
        oncancel={cancel}
      >
        {#snippet trigger(props)}
          <button {...props} type="button" aria-label={m.editor_props_text_color()} class={[TRIGGER, 'w-8']} data-testid="context-text-color">
            <span aria-hidden="true" class="size-4.5 rounded-xs border border-edge/40" style:background={`linear-gradient(${text.color}, ${text.color}), ${CHECKER}`}></span>
          </button>
        {/snippet}
      </ColorPicker>
    {/snippet}
    {@render hint(m.editor_props_text_color(), textColor)}
  {:else if kind === 'line' && line}
    {#snippet capsMenu()}
      <DropdownMenu items={capItems} label={m.editor_props_caps()} side="bottom" align="start" class="min-w-44">
        {#snippet trigger(props)}
          {@render menuTrigger(props, m.editor_props_caps(), ArrowRightLeft)}
        {/snippet}
      </DropdownMenu>
    {/snippet}
    {@render hint(m.editor_props_caps(), capsMenu)}
    {#if line.type === 'connector'}
      {#snippet routeMenu()}
        <DropdownMenu items={routeItems} label={m.editor_props_route()} side="bottom" align="start" class="min-w-44">
          {#snippet trigger(props)}
            {@render menuTrigger(props, m.editor_props_route(), routeIcon)}
          {/snippet}
        </DropdownMenu>
      {/snippet}
      {@render hint(m.editor_props_route(), routeMenu)}
    {/if}
    {@render strokePicker(line.stroke)}
    <ScrubInput
      class="mx-1 w-16"
      value={line.strokeWidth}
      label={m.editor_props_stroke_width()}
      icon={RectangleHorizontal}
      unit="px"
      min={0}
      max={50}
      decimals={0}
      testid="context-stroke-width"
      oninput={(value) => preview({ strokeWidth: value })}
      oncommit={(value) => commit({ strokeWidth: value })}
      oncancel={cancel}
    />
    {#if vertex && vertex.id === line.id}
      {@const point = vertex}
      <ToolButton
        variant="tool"
        size="sm"
        side="top"
        label={m.editor_point_delete()}
        kbd="Supr"
        ariaKeys="Delete"
        testid="context-delete-point"
        onclick={() => commands.removeVertex(point.id, point.index)}
      >
        <CircleMinus size={16} aria-hidden="true" />
      </ToolButton>
    {/if}
  {:else if kind === 'image' && image}
    <button
      type="button"
      aria-label={m.editor_context_replace_label()}
      class={[TRIGGER, 'px-2 text-ui text-ink']}
      data-testid="context-replace-image"
      onclick={() => onreplaceimage(image.id)}
    >
      {m.editor_context_replace_image()}
    </button>
    <Select class="w-28" items={FITS} value={image.fit} label={m.editor_props_fit()} testid="context-fit" onValueChange={(value) => commit({ fit: value as Fit })} />
  {:else if kind === 'frame' && frame}
    <Select
      class="w-44"
      items={PRESETS}
      value={frame.presetName ?? ''}
      placeholder={m.editor_props_preset_custom()}
      label={m.editor_props_preset()}
      testid="context-preset"
      onValueChange={(value) => commands.applyFramePreset(value as FramePresetId)}
    />
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_props_clip()} pressed={frame.clip} onclick={() => commit({ clip: !frame.clip })}>
      <Crop size={16} aria-hidden="true" />
    </ToolButton>
  {:else if kind === 'group'}
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_menu_ungroup()} kbd={`${MOD_KEY}+Shift+G`} ariaKeys={`${MOD_ARIA}+Shift+G`} onclick={() => commands.ungroupSelection()}>
      <Ungroup size={16} aria-hidden="true" />
    </ToolButton>
  {:else if kind === 'multi'}
    {#snippet arrangeMenu()}
      <DropdownMenu items={arrangeItems} label={m.editor_arrange_align()} side="bottom" align="start" class="min-w-56">
        {#snippet trigger(props)}
          {@render menuTrigger(props, m.editor_arrange_align(), AlignStartVertical)}
        {/snippet}
      </DropdownMenu>
    {/snippet}
    {@render hint(m.editor_arrange_align(), arrangeMenu)}
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_menu_group()} kbd={`${MOD_KEY}+G`} ariaKeys={`${MOD_ARIA}+G`} onclick={() => commands.groupSelection()}>
      <Group size={16} aria-hidden="true" />
    </ToolButton>
  {/if}
  {#if kind !== 'pen'}
    {#if kind !== 'locked'}
      {@render separator()}
    {/if}
    <ToolButton variant="tool" size="sm" side="top" label={m.editor_context_more_label()} tip={m.editor_context_more()} testid="context-more" onclick={more}>
      <Ellipsis size={16} aria-hidden="true" />
    </ToolButton>
  {/if}
</div>
