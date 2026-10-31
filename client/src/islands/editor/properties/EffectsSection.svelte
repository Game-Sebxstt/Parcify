<script lang="ts">
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import type { NodeRecord, StyleEach, StylePatch } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import ColorPicker from '../../../ui/ColorPicker.svelte';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { shared, type CommitMeta, type PanelEdits } from './panel.ts';

  type Props = { records: readonly NodeRecord[]; edits: PanelEdits; readonly: boolean; colors: () => string[] };

  let { records, edits, readonly, colors }: Props = $props();

  type Shadow = NonNullable<NonNullable<StylePatch['shadow']>>;
  type Shadowed = Extract<NodeRecord, { shadow: unknown }>;
  const DEFAULT_SHADOW: Shadow = { x: 0, y: 4, blur: 12, color: '#00000040' };
  // Límites de ShadowSchema.
  const OFFSET = 1000;

  // Las líneas y los conectores no pintan sombra.
  const isShadowed = (record: NodeRecord): record is Shadowed => 'shadow' in record && record.type !== 'line' && record.type !== 'connector';
  const shadowed = $derived(records.filter(isShadowed));
  const withShadow = $derived(shadowed.filter((record) => record.shadow !== null));
  const first = $derived(withShadow[0]?.shadow ?? null);
  const x = $derived(shared(withShadow, (record) => record.shadow?.x));
  const y = $derived(shared(withShadow, (record) => record.shadow?.y));
  const blur = $derived(shared(withShadow, (record) => record.shadow?.blur));

  let open = $state(false);
  const documentColors = $derived(open ? colors() : []);

  // Cada elemento con sombra conserva la suya y solo cambia el campo editado; los que no tienen sombra no cambian.
  const patch =
    (change: Partial<Shadow>): StyleEach =>
    (record) =>
      isShadowed(record) && record.shadow ? { shadow: { ...record.shadow, ...change } } : null;

  function field(key: 'x' | 'y' | 'blur') {
    return {
      oninput: (value: number) => edits.previewStyle(patch({ [key]: value })),
      oncommit: (value: number, meta: CommitMeta) => edits.setStyle(patch({ [key]: value }), meta),
      oncancel: () => edits.cancel(),
    };
  }
</script>

{#if shadowed.length}
  <Section title={m.editor_props_section_effects()} testid="props-effects">
    {#snippet actions()}
      {#if !first && !readonly}
        <PanelButton label={m.editor_props_shadow_add()} testid="props-shadow-add" onclick={() => edits.setStyle({ shadow: DEFAULT_SHADOW })}>
          <Plus size={14} aria-hidden="true" />
        </PanelButton>
      {/if}
    {/snippet}
    {#if first}
      <div class="flex h-7 min-w-0 items-center gap-1 sheet:h-11" role="group" aria-label={m.editor_props_shadow()} data-testid="props-shadow">
        <ColorPicker
          bind:open
          value={first.color}
          label={m.editor_props_shadow_color()}
          {documentColors}
          disabled={readonly}
          testid="props-shadow-color"
          oninput={(next) => edits.previewStyle(patch({ color: next }))}
          oncommit={(next, meta) => edits.setStyle(patch({ color: next }), meta)}
          oncancel={() => edits.cancel()}
        />
        <ScrubInput
          class="w-11 shrink-0"
          value={x.value ?? 0}
          mixed={x.mixed}
          label={m.editor_props_shadow_x()}
          prefix="X"
          min={-OFFSET}
          max={OFFSET}
          decimals={0}
          {readonly}
          testid="props-shadow-x"
          {...field('x')}
        />
        <ScrubInput
          class="w-11 shrink-0"
          value={y.value ?? 0}
          mixed={y.mixed}
          label={m.editor_props_shadow_y()}
          prefix="Y"
          min={-OFFSET}
          max={OFFSET}
          decimals={0}
          {readonly}
          testid="props-shadow-y"
          {...field('y')}
        />
        <ScrubInput
          class="w-11 shrink-0"
          value={blur.value ?? 0}
          mixed={blur.mixed}
          label={m.editor_props_shadow_blur()}
          icon={CircleDashed}
          min={0}
          max={100}
          decimals={0}
          {readonly}
          testid="props-shadow-blur"
          {...field('blur')}
        />
        <span class="flex-1"></span>
        {#if !readonly}
          <PanelButton label={m.editor_props_shadow_remove()} testid="props-shadow-remove" onclick={() => edits.setStyle({ shadow: null })}>
            <Minus size={14} aria-hidden="true" />
          </PanelButton>
        {/if}
      </div>
    {/if}
  </Section>
{/if}
