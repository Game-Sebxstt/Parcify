<script lang="ts">
  import { FRAME_PRESETS, type Engine, type FramePresetId, type NodeRecord } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import Select from '../../../ui/Select.svelte';
  import Switch from '../../../ui/Switch.svelte';
  import Section from './Section.svelte';
  import { PRESET_LABELS, shared, type PanelEdits } from './panel.ts';

  type Props = { engine: Engine; records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean };

  let { engine, records, edits, readonly }: Props = $props();

  type FrameNode = Extract<NodeRecord, { type: 'frame' }>;

  const PRESETS = FRAME_PRESETS.map((item) => ({ value: item.id, label: PRESET_LABELS[item.id]() }));

  const uid = $props.id();
  const frames = $derived(records.filter((record): record is FrameNode => record.type === 'frame'));
  const preset = $derived(shared(frames, (record) => record.presetName ?? ''));
  const clip = $derived(frames.every((record) => record.clip));
</script>

{#if frames.length}
  <Section title={m.editor_props_frame()} testid="props-frame">
    <Select
      size="sm"
      class="w-full"
      items={PRESETS}
      value={preset.mixed ? '' : (preset.value ?? '')}
      placeholder={preset.mixed ? m.ui_mixed() : m.editor_props_preset_custom()}
      label={m.editor_props_preset()}
      disabled={readonly}
      testid="props-frame-preset"
      onValueChange={(value) => engine.commands.applyFramePreset(value as FramePresetId)}
    />
    <div class="flex h-6 min-w-0 items-center justify-between gap-2">
      <label for="{uid}-clip" class="min-w-0 truncate text-xs text-ink">{m.editor_props_clip()}</label>
      <Switch id="{uid}-clip" checked={clip} disabled={readonly} testid="props-frame-clip" onCheckedChange={(checked) => edits.setStyle({ clip: checked })} />
    </div>
  </Section>
{/if}
