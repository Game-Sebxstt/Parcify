<script lang="ts">
  import Blend from '@lucide/svelte/icons/blend';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Lock from '@lucide/svelte/icons/lock';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import type { Engine, NodeRecord } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import { MOD_ARIA, MOD_KEY } from '../layout/ui-keys.ts';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { shared, type PanelEdits, type Posed } from './panel.ts';

  type Props = {
    engine: Engine;
    records: readonly NodeRecord[];
    edits: PanelEdits;
    // Con la línea de tiempo abierta, la opacidad es la que se ve en el cabezal.
    posed: Posed;
    // Solo lectura por permisos: sin botones. Con todo bloqueado, el candado sigue para poder desbloquear.
    readOnly: boolean;
    locked: boolean;
  };

  let { engine, records, edits, posed, readOnly, locked }: Props = $props();

  const opacity = $derived.by(() => {
    void posed.version;
    const at = posed.at;
    const shown = (record: NodeRecord) => (at === null ? undefined : engine.anim.poseAt(record.id, at)?.opacity);
    return shared(records, (record) => Math.round(Math.min(1, Math.max(0, shown(record) ?? record.opacity)) * 100));
  });
  const visible = $derived(records.every((record) => record.visible));
  const ownLocked = $derived(records.every((record) => record.locked));
  // El bloqueo viene de un grupo o un marco antecesor: el candado propio no lo quita.
  const inherited = $derived(locked && !ownLocked);
</script>

<Section title={m.editor_props_section_appearance()} testid="props-appearance">
  {#snippet actions()}
    {#if !readOnly}
      <PanelButton
        label={visible ? m.editor_props_hide() : m.editor_props_show()}
        testid="props-visible"
        onclick={() => engine.commands.setVisible(!visible)}
      >
        {#if visible}<Eye size={14} aria-hidden="true" />{:else}<EyeOff size={14} aria-hidden="true" />{/if}
      </PanelButton>
      <PanelButton
        label={ownLocked || inherited ? m.editor_props_unlock() : m.editor_props_lock()}
        kbd={inherited ? undefined : `${MOD_KEY}+Shift+L`}
        ariaKeys={inherited ? undefined : `${MOD_ARIA}+Shift+L`}
        disabledReason={inherited ? m.editor_props_locked_by_parent() : undefined}
        testid="props-locked"
        onclick={() => engine.commands.setLocked(!ownLocked)}
      >
        {#if ownLocked || inherited}<Lock size={14} aria-hidden="true" />{:else}<LockOpen size={14} aria-hidden="true" />{/if}
      </PanelButton>
    {/if}
  {/snippet}
  <div class="grid min-w-0 grid-cols-2 gap-2">
    <ScrubInput
      value={opacity.value ?? 100}
      mixed={opacity.mixed}
      label={m.editor_props_opacity()}
      icon={Blend}
      unit="%"
      min={0}
      max={100}
      decimals={0}
      readonly={readOnly || locked}
      testid="props-opacity"
      oninput={(value) => edits.previewStyle({ opacity: value / 100 })}
      oncommit={(value, meta) => edits.setStyle({ opacity: value / 100 }, meta)}
      oncancel={() => edits.cancel()}
    />
  </div>
</Section>
