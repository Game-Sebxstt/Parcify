<script lang="ts">
  import type { WheelPreference } from '../../../engine/index.ts';
  import { setWheelPreference, wheelPreference } from '../../../lib/input-prefs.ts';
  import { m } from '../../../paraglide/messages.js';
  import Dialog from '../../../ui/Dialog.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';

  type Props = { open: boolean };

  let { open = $bindable(false) }: Props = $props();

  const uid = $props.id();
  // El motor la lee en cada evento de rueda: el cambio vale enseguida, también en otras pestañas.
  // Se vuelve a leer al abrir, por si se cambió en Ajustes desde otra pestaña.
  let wheel = $derived.by<WheelPreference>(() => (open ? wheelPreference() : 'pan'));
</script>

<Dialog bind:open title={m.settings_wheel()}>
  <div class="flex flex-col gap-3">
    <SegmentedControl
      items={[
        { value: 'pan', label: m.settings_wheel_pan() },
        { value: 'zoom', label: m.settings_wheel_zoom() },
      ]}
      bind:value={
        () => wheel,
        (next) => {
          wheel = next as WheelPreference;
          setWheelPreference(wheel);
        }
      }
      label={m.settings_wheel()}
      describedBy="{uid}-hint"
      class="self-start"
    />
    <p id="{uid}-hint" class="text-xs text-ink-muted">{m.settings_wheel_hint()}</p>
  </div>
</Dialog>
