<script lang="ts" module>
  // El cuentagotas solo existe en Chromium de escritorio; los tipos del DOM aún no lo incluyen.
  type EyeDropperApi = { open: () => Promise<{ sRGBHex: string }> };
  type EyeDropperCtor = new () => EyeDropperApi;
</script>

<script lang="ts">
  import Pipette from '@lucide/svelte/icons/pipette';
  import type { Snippet } from 'svelte';
  import { m } from '../paraglide/messages.js';
  import { CHECKER, hexDigits, hexToHsva, hsvaToHex, parseHex, rgbToHsv, swatchBackground, type Hsva } from './color.ts';
  import Popover from './Popover.svelte';
  import ScrubInput, { type ScrubCommit } from './ScrubInput.svelte';
  import Slider from './Slider.svelte';

  type Props = {
    // #RRGGBBAA
    value: string;
    // Nombre accesible del disparador («Color de relleno»).
    label: string;
    documentColors?: readonly string[];
    open?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    // Lado de la muestra que abre el selector: 16 px en el panel, 24 px en las barras.
    swatchSize?: 16 | 24;
    // Disparador propio en lugar de la muestra.
    trigger?: Snippet<[Record<string, unknown>]>;
    disabled?: boolean;
    testid?: string;
    // Solo vista previa, mientras se arrastra el área o un slider.
    oninput?: (color: string) => void;
    oncommit?: (color: string, meta: ScrubCommit) => void;
    oncancel?: () => void;
  };

  let {
    value,
    label,
    documentColors = [],
    open = $bindable(false),
    side = 'left',
    align = 'start',
    swatchSize = 16,
    trigger,
    disabled = false,
    testid,
    oninput,
    oncommit,
    oncancel,
  }: Props = $props();

  const MERGE_MS = 500;
  const eyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window ? (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper : null;

  // Sin saturación o sin brillo el hex no dice el tono: se conserva el último para que el área no salte al rojo.
  let lastHue = 0;
  let hsva = $derived<Hsva>(hexToHsva(value, lastHue) ?? { h: 0, s: 0, v: 0, a: 1 });
  let hexDraft = $state<string | null>(null);
  let hexInvalid = $state(false);

  // Vista previa sin confirmar y color de partida para Esc.
  let pending: string | null = null;
  let start: Hsva | null = null;
  let areaDrag: number | null = null;
  let lastKeyAt = -Infinity;
  let hexTimer: ReturnType<typeof setTimeout> | undefined;

  const current = $derived(hsvaToHex(hsva));
  const opaque = $derived(hsvaToHex({ ...hsva, a: 1 }));
  const alphaPercent = $derived(Math.round(hsva.a * 100));
  const areaText = $derived(m.ui_color_area_value({ s: Math.round(hsva.s * 100), v: Math.round(hsva.v * 100) }));

  function set(next: Hsva) {
    hsva = next;
    lastHue = next.h;
  }

  function preview(next: Hsva) {
    if (pending === null) start = hsva;
    set(next);
    pending = hsvaToHex(next);
    oninput?.(pending);
  }

  // Confirmar el mismo color que ya hay no escribe nada; si hubo vista previa, se descarta.
  function commit(next: Hsva = hsva, merge = false) {
    set(next);
    const hex = hsvaToHex(next);
    const previewed = pending !== null;
    pending = null;
    start = null;
    // Una confirmación que no viene de las flechas del área corta la ventana de fusión.
    lastKeyAt = -Infinity;
    if (hex !== value) oncommit?.(hex, { merge });
    else if (previewed) oncancel?.();
  }

  function cancel() {
    if (pending === null) return;
    if (start) set(start);
    pending = null;
    start = null;
    oncancel?.();
  }

  function fromPointer(event: PointerEvent & { currentTarget: HTMLElement }): Hsva {
    const rect = event.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return { ...hsva, s, v };
  }

  function areaDown(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Un puntero ya inactivo no se puede capturar.
    }
    areaDrag = event.pointerId;
    preview(fromPointer(event));
  }

  function areaMove(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (areaDrag === event.pointerId) preview(fromPointer(event));
  }

  function areaUp(event: PointerEvent) {
    if (areaDrag !== event.pointerId) return;
    areaDrag = null;
    commit();
  }

  function areaCancel(event: PointerEvent) {
    if (areaDrag !== event.pointerId) return;
    areaDrag = null;
    cancel();
  }

  function areaKey(event: KeyboardEvent) {
    const delta = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, delta],
      ArrowDown: [0, -delta],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const now = performance.now();
    const merge = now - lastKeyAt < MERGE_MS;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    commit({ ...hsva, s: clamp(hsva.s + move[0]), v: clamp(hsva.v + move[1]) }, merge);
    lastKeyAt = now;
  }

  // Esc durante el arrastre del área deja el color como estaba y no cierra el popover.
  function onWindowKeydown(event: KeyboardEvent) {
    if (areaDrag === null || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    areaDrag = null;
    cancel();
  }

  function confirmHex(fromEnter: boolean) {
    if (hexDraft === null) return;
    const rgba = parseHex(hexDraft);
    if (!rgba) {
      if (fromEnter) {
        hexInvalid = true;
        clearTimeout(hexTimer);
        hexTimer = setTimeout(() => (hexInvalid = false), 1000);
      } else hexDraft = null;
      return;
    }
    // Con 6 dígitos se conserva la opacidad actual.
    const digits = hexDraft.trim().replace(/^#/, '').length;
    hexDraft = null;
    commit(rgbToHsv({ ...rgba, a: digits === 8 ? rgba.a : hsva.a }, hsva.h));
  }

  function hexKey(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmHex(true);
    } else if (event.key === 'Escape' && hexDraft !== null) {
      event.preventDefault();
      event.stopPropagation();
      hexDraft = null;
    }
  }

  async function pick() {
    if (!eyeDropper) return;
    try {
      const { sRGBHex } = await new eyeDropper().open();
      const rgba = parseHex(sRGBHex);
      if (rgba) commit(rgbToHsv({ ...rgba, a: hsva.a }, hsva.h));
    } catch {
      // Esc o clic fuera cancela el cuentagotas: no hay nada que hacer.
    }
  }

  function useColor(color: string) {
    const next = hexToHsva(color, hsva.h);
    if (next) commit(next);
  }

  // Cerrar el popover con una vista previa activa la confirma, igual que perder el foco.
  function onOpenChange(next: boolean) {
    if (!next) {
      areaDrag = null;
      if (pending !== null) commit();
    }
  }

  // Los sliders y el campo de opacidad se desmontan después y vuelven a llamar a commit(): no debe quedar nada pendiente.
  $effect(() => () => {
    clearTimeout(hexTimer);
    if (pending === null) return;
    const hex = pending;
    pending = null;
    start = null;
    oncommit?.(hex, { merge: false });
  });
</script>

<svelte:window onkeydowncapture={onWindowKeydown} />

{#snippet swatch(props: Record<string, unknown>)}
  <button
    {...props}
    type="button"
    aria-label={label}
    {disabled}
    data-testid={testid}
    class={[
      'shrink-0 cursor-pointer rounded-xs border border-edge/40 disabled:cursor-not-allowed disabled:opacity-40',
      swatchSize === 16 ? 'size-4' : 'size-6',
      // En una hoja del móvil se toca en 44×44 y se ve la muestra de 20 px del centro.
      // bg-clip con !important: el `background` en línea de la muestra lo reiniciaría a border-box.
      'sheet:size-11 sheet:border-transparent sheet:bg-clip-content! sheet:p-[11px] sheet:outline-1 sheet:-outline-offset-12 sheet:outline-edge/40',
    ]}
    style:background={swatchBackground(value)}
  ></button>
{/snippet}

<Popover bind:open label={m.ui_color_picker()} trigger={trigger ?? swatch} {side} {align} {onOpenChange} class="w-62 sheet:w-72">
  <div class="flex flex-col gap-3">
    <p class="text-2xs font-semibold text-ink">{m.ui_color_solid()}</p>
    <div
      role="slider"
      tabindex="0"
      aria-label={m.ui_color_area()}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsva.s * 100)}
      aria-valuetext={areaText}
      class="relative h-37 w-full cursor-crosshair touch-none rounded-control outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
      style:background-color="hsl({hsva.h} 100% 50%)"
      style:background-image="linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)"
      onpointerdown={areaDown}
      onpointermove={areaMove}
      onpointerup={areaUp}
      onpointercancel={areaCancel}
      onkeydown={areaKey}
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-ink shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
        style:left="{hsva.s * 100}%"
        style:top="{(1 - hsva.v) * 100}%"
        style:background-color={opaque}
      ></span>
    </div>
    <Slider
      value={hsva.h}
      min={0}
      max={360}
      label={m.ui_color_hue()}
      valueText={`${Math.round(hsva.h)}°`}
      track="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
      oninput={(h) => preview({ ...hsva, h })}
      oncommit={(h) => commit({ ...hsva, h })}
      oncancel={cancel}
    />
    <Slider
      value={alphaPercent}
      min={0}
      max={100}
      label={m.ui_color_alpha()}
      valueText={`${alphaPercent} %`}
      track="linear-gradient(to right, transparent, {opaque}), {CHECKER}"
      oninput={(a) => preview({ ...hsva, a: a / 100 })}
      oncommit={(a) => commit({ ...hsva, a: a / 100 })}
      oncancel={cancel}
    />
    <div class="flex items-center gap-2">
      <div
        class={[
          'flex h-6 min-w-0 flex-1 items-center rounded-control border bg-surface-2 text-xs sheet:h-9',
          'focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-coral',
          hexInvalid ? 'border-danger' : 'border-transparent hover:border-edge/60',
        ]}
      >
        <span aria-hidden="true" class="pl-1.5 text-ink-muted select-none">#</span>
        <input
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength={9}
          aria-label={m.ui_color_hex()}
          aria-invalid={hexInvalid || undefined}
          value={hexDraft ?? hexDigits(current)}
          class="h-full min-w-0 flex-1 bg-transparent px-1 uppercase tabular outline-none"
          oninput={(event) => (hexDraft = event.currentTarget.value)}
          onkeydown={hexKey}
          onfocus={(event) => event.currentTarget.select()}
          onblur={() => confirmHex(false)}
        />
      </div>
      <ScrubInput
        class="w-13 sheet:w-16"
        value={alphaPercent}
        label={m.ui_color_alpha()}
        unit="%"
        min={0}
        max={100}
        decimals={0}
        oninput={(a) => preview({ ...hsva, a: a / 100 })}
        oncommit={(a, meta) => commit({ ...hsva, a: a / 100 }, meta.merge)}
        oncancel={cancel}
      />
      {#if eyeDropper}
        <button
          type="button"
          aria-label={m.ui_color_eyedropper()}
          class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-petrol hover:text-ink sheet:size-11"
          onclick={() => void pick()}
        >
          <Pipette size={14} aria-hidden="true" class="sheet:size-5" />
        </button>
      {/if}
    </div>
    {#if documentColors.length > 0}
      <div class="flex flex-col gap-2 border-t border-edge/25 pt-3">
        <p class="text-2xs font-semibold text-ink-muted">{m.ui_color_document()}</p>
        <!-- Con el dedo, cada muestra se toca en 44×44 y se ve la de 24 px del centro. -->
        <div class="grid grid-cols-8 gap-1.5 sheet:grid-cols-6 sheet:gap-0">
          {#each documentColors as color (color)}
            <button
              type="button"
              aria-label={m.ui_color_use({ color: hexDigits(color) })}
              aria-pressed={color.toUpperCase() === current}
              class={[
                'size-5 cursor-pointer rounded-xs border border-edge/40 aria-pressed:outline-1 aria-pressed:outline-offset-1 aria-pressed:outline-coral',
                'sheet:size-11 sheet:border-transparent sheet:bg-clip-content! sheet:p-2.5 sheet:outline-1 sheet:-outline-offset-10 sheet:outline-edge/40 sheet:aria-pressed:outline-2 sheet:aria-pressed:-outline-offset-10 sheet:aria-pressed:outline-coral',
              ]}
              style:background={swatchBackground(color)}
              onclick={() => useColor(color)}
            ></button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</Popover>
