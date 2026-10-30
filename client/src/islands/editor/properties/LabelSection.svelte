<script lang="ts">
  import ALargeSmall from '@lucide/svelte/icons/a-large-small';
  import AlignVerticalJustifyCenter from '@lucide/svelte/icons/align-vertical-justify-center';
  import AlignVerticalJustifyEnd from '@lucide/svelte/icons/align-vertical-justify-end';
  import AlignVerticalJustifyStart from '@lucide/svelte/icons/align-vertical-justify-start';
  import TextAlignCenter from '@lucide/svelte/icons/text-align-center';
  import TextAlignEnd from '@lucide/svelte/icons/text-align-end';
  import TextAlignStart from '@lucide/svelte/icons/text-align-start';
  import type { NodeRecord, StylePatch } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import ColorRow from './ColorRow.svelte';
  import Section from './Section.svelte';
  import { colorPatch, LABEL_TYPES, shared, sharedAlpha, type PanelEdits } from './panel.ts';

  type Props = { records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean; colors: () => string[] };

  let { records, edits, readonly, colors }: Props = $props();

  // Valores que el lienzo usa cuando la forma aún no tiene los suyos.
  const DEFAULTS = { size: 16, color: '#0B1220FF', align: 'center', valign: 'middle' } as const;

  type Labelled = Extract<NodeRecord, { labelFontSize?: unknown }>;

  const ALIGNS = [
    { value: 'left', label: m.editor_props_align_left(), icon: TextAlignStart },
    { value: 'center', label: m.editor_props_align_center(), icon: TextAlignCenter },
    { value: 'right', label: m.editor_props_align_right(), icon: TextAlignEnd },
  ];
  const VALIGNS = [
    { value: 'top', label: m.editor_props_valign_top(), icon: AlignVerticalJustifyStart },
    { value: 'middle', label: m.editor_props_valign_middle(), icon: AlignVerticalJustifyCenter },
    { value: 'bottom', label: m.editor_props_valign_bottom(), icon: AlignVerticalJustifyEnd },
  ];

  const labelled = $derived(records.filter((record): record is Labelled => LABEL_TYPES.has(record.type)));
  const size = $derived(shared(labelled, (record) => record.labelFontSize ?? DEFAULTS.size));
  const color = $derived(shared(labelled, (record) => record.labelColor ?? DEFAULTS.color));
  const colorAlpha = $derived(sharedAlpha(labelled, (record) => record.labelColor ?? DEFAULTS.color));
  const colorOf = (record: NodeRecord) => (LABEL_TYPES.has(record.type) ? ((record as Labelled).labelColor ?? DEFAULTS.color) : undefined);
  const align = $derived(shared(labelled, (record) => record.labelAlign ?? DEFAULTS.align));
  const valign = $derived(shared(labelled, (record) => record.labelVAlign ?? DEFAULTS.valign));
</script>

{#if labelled.length}
  <Section title={m.editor_props_label_text()} testid="props-label">
    <div class="grid min-w-0 grid-cols-2 gap-2">
      <ScrubInput
        value={size.value ?? DEFAULTS.size}
        mixed={size.mixed}
        label={m.editor_props_label_font_size()}
        icon={ALargeSmall}
        min={4}
        max={800}
        decimals={0}
        {readonly}
        testid="props-label-size"
        oninput={(labelFontSize) => edits.previewStyle({ labelFontSize })}
        oncommit={(labelFontSize, meta) => edits.setStyle({ labelFontSize }, meta)}
        oncancel={() => edits.cancel()}
      />
      <span aria-hidden="true"></span>
      <SegmentedControl
        class="justify-self-start"
        items={ALIGNS}
        value={align.mixed ? '' : (align.value ?? DEFAULTS.align)}
        label={m.editor_props_align()}
        iconOnly
        size="sm"
        disabled={readonly}
        testid="props-label-align"
        onValueChange={(value) => edits.setStyle({ labelAlign: value as NonNullable<StylePatch['labelAlign']> })}
      />
      <SegmentedControl
        class="justify-self-start"
        items={VALIGNS}
        value={valign.mixed ? '' : (valign.value ?? DEFAULTS.valign)}
        label={m.editor_props_valign()}
        iconOnly
        size="sm"
        disabled={readonly}
        testid="props-label-valign"
        onValueChange={(value) => edits.setStyle({ labelVAlign: value as NonNullable<StylePatch['labelVAlign']> })}
      />
    </div>
    <ColorRow
      value={color.value ?? DEFAULTS.color}
      mixed={color.mixed}
      alphaMixed={colorAlpha.mixed}
      label={m.editor_props_text_color()}
      {readonly}
      {colors}
      testid="props-label-color"
      onpreview={(change) => edits.previewStyle(colorPatch('labelColor', change, colorOf))}
      oncommit={(change, meta) => edits.setStyle(colorPatch('labelColor', change, colorOf), meta)}
      oncancel={() => edits.cancel()}
    />
  </Section>
{/if}
