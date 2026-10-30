<script lang="ts">
  import AlignCenterHorizontal from '@lucide/svelte/icons/align-center-horizontal';
  import AlignCenterVertical from '@lucide/svelte/icons/align-center-vertical';
  import AlignEndHorizontal from '@lucide/svelte/icons/align-end-horizontal';
  import AlignEndVertical from '@lucide/svelte/icons/align-end-vertical';
  import AlignHorizontalSpaceBetween from '@lucide/svelte/icons/align-horizontal-space-between';
  import AlignStartHorizontal from '@lucide/svelte/icons/align-start-horizontal';
  import AlignStartVertical from '@lucide/svelte/icons/align-start-vertical';
  import AlignVerticalSpaceBetween from '@lucide/svelte/icons/align-vertical-space-between';
  import type { AlignMode, Engine, NodeRecord } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import type { MenuIcon } from '../../../ui/DropdownMenu.svelte';
  import { ALT_KEY } from '../layout/ui-keys.ts';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';

  type Props = { engine: Engine; records: readonly NodeRecord[] };

  let { engine, records }: Props = $props();

  const ALIGN = [
    { id: 'left', label: m.editor_arrange_left, icon: AlignStartVertical, key: 'A' },
    { id: 'hcenter', label: m.editor_arrange_hcenter, icon: AlignCenterVertical, key: 'H' },
    { id: 'right', label: m.editor_arrange_right, icon: AlignEndVertical, key: 'D' },
    { id: 'top', label: m.editor_arrange_top, icon: AlignStartHorizontal, key: 'W' },
    { id: 'vcenter', label: m.editor_arrange_vcenter, icon: AlignCenterHorizontal, key: 'V' },
    { id: 'bottom', label: m.editor_arrange_bottom, icon: AlignEndHorizontal, key: 'S' },
  ] as const satisfies ReadonlyArray<{ id: AlignMode; label: () => string; icon: MenuIcon; key: string }>;

  const ids = $derived(records.map((record) => record.id));

  // Un solo elemento se alinea al marco que lo contiene; sin marco no hay nada a lo que alinearlo.
  const inFrame = $derived.by(() => {
    if (records.length !== 1) return false;
    for (let current = engine.core.tree.parent(records[0]!.id); current; current = engine.core.tree.parent(current)) {
      if (engine.core.record(current)?.type === 'frame') return true;
    }
    return false;
  });
  const alignReason = $derived(records.length > 1 || inFrame ? undefined : m.editor_props_align_needs_frame());
  const distributeReason = $derived(records.length >= 3 ? undefined : m.editor_props_distribute_needs_three());
</script>

<Section title={m.editor_arrange_align()} testid="props-align">
  <div class="flex min-w-0 items-center" role="group" aria-label={m.editor_arrange_align()}>
    {#each ALIGN as item (item.id)}
      <PanelButton
        label={item.label()}
        kbd="{ALT_KEY}+{item.key}"
        ariaKeys="Alt+{item.key}"
        disabledReason={alignReason}
        testid="props-align-{item.id}"
        onclick={() => engine.commands.align(ids, item.id)}
      >
        <item.icon size={14} aria-hidden="true" />
      </PanelButton>
    {/each}
    <span aria-hidden="true" class="mx-1 h-3 w-px shrink-0 bg-edge/40"></span>
    <PanelButton
      label={m.editor_arrange_distribute_h()}
      disabledReason={distributeReason}
      testid="props-distribute-h"
      onclick={() => engine.commands.distribute(ids, 'h')}
    >
      <AlignHorizontalSpaceBetween size={14} aria-hidden="true" />
    </PanelButton>
    <PanelButton
      label={m.editor_arrange_distribute_v()}
      disabledReason={distributeReason}
      testid="props-distribute-v"
      onclick={() => engine.commands.distribute(ids, 'v')}
    >
      <AlignVerticalSpaceBetween size={14} aria-hidden="true" />
    </PanelButton>
  </div>
</Section>
