<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import type { NodeRecord } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import ColorRow from './ColorRow.svelte';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { colorPatch, shared, sharedAlpha, type PanelEdits } from './panel.ts';

  type Props = { records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean; colors: () => string[] };

  let { records, edits, readonly, colors }: Props = $props();

  const SHAPE_FILL = '#D9D9D9FF';
  const FRAME_FILL = '#FFFFFFFF';

  type Filled = Extract<NodeRecord, { fill: unknown }>;
  const isFilled = (record: NodeRecord): record is Filled => 'fill' in record && record.type !== 'line' && record.type !== 'connector';
  const fillOf = (record: NodeRecord) => (isFilled(record) ? (record.fill ?? undefined) : undefined);
  const filled = $derived(records.filter(isFilled));
  const fill = $derived(shared(filled, (record) => record.fill ?? undefined));
  const alpha = $derived(sharedAlpha(filled, (record) => record.fill ?? undefined));
  const empty = $derived(fill.value === undefined);
  const fallback = $derived(filled.every((record) => record.type === 'frame') ? FRAME_FILL : SHAPE_FILL);
</script>

{#if filled.length}
  <Section title={m.editor_props_fill()} testid="props-fill">
    {#snippet actions()}
      {#if empty && !readonly}
        <PanelButton label={m.editor_props_fill_add()} testid="props-fill-add" onclick={() => edits.setStyle({ fill: fallback })}>
          <Plus size={14} aria-hidden="true" />
        </PanelButton>
      {/if}
    {/snippet}
    {#if !empty}
      <ColorRow
        value={fill.value ?? fallback}
        mixed={fill.mixed}
        alphaMixed={alpha.mixed}
        label={m.editor_props_fill()}
        {readonly}
        {colors}
        removeLabel={m.editor_props_fill_remove()}
        testid="props-fill-row"
        onpreview={(change) => edits.previewStyle(colorPatch('fill', change, fillOf))}
        oncommit={(change, meta) => edits.setStyle(colorPatch('fill', change, fillOf), meta)}
        oncancel={() => edits.cancel()}
        onremove={() => edits.setStyle({ fill: null })}
      />
    {/if}
  </Section>
{/if}
