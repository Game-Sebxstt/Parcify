<script lang="ts">
  import { untrack } from 'svelte';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Link2Off from '@lucide/svelte/icons/link-2-off';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import RotateCwSquare from '@lucide/svelte/icons/rotate-cw-square';
  import SquareRoundCorner from '@lucide/svelte/icons/square-round-corner';
  import type { Engine, GeometryPatch, NodeRecord } from '../../../engine/index.ts';
  import { normalizeDeg, snapRotation } from '../../../engine/geometry/angles.ts';
  import { m } from '../../../paraglide/messages.js';
  import type { AnimProp } from '../../../shared/document/schema.js';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import FlipHorizontal from './icons/FlipHorizontal.svelte';
  import FlipVertical from './icons/FlipVertical.svelte';
  import KeyframeToggle from './KeyframeToggle.svelte';
  import PanelButton from './PanelButton.svelte';
  import Section from './Section.svelte';
  import { shared, type CommitMeta, type KeyframeContext, type PanelEdits, type Posed } from './panel.ts';

  type Props = {
    engine: Engine;
    records: readonly NodeRecord[];
    edits: PanelEdits;
    posed: Posed;
    readonly: boolean;
    // Rombos de keyframe junto a X, Y, An, Al y Rotación (solo con la línea de tiempo abierta).
    keyframes: KeyframeContext | null;
  };

  let { engine, records, edits, posed, readonly, keyframes }: Props = $props();

  // Límites de §2.16.
  const POSITION = 1e6;
  const SIZE = { min: 1, max: 1e5 };

  type Rounded = Extract<NodeRecord, { type: 'rect' | 'image' }>;

  const ids = $derived(records.map((record) => record.id));
  // geometryOf lee el árbol: se vuelve a pedir cada vez que cambian los registros de la selección, el cabezal o las
  // animaciones. Con la línea de tiempo abierta da lo que se ve en el cabezal.
  // geometryOf puede vaciar la cola del documento (syncModel), y eso avisa a las stores del motor: dentro de un
  // $derived, Svelte no deja escribir estado (state_unsafe_mutation), así que se lee sin seguimiento.
  const geometry = $derived.by(() => {
    void records;
    void posed.version;
    const at = posed.at;
    const targets = ids;
    return untrack(() => engine.commands.geometryOf(targets, { at }));
  });
  // Un conector solo se mueve: no gira ni cambia de tamaño desde el panel.
  const onlyConnectors = $derived(records.every((record) => record.type === 'connector'));
  const rounded = $derived(records.filter((record): record is Rounded => record.type === 'rect' || record.type === 'image'));
  const radius = $derived(shared(rounded, (record) => record.cornerRadius));
  const radiusMax = $derived(rounded.length ? Math.floor(Math.min(...rounded.map((record) => Math.min(record.w, record.h) / 2))) : 0);
  const rotation = $derived(geometry?.rotationDeg ?? null);
  const rotationMixed = $derived(rotation === null && records.length > 1);

  // Candado de proporción: estado de la interfaz, no del documento (el esquema no lo guarda).
  let ratioLocked = $state(false);

  function sizePatch(axis: 'w' | 'h', value: number): GeometryPatch {
    if (!ratioLocked || !geometry || geometry.w <= 0 || geometry.h <= 0) return { [axis]: value };
    const ratio = geometry.h / geometry.w;
    const other = axis === 'w' ? value * ratio : value / ratio;
    const clamped = Math.min(SIZE.max, Math.max(SIZE.min, other));
    return axis === 'w' ? { w: value, h: clamped } : { w: clamped, h: value };
  }

  // La rotación da la vuelta: 190 es −170 y −180 es 180.
  const rotationPatch = (value: number): GeometryPatch => ({ rotationDeg: normalizeDeg(value) });

  function snapAngle(value: number, mods: { shift: boolean; ctrl: boolean }): number {
    return snapRotation(value, { ...mods, thresholdDeg: engine.inputProfile.get().rotateSnapDeg }).angle;
  }

  function field(patch: (value: number) => GeometryPatch) {
    return {
      oninput: (value: number) => edits.previewGeometry(patch(value)),
      oncommit: (value: number, meta: CommitMeta) => edits.setGeometry(patch(value), meta),
      oncancel: () => edits.cancel(),
    };
  }
</script>

{#snippet key(prop: AnimProp, label: string, testid: string)}
  {#if keyframes}
    <KeyframeToggle context={keyframes} {records} {prop} {label} {testid} />
  {/if}
{/snippet}

{#if geometry}
  <Section title={m.editor_props_section_layout()} testid="props-layout">
    <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-x-1 gap-y-2">
      <div class="flex min-w-0 items-center gap-1">
        <ScrubInput
          class="flex-1"
          value={geometry.x}
          label={m.editor_props_x()}
          prefix="X"
          min={-POSITION}
          max={POSITION}
          {readonly}
          testid="props-x"
          {...field((x) => ({ x }))}
        />
        {@render key('offsetX', m.editor_props_x(), 'props-x-key')}
      </div>
      <span aria-hidden="true"></span>
      <div class="flex min-w-0 items-center gap-1">
        <ScrubInput
          class="flex-1"
          value={geometry.y}
          label={m.editor_props_y()}
          prefix="Y"
          min={-POSITION}
          max={POSITION}
          {readonly}
          testid="props-y"
          {...field((y) => ({ y }))}
        />
        {@render key('offsetY', m.editor_props_y(), 'props-y-key')}
      </div>

      <div class="flex min-w-0 items-center gap-1">
        <ScrubInput
          class="flex-1"
          value={geometry.w}
          label={m.editor_props_w()}
          prefix="An"
          min={SIZE.min}
          max={SIZE.max}
          readonly={readonly || onlyConnectors || geometry.w <= 0}
          testid="props-w"
          {...field((w) => sizePatch('w', w))}
        />
        {@render key('scaleX', m.editor_props_w(), 'props-w-key')}
      </div>
      {#if readonly}
        <span aria-hidden="true"></span>
      {:else}
        <PanelButton
          label={m.editor_props_ratio_lock()}
          pressed={ratioLocked}
          testid="props-ratio"
          onclick={() => (ratioLocked = !ratioLocked)}
        >
          {#if ratioLocked}<Link2 size={12} aria-hidden="true" />{:else}<Link2Off size={12} aria-hidden="true" />{/if}
        </PanelButton>
      {/if}
      <div class="flex min-w-0 items-center gap-1">
        <ScrubInput
          class="flex-1"
          value={geometry.h}
          label={m.editor_props_h()}
          prefix="Al"
          min={SIZE.min}
          max={SIZE.max}
          readonly={readonly || onlyConnectors || geometry.h <= 0}
          testid="props-h"
          {...field((h) => sizePatch('h', h))}
        />
        {@render key('scaleY', m.editor_props_h(), 'props-h-key')}
      </div>

      <div class="flex min-w-0 items-center gap-1">
        <ScrubInput
          class="flex-1"
          value={rotation ?? 0}
          mixed={rotationMixed}
          label={m.editor_props_rotation()}
          icon={RotateCw}
          unit="°"
          decimals={1}
          readonly={readonly || onlyConnectors}
          snap={snapAngle}
          testid="props-rotation"
          {...field(rotationPatch)}
        />
        {@render key('rotation', m.editor_props_rotation(), 'props-rotation-key')}
      </div>
      <span aria-hidden="true"></span>
      {#if rounded.length}
        <ScrubInput
          value={Math.min(radius.value ?? 0, radiusMax)}
          mixed={radius.mixed}
          label={m.editor_props_radius()}
          icon={SquareRoundCorner}
          min={0}
          max={radiusMax}
          decimals={0}
          {readonly}
          testid="props-radius"
          oninput={(cornerRadius) => edits.previewStyle({ cornerRadius })}
          oncommit={(cornerRadius, meta) => edits.setStyle({ cornerRadius }, meta)}
          oncancel={() => edits.cancel()}
        />
      {:else}
        <span aria-hidden="true"></span>
      {/if}
    </div>
    {#if !readonly && !onlyConnectors}
      <div class="flex items-center gap-0.5">
        <PanelButton label={m.editor_props_rotate_90()} testid="props-rotate-90" onclick={() => engine.commands.rotateBy(ids, 90)}>
          <RotateCwSquare size={14} aria-hidden="true" />
        </PanelButton>
        <PanelButton label={m.editor_props_flip_h()} kbd="Shift+H" testid="props-flip-h" onclick={() => engine.commands.flip(ids, 'h')}>
          <FlipHorizontal size={14} />
        </PanelButton>
        <PanelButton label={m.editor_props_flip_v()} kbd="Shift+V" testid="props-flip-v" onclick={() => engine.commands.flip(ids, 'v')}>
          <FlipVertical size={14} />
        </PanelButton>
      </div>
    {/if}
  </Section>
{/if}
