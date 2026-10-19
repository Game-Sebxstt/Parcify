<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, apiFetch, invalidateCache } from '../../lib/api.ts';
  import { clearLocalCopies, localCopyEnabled, setLocalCopyEnabled } from '../../lib/local-copies.ts';
  import { reduceMotionPreferred, setReduceMotion } from '../../lib/motion.ts';
  import { session } from '../../lib/session.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import { MeResponseSchema, type MeResponse } from '../../shared/api/me.js';
  import { showToast } from '../../ui/toast.svelte.ts';

  type Props = { me: MeResponse };
  let { me }: Props = $props();

  let localCopy = $state(true);
  let reduceMotion = $state(false);

  onMount(() => {
    localCopy = localCopyEnabled();
    reduceMotion = reduceMotionPreferred();
  });

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
      <select
        id="pref-locale"
        value={me.user.locale}
        aria-describedby="pref-locale-hint"
        onchange={(event) => void changeLocale(event.currentTarget.value)}
        class="h-11 w-full max-w-xs cursor-pointer rounded-panel border border-edge bg-surface-2 px-3 text-base text-ink hover:border-ink-muted focus-visible:border-coral"
      >
        <option value="es">Español</option>
        <option value="en" disabled>{m.settings_language_en_soon()}</option>
      </select>
      <p id="pref-locale-hint" class="text-xs text-ink-muted">{m.settings_language_hint()}</p>
    </div>

    <label class="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={localCopy}
        onchange={(event) => void toggleLocalCopy(event.currentTarget.checked)}
        class="mt-0.5 size-4 cursor-pointer accent-coral"
      />
      <span>
        <span class="block text-sm font-medium">{m.settings_local_copy()}</span>
        <span class="block text-xs text-ink-muted">{m.settings_local_copy_hint()}</span>
      </span>
    </label>

    <label class="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={reduceMotion}
        onchange={(event) => toggleMotion(event.currentTarget.checked)}
        class="mt-0.5 size-4 cursor-pointer accent-coral"
      />
      <span>
        <span class="block text-sm font-medium">{m.settings_reduce_motion()}</span>
        <span class="block text-xs text-ink-muted">{m.settings_reduce_motion_hint()}</span>
      </span>
    </label>
  </div>
</section>
