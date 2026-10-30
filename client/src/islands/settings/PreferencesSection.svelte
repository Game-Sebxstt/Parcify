<script lang="ts">
  import { onMount } from 'svelte';
  import type { WheelPreference } from '../../engine/index.ts';
  import { ApiError, apiFetch, invalidateCache } from '../../lib/api.ts';
  import { setWheelPreference, wheelPreference } from '../../lib/input-prefs.ts';
  import { clearLocalCopies, localCopyEnabled, setLocalCopyEnabled } from '../../lib/local-copies.ts';
  import { reduceMotionPreferred, setReduceMotion } from '../../lib/motion.ts';
  import { session } from '../../lib/session.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import { MeResponseSchema, type MeResponse } from '../../shared/api/me.js';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import Select from '../../ui/Select.svelte';
  import Switch from '../../ui/Switch.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';

  type Props = { me: MeResponse };
  let { me }: Props = $props();

  let localCopy = $state(true);
  let reduceMotion = $state(false);
  let wheel = $state<WheelPreference>('pan');

  onMount(() => {
    localCopy = localCopyEnabled();
    reduceMotion = reduceMotionPreferred();
    wheel = wheelPreference();
  });

  // El editor la lee en cada evento de rueda: los que ya estén abiertos en otras pestañas la usan sin recargar.
  function changeWheel(next: WheelPreference) {
    wheel = next;
    setWheelPreference(next);
  }

  async function changeLocale(locale: string) {
    try {
      const updated = await apiFetch('/v1/me', { method: 'PATCH', body: { locale }, schema: MeResponseSchema });
      invalidateCache('me');
      session.me = updated;
      showToast({ message: m.settings_preferences_saved(), tone: 'success' });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    }
  }

  async function toggleLocalCopy(enabled: boolean) {
    localCopy = enabled;
    setLocalCopyEnabled(enabled);
    // Al desactivarla se borran las copias que ya existen en este navegador.
    if (!enabled) await clearLocalCopies(me.user.id);
    showToast({ message: enabled ? m.settings_local_copy_on() : m.settings_local_copy_off(), tone: 'success' });
  }

  function toggleMotion(enabled: boolean) {
    reduceMotion = enabled;
    setReduceMotion(enabled);
  }
</script>

<section aria-labelledby="preferences-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <h2 id="preferences-heading" class="text-lg font-semibold">{m.settings_preferences()}</h2>
  <div class="mt-4 flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <label for="pref-locale" class="text-sm font-medium">{m.settings_language()}</label>
      <Select
        id="pref-locale"
        items={[
          { value: 'es', label: 'Español' },
          { value: 'en', label: m.settings_language_en_soon(), disabled: true },
        ]}
        bind:value={() => me.user.locale, (locale) => void changeLocale(locale)}
        label={m.settings_language()}
        describedBy="pref-locale-hint"
        size="lg"
        class="w-full max-w-xs"
      />
      <p id="pref-locale-hint" class="text-xs text-ink-muted">{m.settings_language_hint()}</p>
    </div>

    <Switch
      bind:checked={() => localCopy, (enabled) => void toggleLocalCopy(enabled)}
      label={m.settings_local_copy()}
      description={m.settings_local_copy_hint()}
      class="max-w-xl"
    />

    <Switch
      bind:checked={() => reduceMotion, toggleMotion}
      label={m.settings_reduce_motion()}
      description={m.settings_reduce_motion_hint()}
      class="max-w-xl"
    />

    <div class="flex flex-col gap-1.5">
      <p aria-hidden="true" class="text-sm font-medium">{m.settings_wheel()}</p>
      <SegmentedControl
        items={[
          { value: 'pan', label: m.settings_wheel_pan() },
          { value: 'zoom', label: m.settings_wheel_zoom() },
        ]}
        bind:value={() => wheel, (next) => changeWheel(next as WheelPreference)}
        label={m.settings_wheel()}
        describedBy="pref-wheel-hint"
        class="self-start"
      />
      <p id="pref-wheel-hint" class="text-xs text-ink-muted">{m.settings_wheel_hint()}</p>
    </div>
  </div>
</section>
