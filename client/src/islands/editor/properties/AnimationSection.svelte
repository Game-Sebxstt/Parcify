<script lang="ts">
  import Hourglass from '@lucide/svelte/icons/hourglass';
  import InfinityIcon from '@lucide/svelte/icons/infinity';
  import Play from '@lucide/svelte/icons/play';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Square from '@lucide/svelte/icons/square';
  import Timer from '@lucide/svelte/icons/timer';
  import { fromStore } from 'svelte/store';
  import { ANIMATION_PRESETS, type AnimationPresetId, type Engine, type NodeRecord } from '../../../engine/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import { ANIMATION_LIMITS } from '../../../shared/document/limits.js';
  import type { Animation } from '../../../shared/document/schema.js';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Switch from '../../../ui/Switch.svelte';
  import { showToast } from '../../../ui/toast.svelte.ts';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { shared } from './panel.ts';

  type Props = {
    engine: Engine;
    records: readonly NodeRecord[];
    readonly: boolean;
    // Versión de las animaciones del documento: se vuelven a leer cuando cambian.
    version: number;
    // «Animar con keyframes» y «Editar en la línea de tiempo»: la abren con Grabar encendido.
    onkeyframes: () => void;
  };

  let { engine, records, readonly, version, onkeyframes }: Props = $props();

  const PRESET_LABELS: Record<AnimationPresetId, () => string> = {
    aparecer: m.editor_anim_preset_aparecer,
    deslizar: m.editor_anim_preset_deslizar,
    escalar: m.editor_anim_preset_escalar,
    rebote: m.editor_anim_preset_rebote,
  };
  const DIRECTIONS = [
    { value: 'normal', label: m.editor_anim_direction_normal() },
    { value: 'alternate', label: m.editor_anim_direction_alternate() },
  ];
  const SECONDS = { min: ANIMATION_LIMITS.minDurationMs / 1000, max: ANIMATION_LIMITS.maxDurationMs / 1000, delay: ANIMATION_LIMITS.maxDelayMs / 1000 };

  // Un conector no se anima: sigue a sus nodos.
  const ids = $derived(records.filter((record) => record.type !== 'connector').map((record) => record.id));
  const animated = $derived.by(() => {
    void version;
    const out: Array<{ id: string; animation: Animation }> = [];
    for (const id of ids) {
      const animation = engine.core.store.animation(id);
      if (animation) out.push({ id, animation });
    }
    return out;
  });
  const animatedIds = $derived(animated.map((item) => item.id));
  const animations = $derived(animated.map((item) => item.animation));
  const duration = $derived(shared(animations, (animation) => animation.duration / 1000));
  const delay = $derived(shared(animations, (animation) => animation.delay / 1000));
  const loop = $derived(shared(animations, (animation) => animation.loop));
  const direction = $derived(shared(animations, (animation) => animation.direction));
  const onPresent = $derived(animations.length > 0 && animations.every((animation) => animation.autoplay === 'present'));

  const player = $derived(fromStore(engine.anim.state));
  const playing = $derived.by(() => {
    const state = player.current;
    if (!state.preview || state.status !== 'playing' || !state.previewIds) return false;
    return state.previewIds.some((id) => animatedIds.includes(id));
  });

  const set = (settings: Partial<Pick<Animation, 'duration' | 'delay' | 'loop' | 'direction' | 'autoplay'>>) => engine.anim.keyframes.setAnimations(animatedIds, settings);

  function togglePlay() {
    if (playing) engine.anim.preview(null);
    else engine.anim.preview(animatedIds);
  }

  // El efecto sustituye las pistas que usa y se ve enseguida en el lienzo.
  function applyPreset(preset: AnimationPresetId) {
    if (!engine.anim.keyframes.applyPreset(ids, preset)) {
      showToast({ message: m.editor_anim_preset_error(), tone: 'error' });
      return;
    }
    engine.anim.preview(ids);
  }

  const BUTTON = [
    'inline-flex h-7 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-control bg-surface-2 px-2 text-xs text-ink sheet:h-11 sheet:text-sm',
    'transition-colors duration-(--dur-fast) hover:bg-petrol',
    'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral',
  ];
</script>

{#if ids.length && (animated.length || !readonly)}
  <Section title={m.editor_props_section_animation()} testid="props-animation">
    {#if animated.length}
      <!-- Los dos botones no caben en una fila de 224 px sin cortar el texto: van uno debajo de otro. -->
      <div class="flex min-w-0 flex-col gap-1.5">
        <button type="button" class={[BUTTON, 'w-full']} data-testid="props-anim-play" onclick={togglePlay}>
          {#if playing}
            <Square size={10} fill="currentColor" aria-hidden="true" />{m.editor_anim_stop()}
          {:else}
            <Play size={12} aria-hidden="true" />{m.editor_anim_play()}
          {/if}
        </button>
        {#if !readonly}
          <button type="button" class={[BUTTON, 'w-full']} data-testid="props-anim-edit" onclick={onkeyframes}>
            {m.editor_anim_edit_timeline()}
          </button>
        {/if}
      </div>
      <div class="grid min-w-0 grid-cols-2 gap-2">
        <ScrubInput
          value={duration.value ?? 1}
          mixed={duration.mixed}
          label={m.editor_anim_duration()}
          icon={Timer}
          unit="s"
          step={0.01}
          min={SECONDS.min}
          max={SECONDS.max}
          decimals={2}
          {readonly}
          testid="props-anim-duration"
          oncommit={(value) => set({ duration: Math.round(value * 1000) })}
        />
        <ScrubInput
          value={delay.value ?? 0}
          mixed={delay.mixed}
          label={m.editor_anim_delay()}
          icon={Hourglass}
          unit="s"
          step={0.01}
          min={0}
          max={SECONDS.delay}
          decimals={2}
          {readonly}
          testid="props-anim-delay"
          oncommit={(value) => set({ delay: Math.round(value * 1000) })}
        />
      </div>
      <div class="grid min-w-0 grid-cols-2 items-center gap-2">
        <div class="flex min-w-0 items-center gap-1">
          <ScrubInput
            class="flex-1"
            value={loop.value || 1}
            mixed={loop.mixed || loop.value === 0}
            emptyText={loop.value === 0 && !loop.mixed ? '∞' : undefined}
            label={m.editor_anim_loop()}
            icon={Repeat}
            min={1}
            max={ANIMATION_LIMITS.maxLoop}
            decimals={0}
            {readonly}
            testid="props-anim-loop"
            oncommit={(value) => set({ loop: value })}
          />
          {#if !readonly}
            <PanelButton label={m.editor_anim_loop_forever()} pressed={loop.value === 0 && !loop.mixed} testid="props-anim-forever" onclick={() => set({ loop: loop.value === 0 && !loop.mixed ? 1 : 0 })}>
              <InfinityIcon size={14} aria-hidden="true" />
            </PanelButton>
          {/if}
        </div>
        <SegmentedControl
          class="justify-self-start"
          items={DIRECTIONS}
          value={direction.mixed ? '' : (direction.value ?? 'normal')}
          label={m.editor_anim_direction()}
          size="sm"
          disabled={readonly}
          testid="props-anim-direction"
          onValueChange={(value) => set({ direction: value as Animation['direction'] })}
        />
      </div>
      <div class="flex min-w-0 items-center justify-between gap-2">
        <span aria-hidden="true" class="min-w-0 truncate text-xs text-ink">{m.editor_anim_on_present()}</span>
        <Switch
          checked={onPresent}
          ariaLabel={m.editor_anim_on_present()}
          disabled={readonly}
          testid="props-anim-present"
          onCheckedChange={(checked) => set({ autoplay: checked ? 'present' : 'none' })}
        />
      </div>
    {/if}
    {#if !readonly}
      <div role="group" aria-label={m.editor_anim_effects()} class="flex min-w-0 flex-wrap gap-1.5" data-testid="props-anim-presets">
        {#each ANIMATION_PRESETS as preset (preset)}
          <button type="button" class={BUTTON} onclick={() => applyPreset(preset)}>{PRESET_LABELS[preset]()}</button>
        {/each}
      </div>
      {#if !animated.length}
        <button type="button" class={[BUTTON, 'w-full']} data-testid="props-anim-keyframes" onclick={onkeyframes}>
          {m.editor_anim_keyframes()}
        </button>
      {/if}
    {/if}
  </Section>
{/if}
