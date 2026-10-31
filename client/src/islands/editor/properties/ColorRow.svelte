<script lang="ts">
  import Minus from '@lucide/svelte/icons/minus';
  import { m } from '../../../paraglide/messages.js';
  import ColorPicker from '../../../ui/ColorPicker.svelte';
  import { hexDigits, parseHex, rgbaToHex } from '../../../ui/color.ts';
  import ScrubInput from '../../../ui/ScrubInput.svelte';
  import PanelButton from './PanelButton.svelte';
  import type { ColorChange, CommitMeta } from './panel.ts';

  type Props = {
    // #RRGGBBAA del primer elemento que tiene la propiedad.
    value: string;
    // Los elementos tienen colores distintos.
    mixed?: boolean;
    // Los elementos tienen opacidades distintas.
    alphaMixed?: boolean;
    // Nombre de la propiedad («Relleno», «Trazo»).
    label: string;
    readonly?: boolean;
    // Colores de la página, calculados al abrir el selector.
    colors: () => string[];
    removeLabel?: string | undefined;
    testid: string;
    onpreview: (change: ColorChange) => void;
    oncommit: (change: ColorChange, meta: CommitMeta) => void;
    oncancel: () => void;
    onremove?: (() => void) | undefined;
  };

  let { value, mixed = false, alphaMixed = false, label, readonly = false, colors, removeLabel, testid, onpreview, oncommit, oncancel, onremove }: Props =
    $props();

  const INVALID_MS = 1000;

  let open = $state(false);
  let draft = $state<string | null>(null);
  let invalid = $state(false);
  let invalidTimer: ReturnType<typeof setTimeout> | undefined;

  const documentColors = $derived(open ? colors() : []);
  const rgba = $derived(parseHex(value) ?? { r: 0, g: 0, b: 0, a: 1 });
  const alpha = $derived(Math.round(rgba.a * 100));
  const shown = $derived(draft ?? (mixed ? '' : hexDigits(value)));

  // Cada elemento conserva su RGB y recibe la opacidad nueva.
  const withAlpha =
    (a: number): ColorChange =>
    (current) =>
      rgbaToHex({ ...(parseHex(current) ?? rgba), a });

  // Con colores distintos, si el selector solo cambió la opacidad del color mostrado, cada elemento conserva su RGB.
  function fromPicker(next: string): ColorChange {
    const parsed = parseHex(next);
    if (!mixed || !parsed || parsed.r !== rgba.r || parsed.g !== rgba.g || parsed.b !== rgba.b) return next;
    return withAlpha(parsed.a);
  }

  // Seis dígitos conservan la opacidad de cada elemento; ocho la cambian.
  function confirm(fromEnter: boolean) {
    if (draft === null) return;
    const text = draft;
    draft = null;
    const parsed = parseHex(text);
    if (!parsed) {
      if (fromEnter) {
        invalid = true;
        clearTimeout(invalidTimer);
        invalidTimer = setTimeout(() => (invalid = false), INVALID_MS);
      }
      return;
    }
    if (text.trim().replace(/^#/, '').length === 8) {
      const next = rgbaToHex(parsed);
      if (next !== value || mixed) oncommit(next, { merge: false });
      return;
    }
    const keepAlpha = (current: string) => rgbaToHex({ ...parsed, a: parseHex(current)?.a ?? rgba.a });
    if (mixed || keepAlpha(value) !== value) oncommit(keepAlpha, { merge: false });
  }

  function onKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirm(true);
      event.currentTarget.select();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      draft = null;
      event.currentTarget.blur();
    }
  }

  $effect(() => () => clearTimeout(invalidTimer));
</script>

<div class="flex h-7 min-w-0 items-center gap-1.5 sheet:h-11 sheet:gap-1" data-testid={testid}>
  <ColorPicker
    bind:open
    {value}
    {label}
    {documentColors}
    disabled={readonly}
    testid="{testid}-swatch"
    oninput={(next) => onpreview(fromPicker(next))}
    oncommit={(next, meta) => oncommit(fromPicker(next), meta)}
    {oncancel}
  />
  <div
    class={[
      'flex h-6 min-w-0 flex-1 items-center rounded-control border bg-surface-2 text-xs sheet:h-9 sheet:text-sm',
      'focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-coral',
      invalid ? 'border-danger' : 'border-transparent',
      !readonly && !invalid && 'hover:border-edge/60',
    ]}
  >
    <input
      type="text"
      autocomplete="off"
      spellcheck="false"
      maxlength={9}
      aria-label={m.editor_props_color_hex({ name: label })}
      aria-invalid={invalid || undefined}
      aria-readonly={readonly || undefined}
      {readonly}
      placeholder={mixed ? m.ui_mixed() : undefined}
      value={shown}
      data-testid="{testid}-hex"
      class="h-full min-w-0 flex-1 bg-transparent px-1.5 uppercase tabular outline-none placeholder:normal-case placeholder:text-ink-muted"
      oninput={(event) => (draft = event.currentTarget.value)}
      onkeydown={onKeydown}
      onfocus={(event) => event.currentTarget.select()}
      onblur={() => confirm(false)}
    />
  </div>
  <ScrubInput
    class="w-13 shrink-0 sheet:w-16"
    value={alpha}
    label={m.editor_props_color_alpha({ name: label })}
    unit="%"
    min={0}
    max={100}
    decimals={0}
    mixed={alphaMixed}
    {readonly}
    testid="{testid}-alpha"
    oninput={(percent) => onpreview(withAlpha(percent / 100))}
    oncommit={(percent, meta) => oncommit(withAlpha(percent / 100), meta)}
    {oncancel}
  />
  {#if onremove && !readonly}
    <PanelButton label={removeLabel ?? label} onclick={onremove}>
      <Minus size={14} aria-hidden="true" />
    </PanelButton>
  {/if}
</div>
