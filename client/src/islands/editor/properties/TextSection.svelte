<script lang="ts">
  import ALargeSmall from '@lucide/svelte/icons/a-large-small';
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import MoveVertical from '@lucide/svelte/icons/move-vertical';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import TextAlignCenter from '@lucide/svelte/icons/text-align-center';
  import TextAlignEnd from '@lucide/svelte/icons/text-align-end';
  import TextAlignStart from '@lucide/svelte/icons/text-align-start';
  import Underline from '@lucide/svelte/icons/underline';
  import type { NodeRecord } from '../../../engine/index.ts';
  import { cssFamily } from '../../../engine/text/fonts.ts';
  import { m } from '../../../paraglide/messages.js';
  import { FONT_FAMILIES, type FontFamily } from '../../../shared/document/schema.js';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import Switch from '../../../ui/Switch.svelte';
  import ColorRow from './ColorRow.svelte';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { colorPatch, shared, sharedAlpha, type PanelEdits } from './panel.ts';

  type Props = { records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean; colors: () => string[] };

  let { records, edits, readonly, colors }: Props = $props();

  type TextNode = Extract<NodeRecord, { type: 'text' }>;
  type Weight = TextNode['fontWeight'];
  type Align = TextNode['align'];

  const FONTS = FONT_FAMILIES.map((family) => ({ value: family, label: family, style: `font-family: '${cssFamily(family)}', var(--font-sans)` }));
  const WEIGHTS = [
    { value: '400', label: m.editor_props_weight_400() },
    { value: '500', label: m.editor_props_weight_500() },
    { value: '600', label: m.editor_props_weight_600() },
    { value: '700', label: m.editor_props_weight_700() },
  ];
  const ALIGNS = [
    { value: 'left', label: m.editor_props_align_left(), icon: TextAlignStart },
    { value: 'center', label: m.editor_props_align_center(), icon: TextAlignCenter },
    { value: 'right', label: m.editor_props_align_right(), icon: TextAlignEnd },
  ];
  const DECORATIONS = [
    { key: 'italic', label: m.editor_props_italic, icon: Italic },
    { key: 'underline', label: m.editor_props_underline, icon: Underline },
    { key: 'strike', label: m.editor_props_strike, icon: Strikethrough },
  ] as const;

  const uid = $props.id();
  const texts = $derived(records.filter((record): record is TextNode => record.type === 'text'));
  const family = $derived(shared(texts, (record) => record.fontFamily));
  const weight = $derived(shared(texts, (record) => record.fontWeight));
  const size = $derived(shared(texts, (record) => record.fontSize));
  const lineHeight = $derived(shared(texts, (record) => record.lineHeight));
  const align = $derived(shared(texts, (record) => record.align));
  const color = $derived(shared(texts, (record) => record.color));
  const colorAlpha = $derived(sharedAlpha(texts, (record) => record.color));
  const colorOf = (record: NodeRecord) => (record.type === 'text' ? record.color : undefined);
  const bold = $derived(texts.every((record) => record.fontWeight >= 600));
  const autoWidth = $derived(texts.every((record) => record.autoWidth));
</script>

{#if texts.length}
  <Section title={m.editor_props_text()} testid="props-text">
    <Select
      size="sm"
      class="w-full"
      items={FONTS}
      value={family.mixed ? '' : (family.value ?? '')}
      placeholder={m.ui_mixed()}
      label={m.editor_props_font()}
      disabled={readonly}
      testid="props-font"
      onValueChange={(value) => edits.setStyle({ fontFamily: value as FontFamily })}
    />
    <div class="grid min-w-0 grid-cols-2 gap-2">
      <Select
        size="sm"
        items={WEIGHTS}
        value={weight.mixed ? '' : String(weight.value ?? 400)}
        placeholder={m.ui_mixed()}
        label={m.editor_props_font_weight()}
        disabled={readonly}
        testid="props-font-weight"
        onValueChange={(value) => edits.setStyle({ fontWeight: Number(value) as Weight })}
      />
      <ScrubInput
        value={size.value ?? 16}
        mixed={size.mixed}
        label={m.editor_props_font_size()}
        icon={ALargeSmall}
        min={4}
        max={800}
        decimals={0}
        {readonly}
        testid="props-font-size"
        oninput={(fontSize) => edits.previewStyle({ fontSize })}
        oncommit={(fontSize, meta) => edits.setStyle({ fontSize }, meta)}
        oncancel={() => edits.cancel()}
      />
      <ScrubInput
        value={lineHeight.value ?? 1.2}
        mixed={lineHeight.mixed}
        label={m.editor_props_line_height()}
        icon={MoveVertical}
        step={0.05}
        min={0.8}
        max={3}
        decimals={2}
        {readonly}
        testid="props-line-height"
        oninput={(value) => edits.previewStyle({ lineHeight: value })}
        oncommit={(value, meta) => edits.setStyle({ lineHeight: value }, meta)}
        oncancel={() => edits.cancel()}
      />
      <SegmentedControl
        class="justify-self-start"
        items={ALIGNS}
        value={align.mixed ? '' : (align.value ?? 'left')}
        label={m.editor_props_align()}
        iconOnly
        size="sm"
        disabled={readonly}
        testid="props-text-align"
        onValueChange={(value) => edits.setStyle({ align: value as Align })}
      />
    </div>
    {#if !readonly}
      <div class="flex items-center gap-0.5" role="group" aria-label={m.editor_props_text_style()}>
        <PanelButton label={m.editor_props_weight_700()} pressed={bold} testid="props-bold" onclick={() => edits.setStyle({ fontWeight: bold ? 400 : 700 })}>
          <Bold size={14} aria-hidden="true" />
        </PanelButton>
        {#each DECORATIONS as item (item.key)}
          {@const on = texts.every((record) => record[item.key])}
          <PanelButton label={item.label()} pressed={on} testid="props-{item.key}" onclick={() => edits.setStyle({ [item.key]: !on })}>
            <item.icon size={14} aria-hidden="true" />
          </PanelButton>
        {/each}
      </div>
    {/if}
    <ColorRow
      value={color.value ?? '#EEF2F6FF'}
      mixed={color.mixed}
      alphaMixed={colorAlpha.mixed}
      label={m.editor_props_text_color()}
      {readonly}
      {colors}
      testid="props-text-color"
      onpreview={(change) => edits.previewStyle(colorPatch('color', change, colorOf))}
      oncommit={(change, meta) => edits.setStyle(colorPatch('color', change, colorOf), meta)}
      oncancel={() => edits.cancel()}
    />
    <div class="flex h-6 min-w-0 items-center justify-between gap-2">
      <label for="{uid}-auto-width" class="min-w-0 truncate text-xs text-ink">{m.editor_props_auto_width()}</label>
      <Switch
        id="{uid}-auto-width"
        checked={autoWidth}
        disabled={readonly}
        testid="props-auto-width"
        onCheckedChange={(checked) => edits.setStyle({ autoWidth: checked })}
      />
    </div>
  </Section>
{/if}
