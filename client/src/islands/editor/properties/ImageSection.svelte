<script lang="ts">
  import type { NodeRecord } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Section from './Section.svelte';
  import { shared, type PanelEdits } from './panel.ts';

  type Props = { records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean };

  let { records, edits, readonly }: Props = $props();

  const MAX_ALT = 300;

  type ImageNode = Extract<NodeRecord, { type: 'image' }>;
  type Fit = ImageNode['fit'];

  const FITS = [
    { value: 'fill', label: m.editor_props_fit_fill() },
    { value: 'contain', label: m.editor_props_fit_contain() },
    { value: 'cover', label: m.editor_props_fit_cover() },
  ];

  const uid = $props.id();
  const images = $derived(records.filter((record): record is ImageNode => record.type === 'image'));
  const fit = $derived(shared(images, (record) => record.fit));
  const single = $derived(images.length === 1 && records.length === 1 ? images[0]! : null);

  function saveAlt(event: Event & { currentTarget: HTMLTextAreaElement }) {
    if (!single) return;
    const alt = event.currentTarget.value.trim().slice(0, MAX_ALT) || undefined;
    if (alt !== single.alt) edits.setStyle({ alt });
  }
</script>

{#if images.length}
  <Section title={m.editor_props_image()} testid="props-image">
    <SegmentedControl
      class="self-start"
      items={FITS}
      value={fit.mixed ? '' : (fit.value ?? 'fill')}
      label={m.editor_props_fit()}
      size="sm"
      disabled={readonly}
      testid="props-image-fit"
      onValueChange={(value) => edits.setStyle({ fit: value as Fit })}
    />
    {#if single}
      <div class="flex min-w-0 flex-col gap-1">
        <label for="{uid}-alt" class="text-2xs text-ink-muted">{m.editor_props_alt()}</label>
        <textarea
          id="{uid}-alt"
          rows="3"
          maxlength={MAX_ALT}
          value={single.alt ?? ''}
          {readonly}
          aria-readonly={readonly || undefined}
          data-testid="props-image-alt"
          onchange={saveAlt}
          class="scroll-thin min-w-0 resize-none rounded-control border border-transparent bg-surface-2 px-1.5 py-1 text-xs text-ink outline-none hover:border-edge/60 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral"
        ></textarea>
      </div>
    {/if}
  </Section>
{/if}
