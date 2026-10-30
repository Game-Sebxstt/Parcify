<script lang="ts">
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import RectangleHorizontal from '@lucide/svelte/icons/rectangle-horizontal';
  import Spline from '@lucide/svelte/icons/spline';
  import type { NodeRecord, StylePatch } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import ColorRow from './ColorRow.svelte';
  import DashDashed from './icons/DashDashed.svelte';
  import DashDotted from './icons/DashDotted.svelte';
  import DashSolid from './icons/DashSolid.svelte';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { colorPatch, shared, sharedAlpha, type PanelEdits } from './panel.ts';

  type Props = { records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean; colors: () => string[] };

  let { records, edits, readonly, colors }: Props = $props();

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
  // Las miniaturas de cada punta, el botón de intercambiar y «Rombo» llegan con los extremos nuevos.
  const CAPS = [
    { value: 'none', label: m.editor_props_cap_none() },
    { value: 'arrow', label: m.editor_props_cap_arrow() },
    { value: 'triangle', label: m.editor_props_cap_triangle() },
    { value: 'circle', label: m.editor_props_cap_circle() },
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
      <div class="grid min-w-0 grid-cols-2 gap-2">
        <Select
          size="sm"
          items={CAPS}
          value={startCap.mixed ? '' : (startCap.value ?? 'none')}
          placeholder={m.ui_mixed()}
          label={m.editor_props_start_cap()}
          disabled={readonly}
          testid="props-start-cap"
          onValueChange={(value) => edits.setStyle({ startCap: value as Cap })}
        />
        <Select
          size="sm"
          items={CAPS}
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
      <SegmentedControl
        class="self-start"
        items={ROUTES}
        value={route.mixed ? '' : (route.value ?? 'elbow')}
        label={m.editor_props_route()}
        size="sm"
        disabled={readonly}
        testid="props-route"
        onValueChange={(value) => edits.setStyle({ route: value as Route })}
      />
    {/if}
  </Section>
{/if}
