<script lang="ts">
  import { fromStore } from 'svelte/store';
  import { FRAME_PRESETS, type Engine, type FramePresetId, type NodeRecord, type Tool } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import AlignSection from './AlignSection.svelte';
  import AppearanceSection from './AppearanceSection.svelte';
  import EffectsSection from './EffectsSection.svelte';
  import ExportSection from './ExportSection.svelte';
  import FillSection from './FillSection.svelte';
  import FrameSection from './FrameSection.svelte';
  import ImageSection from './ImageSection.svelte';
  import LabelSection from './LabelSection.svelte';
  import LayoutSection from './LayoutSection.svelte';
  import Section from './Section.svelte';
  import StrokeSection from './StrokeSection.svelte';
  import TextSection from './TextSection.svelte';
  import { PanelEdits, pageColors, PRESET_LABELS } from './panel.ts';
  import { getEditorLayout } from '../../../lib/editor-layout.svelte.ts';

  type Props = {
    engine: Engine;
    records: readonly NodeRecord[];
    readOnly: boolean;
    tool: Tool;
    preset: FramePresetId;
    pageName: string;
    onpreset: (preset: FramePresetId) => void;
    onexport: () => void;
  };

  let { engine, records, readOnly, tool, preset, pageName, onpreset, onexport }: Props = $props();

  const PRESETS = FRAME_PRESETS.map((item) => ({ id: item.id, label: PRESET_LABELS[item.id] }));

  const ids = $derived(records.map((record) => record.id));
  const edits = new PanelEdits(
    () => engine,
    () => ids,
  );
  const nodeCount = $derived(fromStore(engine.state.nodeCount));
  // Con la línea de tiempo abierta, la posición, el tamaño, el giro y la opacidad son lo que se ve en el cabezal.
  const layout = getEditorLayout();
  const animations = $derived(fromStore(engine.anim.version));
  const posed = $derived({ at: layout.timeline.open ? layout.timeline.head : null, version: animations.current });
  // Todo bloqueado (también por un grupo o un marco): los campos se ven pero no se editan.
  const locked = $derived(records.length > 0 && records.every((record) => engine.core.isLocked(record.id)));
  const fieldsReadonly = $derived(readOnly || locked);
  const colors = () => pageColors(engine);
</script>

<div class="flex min-w-0 flex-col pb-2 text-ui" data-testid="properties-panel">
  {#if records.length === 0}
    {#if tool === 'frame' && !readOnly}
      <Section title={m.editor_props_frame()} testid="props-frame-presets">
        <p class="text-xs text-ink-muted">{m.editor_frame_presets_hint()}</p>
        <div role="group" aria-label={m.editor_props_preset()} class="flex min-w-0 flex-col gap-0.5">
          {#each PRESETS as option (option.id)}
            <button
              type="button"
              aria-pressed={preset === option.id}
              onclick={() => onpreset(option.id)}
              class={[
                'flex h-7 min-w-0 cursor-pointer items-center truncate rounded-control px-2 text-left text-ui transition-colors duration-(--dur-fast)',
                'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral',
                preset === option.id ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
              ]}
            >
              {option.label()}
            </button>
          {/each}
        </div>
      </Section>
    {:else}
      <Section title={m.editor_props_section_page()} testid="props-page">
        <p class="truncate text-ui font-semibold text-ink">{pageName}</p>
        <p class="text-xs text-ink-muted tabular">{m.editor_versions_nodes({ count: nodeCount.current })}</p>
        <p class="text-xs text-ink-muted">{readOnly ? m.editor_props_read_only() : m.editor_props_empty()}</p>
      </Section>
    {/if}
  {:else}
    {#if !fieldsReadonly}
      <AlignSection {engine} {records} />
    {/if}
    <LayoutSection {engine} {records} {edits} {posed} readonly={fieldsReadonly} />
    <AppearanceSection {engine} {records} {edits} {posed} {readOnly} {locked} />
    <FrameSection {engine} {records} {edits} readonly={fieldsReadonly} />
    <ImageSection {records} {edits} readonly={fieldsReadonly} />
    <FillSection {records} {edits} readonly={fieldsReadonly} {colors} />
    <StrokeSection {records} {edits} readonly={fieldsReadonly} {colors} />
    <TextSection {records} {edits} readonly={fieldsReadonly} {colors} />
    <LabelSection {records} {edits} readonly={fieldsReadonly} {colors} />
    <EffectsSection {records} {edits} readonly={fieldsReadonly} {colors} />
    <ExportSection {onexport} />
  {/if}
</div>
