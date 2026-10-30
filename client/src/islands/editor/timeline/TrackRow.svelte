<script lang="ts" module>
  import type { MenuEntry } from '../../../ui/DropdownMenu.svelte';
  import type { KeyframeContext } from '../properties/panel.ts';
  import type { KeyRef } from '../../../engine/index.ts';
  import type { NodeRow, Row, TimelineKeyframe, TrackRow } from './model.ts';

  export type RangeMode = 'move' | 'start' | 'end';
  export type CellPosition = { row: string; key: string | null };

  // Lo que la fila pide a la línea de tiempo. Todo lo que cambia el documento pasa por aquí.
  export type RowActions = {
    cellId: (position: CellPosition) => string;
    tabindex: (row: Row, key: string | null) => number;
    isSelected: (refs: readonly KeyRef[]) => boolean;
    focusCell: (position: CellPosition) => void;
    nameOf: (row: Row) => string;
    nodeLabel: (row: NodeRow) => string;
    select: (row: NodeRow) => void;
    toggle: (row: NodeRow, expand: boolean) => void;
    play: (row: NodeRow) => void;
    menu: (row: NodeRow) => MenuEntry[];
    menuCloseFocus: (event: Event) => void;
    // Tramo de la animación que se ve (con la vista previa del arrastre de la barra de rango).
    settingsOf: (row: Row) => { delay: number; duration: number } | null;
    shownTime: (row: TrackRow, kf: TimelineKeyframe) => number;
    rangeDown: (event: PointerEvent, row: NodeRow, mode: RangeMode) => void;
    rangeMove: (event: PointerEvent) => void;
    rangeUp: (event: PointerEvent) => void;
    laneDown: (event: PointerEvent) => void;
    laneMove: (event: PointerEvent) => void;
    laneUp: (event: PointerEvent) => void;
    laneMenu: (event: MouseEvent) => void;
    // Instante en que se ve un rombo resumen de la fila plegada (con la vista previa de los arrastres).
    markTime: (row: NodeRow, ms: number, refs: readonly KeyRef[]) => number;
    keyframeLabel: (row: TrackRow, kf: TimelineKeyframe) => string;
    // Rombos (uno o, en la fila plegada, todos los de un instante): selección, arrastre y menú.
    keyDown: (event: PointerEvent, refs: KeyRef[], ms: number, position: CellPosition | null) => void;
    keyMove: (event: PointerEvent) => void;
    keyUp: (event: PointerEvent) => void;
    keyCancel: (event: PointerEvent) => void;
    keyMenu: (event: MouseEvent, refs: KeyRef[], position: CellPosition | null) => void;
    // Clic en el tramo que empieza en `kf`: su curva.
    segment: (event: MouseEvent, row: TrackRow, kf: TimelineKeyframe) => void;
    edit: (row: TrackRow, kf: TimelineKeyframe) => void;
    valueAt: (row: TrackRow) => number | string | null;
    commitValue: (row: TrackRow, value: number) => void;
    keyframeContext: () => KeyframeContext;
  };
</script>

<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { kindOf } from '../../../engine/a11y/describe.ts';
  import { AI_PREVIEW_COLOR } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import DropdownMenu from '../../../ui/DropdownMenu.svelte';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import Tooltip from '../../../ui/Tooltip.svelte';
  import { swatchBackground } from '../../../ui/color.ts';
  import { kindIcon } from '../kind-icons.ts';
  import KeyframeToggle from '../properties/KeyframeToggle.svelte';
  import KeyframeDiamond from './KeyframeDiamond.svelte';
  import { formatTime, LABEL_WIDTH, propLabel, shortUnitOf, stepOf, timeX, toDisplay } from './model.ts';

  type Props = {
    row: Row;
    top: number;
    height: number;
    index: number;
    zoom: number;
    head: number;
    touch: boolean;
    readOnly: boolean;
    selected: boolean;
    playing: boolean;
    proposed: boolean;
    actions: RowActions;
  };

  let { row, top, height, index, zoom, head, touch, readOnly, selected, playing, proposed, actions }: Props = $props();

  // Con el dedo no hay hover: ▶ y ⋯ se ven siempre.
  const EDGES = ['start', 'end'] as const;
  const HOVER_ONLY = 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 touch:opacity-100';
  const header = $derived({ row: row.rowKey, key: null });
  const settings = $derived(actions.settingsOf(row));
  const name = $derived(actions.nameOf(row));
  const tab = $derived(actions.tabindex(row, null));
  const rowButton = $derived(['inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink', touch ? 'size-8' : 'size-6']);
</script>

<div role="row" aria-rowindex={index + 1} class="absolute inset-x-0 flex" style:top="{top}px" style:height="{height}px">
  {#if row.kind === 'node'}
    {@const node = row}
    {@const Icon = kindIcon(kindOf(node.record))}
    <!-- El teclado de las celdas lo lleva la rejilla. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      id={actions.cellId(header)}
      role="rowheader"
      tabindex={tab}
      aria-label={actions.nodeLabel(node)}
      aria-expanded={node.expanded}
      aria-selected={selected}
      onfocus={() => actions.focusCell(header)}
      onclick={() => {
        actions.focusCell(header);
        actions.select(node);
      }}
      style:width="{LABEL_WIDTH}px"
      class={[
        'group/row sticky left-0 z-10 flex shrink-0 cursor-pointer items-center gap-1 border-b border-edge/20 pr-1 pl-0.5 outline-none select-none',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
        selected ? 'bg-petrol text-ink' : 'bg-surface-1 text-ink hover:bg-surface-2',
      ]}
    >
      <button
        type="button"
        tabindex="-1"
        aria-hidden="true"
        onclick={(event) => {
          event.stopPropagation();
          actions.toggle(node, !node.expanded);
        }}
        class="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-ink-muted hover:text-ink"
      >
        <ChevronRight size={16} class={['transition-transform duration-(--dur-fast)', node.expanded && 'rotate-90']} />
      </button>
      <span aria-hidden="true" class="inline-flex shrink-0 text-ink-muted"><Icon size={14} /></span>
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
      {#if node.animation}
        <Tooltip text={playing ? m.editor_anim_stop_node({ name }) : m.timeline_play_node({ name })}>
          {#snippet children(props)}
            <button
              {...props}
              type="button"
              tabindex={tab}
              aria-label={playing ? m.editor_anim_stop_node({ name }) : m.timeline_play_node({ name })}
              onclick={(event) => {
                event.stopPropagation();
                actions.play(node);
              }}
              class={[rowButton, playing ? 'opacity-100' : HOVER_ONLY]}
              data-testid="timeline-row-play"
            >
              {#if playing}<Square size={12} aria-hidden="true" />{:else}<Play size={12} aria-hidden="true" />{/if}
            </button>
          {/snippet}
        </Tooltip>
      {/if}
      {#if !readOnly}
        <DropdownMenu items={actions.menu(node)} side="bottom" align="end" onCloseAutoFocus={actions.menuCloseFocus}>
          {#snippet trigger(props)}
            <button
              {...props}
              type="button"
              tabindex={tab}
              aria-label={m.timeline_row_menu({ name })}
              onclick={(event) => event.stopPropagation()}
              class={[rowButton, HOVER_ONLY]}
              data-testid="timeline-row-menu"
            >
              <Ellipsis size={14} aria-hidden="true" />
            </button>
          {/snippet}
        </DropdownMenu>
      {/if}
    </div>
    <div
      role="none"
      onpointerdown={(event) => {
        if (event.target === event.currentTarget) actions.laneDown(event);
      }}
      onpointermove={actions.laneMove}
      onpointerup={actions.laneUp}
      onpointercancel={actions.laneUp}
      oncontextmenu={(event) => {
        if (event.target === event.currentTarget) actions.laneMenu(event);
      }}
      class="relative min-w-0 flex-1 border-b border-edge/20"
    >
      {#if settings}
        {@const left = timeX(settings.delay, zoom)}
        {@const width = Math.max(6, settings.duration * zoom)}
        <!-- Arrastrar la barra cambia el retardo y sus extremos, la duración. Con el teclado se cambian en la sección
             Animación del panel derecho. -->
        <div
          role="none"
          onpointerdown={(event) => actions.rangeDown(event, node, 'move')}
          onpointermove={actions.rangeMove}
          onpointerup={actions.rangeUp}
          onpointercancel={actions.rangeUp}
          class={['absolute top-1/2 h-4 -translate-y-1/2 touch-none rounded-xs bg-petrol', readOnly ? '' : 'cursor-grab active:cursor-grabbing']}
          style:left="{left}px"
          style:width="{width}px"
          data-testid="timeline-range"
        >
          {#if !readOnly}
            {#each EDGES as edge (edge)}
              <span
                role="none"
                onpointerdown={(event) => {
                  event.stopPropagation();
                  actions.rangeDown(event, node, edge);
                }}
                class={[
                  'absolute inset-y-0 w-1.5 cursor-ew-resize touch-none rounded-xs bg-edge/70 hover:bg-ink-muted',
                  'touch:before:absolute touch:before:inset-y-[-4px] touch:before:-inset-x-[9px]',
                  edge === 'start' ? 'left-0' : 'right-0',
                ]}
                data-testid="timeline-range-{edge}"
              ></span>
            {/each}
          {/if}
        </div>
      {/if}
      {#if !node.expanded}
        <!-- Rombos resumen: se seleccionan y se arrastran todos los keyframes de ese instante a la vez. Con el teclado
             se despliega la fila. -->
        {#each node.marks as mark (mark.ms)}
          {@const on = actions.isSelected(mark.refs)}
          <span
            aria-hidden="true"
            onpointerdown={(event) => actions.keyDown(event, mark.refs, mark.ms, null)}
            onpointermove={actions.keyMove}
            onpointerup={actions.keyUp}
            onpointercancel={actions.keyCancel}
            oncontextmenu={(event) => actions.keyMenu(event, mark.refs, null)}
            class={[
              'group/mark absolute top-1/2 z-[1] grid -translate-1/2 touch-none place-items-center select-none',
              touch ? 'size-7' : 'size-4',
              readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
            ]}
            style:left="{timeX(actions.markTime(node, mark.ms, mark.refs), zoom)}px"
            data-testid="keyframe-mark"
            data-selected={on ? '' : undefined}
          >
            <span
              class={[
                'block size-[7px] rotate-45 rounded-[1px] border transition-colors duration-(--dur-fast)',
                on ? 'border-coral bg-coral' : 'border-ink-muted bg-surface-2 group-hover/mark:border-ink',
              ]}
              style:border-color={proposed && !on ? AI_PREVIEW_COLOR : undefined}
            ></span>
          </span>
        {/each}
      {/if}
    </div>
  {:else}
    {@const track = row}
    {@const value = actions.valueAt(track)}
    {@const times = track.keyframes.map((kf) => actions.shownTime(track, kf))}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      id={actions.cellId(header)}
      role="rowheader"
      tabindex={tab}
      aria-label={propLabel(track.prop)}
      onfocus={() => actions.focusCell(header)}
      onclick={() => actions.focusCell(header)}
      style:width="{LABEL_WIDTH}px"
      class={[
        'sticky left-0 z-10 flex shrink-0 cursor-default items-center gap-1 border-b border-edge/20 bg-surface-1 pr-0.5 pl-7 outline-none select-none',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral',
      ]}
    >
      <span class="min-w-0 flex-1 truncate text-2xs text-ink-muted">{propLabel(track.prop)}</span>
      {#if typeof value === 'number'}
        <ScrubInput
          value={toDisplay(track.prop, value)}
          label={m.timeline_value_at({ track: propLabel(track.prop), time: formatTime(head) })}
          unit={shortUnitOf(track.prop)}
          step={stepOf(track.prop)}
          min={track.prop === 'opacity' ? 0 : undefined}
          max={track.prop === 'opacity' ? 100 : undefined}
          size="sm"
          readonly={readOnly}
          tabindex={tab}
          class="w-14 shrink-0"
          oncommit={(next) => actions.commitValue(track, next)}
        />
      {:else if typeof value === 'string'}
        <span
          role="img"
          aria-label={m.timeline_value_color({ track: propLabel(track.prop), time: formatTime(head), value })}
          class="flex h-5 w-14 shrink-0 items-center gap-1 rounded-control bg-surface-2 px-1 text-2xs text-ink-muted"
        >
          <span aria-hidden="true" class="size-3 shrink-0 rounded-xs border border-edge/60" style:background={swatchBackground(value)}></span>
          <span aria-hidden="true" class="truncate tabular">{value.slice(1, 7)}</span>
        </span>
      {/if}
      {#if !readOnly}
        <KeyframeToggle context={actions.keyframeContext()} records={[track.record]} prop={track.prop} label={propLabel(track.prop)} tabindex={tab} />
      {/if}
    </div>
    <div
      role="none"
      onpointerdown={(event) => {
        if (event.target === event.currentTarget) actions.laneDown(event);
      }}
      onpointermove={actions.laneMove}
      onpointerup={actions.laneUp}
      onpointercancel={actions.laneUp}
      oncontextmenu={(event) => {
        if (event.target === event.currentTarget) actions.laneMenu(event);
      }}
      class="relative min-w-0 flex-1 border-b border-edge/20"
    >
      <!-- Tramos entre keyframes: un clic abre su curva. Con el teclado, «Curva ▸» del menú del keyframe. -->
      {#each times as time, i (track.keyframes[i]!.key)}
        {@const next = times[i + 1]}
        {#if next !== undefined && next > time}
          <button
            type="button"
            tabindex="-1"
            aria-hidden="true"
            disabled={readOnly}
            onclick={(event) => actions.segment(event, track, track.keyframes[i]!)}
            class={[
              'group/seg absolute top-1/2 h-3 -translate-y-1/2 cursor-pointer disabled:cursor-default',
              // Con el dedo, el tramo no es un botón: la corrección de toques del navegador lo elegiría al tocar el vacío
              // (scroll y marquesina). La curva está en «Curva ▸» de la pulsación larga.
              touch && 'pointer-events-none',
            ]}
            style:left="{timeX(time, zoom)}px"
            style:width="{(next - time) * zoom}px"
            data-testid="keyframe-segment"
          >
            <span class={['block h-0.5 w-full bg-petrol transition-colors duration-(--dur-fast)', !readOnly && 'group-hover/seg:bg-coral']}></span>
          </button>
        {/if}
      {/each}
      {#each track.keyframes as kf, i (kf.key)}
        {@const position = { row: track.rowKey, key: kf.key }}
        {@const refs = [{ nodeId: track.id, prop: track.prop, key: kf.key }]}
        <KeyframeDiamond
          id={actions.cellId(position)}
          label={actions.keyframeLabel(track, kf)}
          left={timeX(times[i] ?? kf.time, zoom)}
          tabindex={actions.tabindex(track, kf.key)}
          selected={actions.isSelected(refs)}
          atHead={Math.abs((times[i] ?? kf.time) - head) < 1}
          {proposed}
          {readOnly}
          {touch}
          onfocus={() => actions.focusCell(position)}
          onpointerdown={(event) => actions.keyDown(event, refs, kf.time, position)}
          onpointermove={actions.keyMove}
          onpointerup={actions.keyUp}
          onpointercancel={actions.keyCancel}
          oncontextmenu={(event) => actions.keyMenu(event, refs, position)}
          ondblclick={() => actions.edit(track, kf)}
        />
      {/each}
    </div>
  {/if}
</div>
