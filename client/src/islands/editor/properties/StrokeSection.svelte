<script lang="ts">
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import RectangleHorizontal from '@lucide/svelte/icons/rectangle-horizontal';
  import Spline from '@lucide/svelte/icons/spline';
  import { createRawSnippet } from 'svelte';
  import type { NodeRecord, StylePatch } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select, { type SelectItem } from '../../../ui/Select.svelte';
  import { capThumbnail } from './cap-thumbnail.ts';
  import ColorRow from './ColorRow.svelte';
  import DashDashed from './icons/DashDashed.svelte';
  import DashDotted from './icons/DashDotted.svelte';
  import DashSolid from './icons/DashSolid.svelte';
  import KeyframeToggle from './KeyframeToggle.svelte';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { colorPatch, shared, sharedAlpha, type KeyframeContext, type PanelEdits } from './panel.ts';

  type Props = { records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean; colors: () => string[]; keyframes: KeyframeContext | null };

  let { records, edits, readonly, colors, keyframes }: Props = $props();

  const DEFAULT_STROKE = '#EEF2F6FF';
  const MAX_WIDTH = 200;

  type Styled = Extract<NodeRecord, { strokeDash: unknown }>;
  type Ended = Extract<NodeRecord, { startCap: unknown }>;
  type Connector = Extract<NodeRecord, { type: 'connector' }>;
  type Dash = Styled['strokeDash'];
  type Cap = NonNullable<StylePatch['startCap']>;
  type Route = Connector['route'];

  const DASHES = [
    { value: 'solid', label: m.editor_props_dash_solid(), icon: DashSolid },
    { value: 'dashed', label: m.editor_props_dash_dashed(), icon: DashDashed },
    { value: 'dotted', label: m.editor_props_dash_dotted(), icon: DashDotted },
  ];
  const CAPS: Array<{ value: Cap; label: string }> = [
    { value: 'none', label: m.editor_props_cap_none() },
    { value: 'arrow', label: m.editor_props_cap_arrow() },
    { value: 'triangle', label: m.editor_props_cap_triangle() },
    { value: 'circle', label: m.editor_props_cap_circle() },
    { value: 'diamond', label: m.editor_props_cap_diamond() },
    { value: 'bar', label: m.editor_props_cap_bar() },
  ];
  const ROUTES = [
    { value: 'straight', label: m.editor_props_route_straight(), icon: Minus },
    { value: 'elbow', label: m.editor_props_route_elbow(), icon: CornerDownRight },
    { value: 'curved', label: m.editor_props_route_curved(), icon: Spline },
  ];

  const styled = $derived(records.filter((record): record is Styled => 'strokeDash' in record));
  const strokeOf = (record: NodeRecord) => ('strokeDash' in record ? (record.stroke ?? undefined) : undefined);
  const stroke = $derived(shared(styled, (record) => record.stroke ?? undefined));
  const strokeAlpha = $derived(sharedAlpha(styled, (record) => record.stroke ?? undefined));
  const empty = $derived(stroke.value === undefined);
  const width = $derived(shared(styled, (record) => record.strokeWidth));
  const dash = $derived(shared(styled, (record) => record.strokeDash));
  const ended = $derived(styled.filter((record): record is Ended => 'startCap' in record));
  const startCap = $derived(shared(ended, (record) => record.startCap));
  const endCap = $derived(shared(ended, (record) => record.endCap));
  const connectors = $derived(styled.filter((record): record is Connector => record.type === 'connector'));
  const route = $derived(shared(connectors, (record) => record.route));
  const routed = $derived(connectors.some((record) => record.waypoints?.length));

  // Cada punta con su miniatura dibujada con el grosor del trazo (el de la selección, o 2 si es mixto).
  const capWidth = $derived(width.mixed ? 2 : (width.value ?? 2));
  const capItems = (side: 'start' | 'end', strokeWidth: number): SelectItem[] =>
    CAPS.map((cap) => {
      const svg = capThumbnail(cap.value, side, strokeWidth);
      return { ...cap, preview: createRawSnippet(() => ({ render: () => svg })) };
    });
  const startItems = $derived(capItems('start', capWidth));
  const endItems = $derived(capItems('end', capWidth));

  function swapCaps() {
    edits.setStyle((record) => ('startCap' in record ? { startCap: record.endCap, endCap: record.startCap } : null));
  }
</script>

{#if styled.length}
  <Section title={m.editor_props_stroke()} testid="props-stroke">
    {#snippet actions()}
      {#if empty && !readonly}
        <PanelButton label={m.editor_props_stroke_add()} testid="props-stroke-add" onclick={() => edits.setStyle({ stroke: DEFAULT_STROKE })}>
          <Plus size={14} aria-hidden="true" />
        </PanelButton>
      {/if}
    {/snippet}
    {#if !empty}
      <div class="flex min-w-0 items-center gap-1">
        <div class="min-w-0 flex-1">
          <ColorRow
            value={stroke.value ?? DEFAULT_STROKE}
            mixed={stroke.mixed}
            alphaMixed={strokeAlpha.mixed}
            label={m.editor_props_stroke()}
            {readonly}
            {colors}
            removeLabel={m.editor_props_stroke_remove()}
            testid="props-stroke-row"
            onpreview={(change) => edits.previewStyle(colorPatch('stroke', change, strokeOf))}
            oncommit={(change, meta) => edits.setStyle(colorPatch('stroke', change, strokeOf), meta)}
            oncancel={() => edits.cancel()}
            onremove={() => edits.setStyle({ stroke: null })}
          />
        </div>
        {#if keyframes}
          <KeyframeToggle context={keyframes} records={styled} prop="stroke" label={m.editor_props_stroke()} testid="props-stroke-key" />
        {/if}
      </div>
      <div class="grid min-w-0 grid-cols-2 items-center gap-2">
        <ScrubInput
          value={width.value ?? 0}
          mixed={width.mixed}
          label={m.editor_props_stroke_width()}
          icon={RectangleHorizontal}
          unit="px"
          min={0}
          max={MAX_WIDTH}
          decimals={1}
          {readonly}
          testid="props-stroke-width"
          oninput={(strokeWidth) => edits.previewStyle({ strokeWidth })}
          oncommit={(strokeWidth, meta) => edits.setStyle({ strokeWidth }, meta)}
          oncancel={() => edits.cancel()}
        />
        <SegmentedControl
          class="justify-self-start"
          items={DASHES}
          value={dash.mixed ? '' : (dash.value ?? 'solid')}
          label={m.editor_props_stroke_style()}
          iconOnly
          size="sm"
          disabled={readonly}
          testid="props-stroke-dash"
          onValueChange={(value) => edits.setStyle({ strokeDash: value as Dash })}
        />
      </div>
    {/if}
    {#if ended.length}
      <div class="flex min-w-0 items-center gap-1" data-testid="props-caps">
        <Select
          class="w-24 min-w-0"
          size="sm"
          compact
          items={startItems}
          value={startCap.mixed ? '' : (startCap.value ?? 'none')}
          placeholder={m.ui_mixed()}
          label={m.editor_props_start_cap()}
          disabled={readonly}
          testid="props-start-cap"
          onValueChange={(value) => edits.setStyle({ startCap: value as Cap })}
        />
        {#if !readonly}
          <PanelButton label={m.editor_props_swap_caps()} testid="props-swap-caps" onclick={swapCaps}>
            <ArrowLeftRight size={14} aria-hidden="true" />
          </PanelButton>
        {/if}
        <Select
          class="w-24 min-w-0"
          size="sm"
          compact
          items={endItems}
          value={endCap.mixed ? '' : (endCap.value ?? 'none')}
          placeholder={m.ui_mixed()}
          label={m.editor_props_end_cap()}
          disabled={readonly}
          testid="props-end-cap"
          onValueChange={(value) => edits.setStyle({ endCap: value as Cap })}
        />
      </div>
    {/if}
    {#if connectors.length}
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <SegmentedControl
          items={ROUTES}
          value={route.mixed ? '' : (route.value ?? 'elbow')}
          label={m.editor_props_route()}
          size="sm"
          disabled={readonly}
          testid="props-route"
          onValueChange={(value) => edits.setStyle({ route: value as Route })}
        />
        {#if routed && !readonly}
          <button
            type="button"
            class="h-6 cursor-pointer rounded-control px-1.5 text-xs sheet:h-11 sheet:px-3 sheet:text-sm text-ink-muted transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral"
            data-testid="props-route-reset"
            onclick={() => edits.resetPath()}
          >
            {m.editor_props_route_reset()}
          </button>
        {/if}
      </div>
    {/if}
  </Section>
{/if}
