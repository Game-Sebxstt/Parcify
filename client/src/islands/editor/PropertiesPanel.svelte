<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import BringToFront from '@lucide/svelte/icons/bring-to-front';
  import Copy from '@lucide/svelte/icons/copy';
  import Italic from '@lucide/svelte/icons/italic';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import Underline from '@lucide/svelte/icons/underline';
  import { FONT_FAMILIES, type FontFamily } from '../../shared/document/schema.js';
  import SendToBack from '@lucide/svelte/icons/send-to-back';
  import Trash from '@lucide/svelte/icons/trash';
  import type { Commands } from '../../engine/commands/Commands.ts';
  import Group from '@lucide/svelte/icons/group';
  import Ungroup from '@lucide/svelte/icons/ungroup';
  import { FRAME_PRESETS, type FramePresetId, type NodeRecord, type StylePatch, type Tool } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import ToolButton from './ToolButton.svelte';

  type Props = {
    records: readonly NodeRecord[];
    commands: Commands;
    readOnly: boolean;
    tool: Tool;
    preset: FramePresetId;
    onpreset: (preset: FramePresetId) => void;
  };

  let { records, commands, readOnly, tool, preset, onpreset }: Props = $props();

  type Styled = Extract<NodeRecord, { strokeDash: unknown }>;
  const DEFAULT_SHADOW = { x: 0, y: 4, blur: 12, color: '#00000066' };
  const DASHES = [
    { id: 'solid', label: m.editor_props_dash_solid },
    { id: 'dashed', label: m.editor_props_dash_dashed },
    { id: 'dotted', label: m.editor_props_dash_dotted },
  ] as const;

  type TextNode = Extract<NodeRecord, { type: 'text' }>;
  type Labelled = Extract<NodeRecord, { labelFontSize?: unknown }>;
  const WEIGHTS = [
    { id: 400, label: m.editor_props_weight_400 },
    { id: 500, label: m.editor_props_weight_500 },
    { id: 600, label: m.editor_props_weight_600 },
    { id: 700, label: m.editor_props_weight_700 },
  ] as const;
  const ALIGNS = [
    { id: 'left', label: m.editor_props_align_left },
    { id: 'center', label: m.editor_props_align_center },
    { id: 'right', label: m.editor_props_align_right },
  ] as const;
  const VALIGNS = [
    { id: 'top', label: m.editor_props_valign_top },
    { id: 'middle', label: m.editor_props_valign_middle },
    { id: 'bottom', label: m.editor_props_valign_bottom },
  ] as const;
  const LABEL_TYPES = new Set(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon', 'arc', 'connector']);
  type Connector = Extract<NodeRecord, { type: 'connector' }>;
  type Ended = Extract<NodeRecord, { startCap: unknown }>;
  type ImageNode = Extract<NodeRecord, { type: 'image' }>;
  type Rounded = Extract<NodeRecord, { type: 'rect' | 'image' }>;
  const ROUTES = [
    { id: 'straight', label: m.editor_props_route_straight },
    { id: 'elbow', label: m.editor_props_route_elbow },
    { id: 'curved', label: m.editor_props_route_curved },
  ] as const;
  const CAPS = [
    { id: 'none', label: m.editor_props_cap_none },
    { id: 'arrow', label: m.editor_props_cap_arrow },
    { id: 'triangle', label: m.editor_props_cap_triangle },
    { id: 'circle', label: m.editor_props_cap_circle },
    { id: 'bar', label: m.editor_props_cap_bar },
  ] as const;
  const FITS = [
    { id: 'fill', label: m.editor_props_fit_fill },
    { id: 'contain', label: m.editor_props_fit_contain },
    { id: 'cover', label: m.editor_props_fit_cover },
  ] as const;
  const MAX_ALT = 300;
  type FrameNode = Extract<NodeRecord, { type: 'frame' }>;
  const PRESET_LABELS: Record<FramePresetId, () => string> = {
    '16:9': m.editor_preset_16_9,
    '4:3': m.editor_preset_4_3,
    '1:1': m.editor_preset_1_1,
    A4: m.editor_preset_a4,
    'A4-landscape': m.editor_preset_a4_landscape,
    letter: m.editor_preset_letter,
    phone: m.editor_preset_phone,
    story: m.editor_preset_story,
  };
  const PRESETS = FRAME_PRESETS.map((item) => ({ id: item.id, label: PRESET_LABELS[item.id] }));

  const first = $derived(records[0]);
  const textNode = $derived(records.find((record): record is TextNode => record.type === 'text'));
  const labelled = $derived(records.find((record): record is Labelled => LABEL_TYPES.has(record.type)));
  const sizeOf = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || min)));
  const styled = $derived(records.find((record): record is Styled => 'strokeDash' in record));
  const hasFill = $derived(records.some((record) => 'fill' in record && record.type !== 'line' && record.type !== 'connector'));
  const rect = $derived(records.find((record): record is Rounded => record.type === 'rect' || record.type === 'image'));
  const connector = $derived(records.find((record): record is Connector => record.type === 'connector'));
  const ended = $derived(records.find((record): record is Ended => 'startCap' in record));
  const image = $derived(records.find((record): record is ImageNode => record.type === 'image'));
  const frameNode = $derived(records.find((record): record is FrameNode => record.type === 'frame'));
  const hasContainer = $derived(records.some((record) => record.type === 'group' || record.type === 'frame'));
  const allLocked = $derived(records.length > 0 && records.every((record) => record.locked));
  const allVisible = $derived(records.every((record) => record.visible));
  const disabled = $derived(readOnly || allLocked);

  const hex = (color: string | null | undefined) => (color ?? '#D9D9D9FF').slice(0, 7);
  const alpha = (color: string | null | undefined) => (color && color.length === 9 ? color.slice(7) : 'FF');
  const withAlpha = (value: string, previous: string | null | undefined) => `${value.toUpperCase()}${alpha(previous)}`;

  // Selector de color y deslizadores: vista previa mientras se mueven, escritura al soltar (o 250 ms quieto).
  const preview = (patch: StylePatch) => commands.previewStyle(patch);
  const commit = () => commands.commitStyle();
</script>

{#snippet choice<T extends string>(label: string, options: ReadonlyArray<{ id: T; label: () => string }>, current: T, pick: (value: T) => void)}
  <div role="radiogroup" aria-label={label} class="flex gap-1 rounded-full bg-surface-2 p-1">
    {#each options as option (option.id)}
      <button
        type="button"
        role="radio"
        aria-checked={current === option.id}
        onclick={() => pick(option.id)}
        class={['h-7 flex-1 cursor-pointer rounded-full text-xs font-medium', current === option.id ? 'bg-petrol text-ink' : 'text-ink-muted hover:text-ink'].join(' ')}
      >
        {option.label()}
      </button>
    {/each}
  </div>
{/snippet}

<aside aria-label={m.editor_props_label()} class="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto bg-surface-1 p-4 text-sm">
  {#if !first && tool === 'frame' && !readOnly}
    <div class="flex flex-col gap-3">
      <span class="font-semibold">{m.editor_props_preset()}</span>
      <p class="text-ink-muted">{m.editor_frame_presets_hint()}</p>
      <div role="radiogroup" aria-label={m.editor_props_preset()} class="flex flex-col gap-1">
        {#each PRESETS as option (option.id)}
          <button
            type="button"
            role="radio"
            aria-checked={preset === option.id}
            onclick={() => onpreset(option.id)}
            class={['h-8 cursor-pointer rounded-panel px-3 text-left', preset === option.id ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'].join(' ')}
          >
            {option.label()}
          </button>
        {/each}
      </div>
    </div>
  {:else if !first}
    <p class="text-ink-muted">{readOnly ? m.editor_props_read_only() : m.editor_props_empty()}</p>
  {:else}
    {#if frameNode}
      <fieldset class="flex flex-col gap-3" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_frame()}</legend>
        <label class="flex flex-col gap-1">
          <span class="text-ink-muted">{m.editor_props_preset()}</span>
          <select
            value={frameNode.presetName ?? ''}
            onchange={(event) => {
              if (event.currentTarget.value) commands.applyFramePreset(event.currentTarget.value as FramePresetId);
            }}
            class="h-8 cursor-pointer rounded-panel bg-surface-2 px-2"
          >
            <option value="" disabled>{m.editor_props_preset_custom()}</option>
            {#each PRESETS as option (option.id)}
              <option value={option.id}>{option.label()}</option>
            {/each}
          </select>
        </label>
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="prop-frame-fill"
            checked={frameNode.fill !== null}
            onchange={(event) => commands.setStyle({ fill: event.currentTarget.checked ? (frameNode.fill ?? '#FFFFFFFF') : null })}
            class="size-4 accent-coral"
          />
          <label for="prop-frame-fill" class="flex-1">{frameNode.fill ? m.editor_props_fill() : m.editor_props_no_fill()}</label>
          <input
            type="color"
            aria-label={m.editor_props_fill()}
            value={hex(frameNode.fill)}
            disabled={disabled || frameNode.fill === null}
            oninput={(event) => preview({ fill: withAlpha(event.currentTarget.value, frameNode.fill) })}
            onchange={commit}
            class="h-8 w-10 cursor-pointer rounded-panel bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
        <label class="flex items-center gap-2">
          <input type="checkbox" checked={frameNode.clip} onchange={(event) => commands.setStyle({ clip: event.currentTarget.checked })} class="size-4 accent-coral" />
          {m.editor_props_clip()}
        </label>
      </fieldset>
    {/if}
    {#if records.length > 1}
      <p class="font-semibold">{m.editor_props_count({ count: records.length })}</p>
    {/if}

    {#if textNode}
      <fieldset class="flex flex-col gap-3" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_text()}</legend>
        <label class="flex flex-col gap-1">
          <span class="text-ink-muted">{m.editor_props_font()}</span>
          <select
            value={textNode.fontFamily}
            onchange={(event) => commands.setStyle({ fontFamily: event.currentTarget.value as FontFamily })}
            class="h-8 cursor-pointer rounded-panel bg-surface-2 px-2"
          >
            {#each FONT_FAMILIES as family (family)}
              <option value={family}>{family}</option>
            {/each}
          </select>
        </label>
        <div class="flex gap-2">
          <label class="flex w-20 flex-col gap-1">
            <span class="text-ink-muted">{m.editor_props_font_size()}</span>
            <input
              type="number"
              min="4"
              max="800"
              step="1"
              value={textNode.fontSize}
              onchange={(event) => commands.setStyle({ fontSize: sizeOf(event.currentTarget.value, 4, 800) })}
              class="h-8 rounded-panel bg-surface-2 px-2 tabular"
            />
          </label>
          <label class="flex flex-1 flex-col gap-1">
            <span class="text-ink-muted">{m.editor_props_font_weight()}</span>
            <select
              value={textNode.fontWeight}
              onchange={(event) => commands.setStyle({ fontWeight: Number(event.currentTarget.value) as 400 | 500 | 600 | 700 })}
              class="h-8 cursor-pointer rounded-panel bg-surface-2 px-2"
            >
              {#each WEIGHTS as weight (weight.id)}
                <option value={weight.id}>{weight.label()}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="flex gap-1">
          {#each [{ key: 'italic', label: m.editor_props_italic, icon: Italic }, { key: 'underline', label: m.editor_props_underline, icon: Underline }, { key: 'strike', label: m.editor_props_strike, icon: Strikethrough }] as const as toggle (toggle.key)}
            <ToolButton side="bottom" label={toggle.label()} pressed={textNode[toggle.key]} {disabled} onclick={() => commands.setStyle({ [toggle.key]: !textNode[toggle.key] })}>
              <toggle.icon size={16} aria-hidden="true" />
            </ToolButton>
          {/each}
          <div class="flex-1"></div>
          <input
            type="color"
            aria-label={m.editor_props_text_color()}
            value={hex(textNode.color)}
            oninput={(event) => preview({ color: withAlpha(event.currentTarget.value, textNode.color) })}
            onchange={commit}
            class="h-8 w-10 cursor-pointer rounded-panel bg-surface-2"
          />
        </div>
        {@render choice(m.editor_props_align(), ALIGNS, textNode.align, (align) => commands.setStyle({ align }))}
        <label class="flex flex-col gap-1">
          <span class="flex justify-between text-ink-muted"><span>{m.editor_props_line_height()}</span><span class="tabular">{textNode.lineHeight.toFixed(2)}</span></span>
          <input
            type="range"
            min="0.8"
            max="3"
            step="0.05"
            value={textNode.lineHeight}
            onchange={(event) => commands.setStyle({ lineHeight: Number(event.currentTarget.value) })}
            class="accent-coral"
          />
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" checked={textNode.autoWidth} onchange={(event) => commands.setStyle({ autoWidth: event.currentTarget.checked })} class="size-4 accent-coral" />
          {m.editor_props_auto_width()}
        </label>
      </fieldset>
    {/if}

    {#if labelled && !textNode}
      <fieldset class="flex flex-col gap-3" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_label_text()}</legend>
        <div class="flex items-end gap-2">
          <label class="flex w-20 flex-col gap-1">
            <span class="text-ink-muted">{m.editor_props_font_size()}</span>
            <input
              type="number"
              min="4"
              max="800"
              step="1"
              value={labelled.labelFontSize ?? 16}
              onchange={(event) => commands.setStyle({ labelFontSize: sizeOf(event.currentTarget.value, 4, 800) })}
              class="h-8 rounded-panel bg-surface-2 px-2 tabular"
            />
          </label>
          <div class="flex-1"></div>
          <input
            type="color"
            aria-label={m.editor_props_text_color()}
            value={hex(labelled.labelColor ?? '#0B1220FF')}
            oninput={(event) => preview({ labelColor: withAlpha(event.currentTarget.value, labelled.labelColor ?? '#0B1220FF') })}
            onchange={commit}
            class="h-8 w-10 cursor-pointer rounded-panel bg-surface-2"
          />
        </div>
        {@render choice(m.editor_props_align(), ALIGNS, labelled.labelAlign ?? 'center', (labelAlign) => commands.setStyle({ labelAlign }))}
        {@render choice(m.editor_props_valign(), VALIGNS, labelled.labelVAlign ?? 'middle', (labelVAlign) => commands.setStyle({ labelVAlign }))}
      </fieldset>
    {/if}

    {#if records.length === 1 && (textNode || labelled) && !readOnly}
      <button
        type="button"
        disabled={allLocked}
        onclick={() => commands.editSelectedText()}
        class="h-9 cursor-pointer rounded-full bg-surface-2 px-3 text-sm font-semibold hover:bg-petrol disabled:cursor-not-allowed disabled:opacity-50"
      >
        {m.editor_props_edit_text()}
      </button>
    {/if}

    {#if hasFill && styled}
      <fieldset class="flex flex-col gap-2" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_fill()}</legend>
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="prop-fill-on"
            checked={styled.fill !== null}
            onchange={(event) => commands.setStyle({ fill: event.currentTarget.checked ? (styled.fill ?? '#D9D9D9FF') : null })}
            class="size-4 accent-coral"
          />
          <label for="prop-fill-on" class="flex-1">{styled.fill ? m.editor_props_fill() : m.editor_props_no_fill()}</label>
          <input
            type="color"
            aria-label={m.editor_props_fill()}
            value={hex(styled.fill)}
            disabled={disabled || styled.fill === null}
            oninput={(event) => preview({ fill: withAlpha(event.currentTarget.value, styled.fill) })}
            onchange={commit}
            class="h-8 w-10 cursor-pointer rounded-panel bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </fieldset>
    {/if}

    {#if styled}
      <fieldset class="flex flex-col gap-3" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_stroke()}</legend>
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="prop-stroke-on"
            checked={styled.stroke !== null}
            onchange={(event) => commands.setStyle({ stroke: event.currentTarget.checked ? (styled.stroke ?? '#EEF2F6FF') : null })}
            class="size-4 accent-coral"
          />
          <label for="prop-stroke-on" class="flex-1">{styled.stroke ? m.editor_props_stroke() : m.editor_props_no_stroke()}</label>
          <input
            type="color"
            aria-label={m.editor_props_stroke()}
            value={hex(styled.stroke ?? '#EEF2F6FF')}
            disabled={disabled || styled.stroke === null}
            oninput={(event) => preview({ stroke: withAlpha(event.currentTarget.value, styled.stroke) })}
            onchange={commit}
            class="h-8 w-10 cursor-pointer rounded-panel bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
        <label class="flex flex-col gap-1">
          <span class="flex justify-between text-ink-muted"><span>{m.editor_props_stroke_width()}</span><span class="tabular">{styled.strokeWidth}</span></span>
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            value={styled.strokeWidth}
            oninput={(event) => preview({ strokeWidth: Number(event.currentTarget.value) })}
            onchange={commit}
            class="accent-coral"
          />
        </label>
        <div role="radiogroup" aria-label={m.editor_props_stroke_style()} class="flex gap-1 rounded-full bg-surface-2 p-1">
          {#each DASHES as dash (dash.id)}
            <button
              type="button"
              role="radio"
              aria-checked={styled.strokeDash === dash.id}
              onclick={() => commands.setStyle({ strokeDash: dash.id })}
              class={[
                'h-7 flex-1 cursor-pointer rounded-full text-xs font-medium',
                styled.strokeDash === dash.id ? 'bg-petrol text-ink' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {dash.label()}
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}

    {#if connector}
      <fieldset class="flex flex-col gap-3" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_connector()}</legend>
        {@render choice(m.editor_props_route(), ROUTES, connector.route, (route) => commands.setStyle({ route }))}
      </fieldset>
    {/if}

    {#if ended}
      <fieldset class="flex gap-2" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_caps()}</legend>
        {#each [{ key: 'startCap', label: m.editor_props_start_cap }, { key: 'endCap', label: m.editor_props_end_cap }] as const as cap (cap.key)}
          <label class="flex flex-1 flex-col gap-1">
            <span class="text-ink-muted">{cap.label()}</span>
            <select
              value={ended[cap.key]}
              onchange={(event) => commands.setStyle({ [cap.key]: event.currentTarget.value as (typeof CAPS)[number]['id'] })}
              class="h-8 cursor-pointer rounded-panel bg-surface-2 px-2"
            >
              {#each CAPS as option (option.id)}
                <option value={option.id}>{option.label()}</option>
              {/each}
            </select>
          </label>
        {/each}
      </fieldset>
    {/if}

    {#if image}
      <fieldset class="flex flex-col gap-3" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_image()}</legend>
        {@render choice(m.editor_props_fit(), FITS, image.fit, (fit) => commands.setStyle({ fit }))}
        {#if records.length === 1}
          <label class="flex flex-col gap-1">
            <span class="text-ink-muted">{m.editor_props_alt()}</span>
            <textarea
              rows="3"
              maxlength={MAX_ALT}
              value={image.alt ?? ''}
              onchange={(event) => commands.setStyle({ alt: event.currentTarget.value.trim().slice(0, MAX_ALT) || undefined })}
              class="resize-none rounded-panel bg-surface-2 px-2 py-1.5"
            ></textarea>
          </label>
        {/if}
      </fieldset>
    {/if}

    {#if rect}
      <label class="flex flex-col gap-1">
        <span class="flex justify-between font-semibold"><span>{m.editor_props_radius()}</span><span class="tabular font-normal text-ink-muted">{Math.round(rect.cornerRadius)}</span></span>
        <input
          type="range"
          min="0"
          max={Math.floor(Math.min(rect.w, rect.h) / 2)}
          step="1"
          value={rect.cornerRadius}
          {disabled}
          oninput={(event) => preview({ cornerRadius: Number(event.currentTarget.value) })}
          onchange={commit}
          class="accent-coral"
        />
      </label>
    {/if}

    {#if styled && styled.type !== 'line' && styled.type !== 'connector'}
      <fieldset class="flex flex-col gap-2" {disabled}>
        <legend class="mb-2 font-semibold">{m.editor_props_shadow()}</legend>
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="prop-shadow-on"
            checked={styled.shadow !== null}
            onchange={(event) => commands.setStyle({ shadow: event.currentTarget.checked ? DEFAULT_SHADOW : null })}
            class="size-4 accent-coral"
          />
          <label for="prop-shadow-on">{m.editor_props_shadow()}</label>
        </div>
        {#if styled.shadow}
          {@const shadow = styled.shadow}
          <label class="flex flex-col gap-1">
            <span class="flex justify-between text-ink-muted"><span>{m.editor_props_shadow_blur()}</span><span class="tabular">{shadow.blur}</span></span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={shadow.blur}
              oninput={(event) => preview({ shadow: { ...shadow, blur: Number(event.currentTarget.value) } })}
              onchange={commit}
              class="accent-coral"
            />
          </label>
        {/if}
      </fieldset>
    {/if}

    <label class="flex flex-col gap-1">
      <span class="flex justify-between font-semibold"><span>{m.editor_props_opacity()}</span><span class="tabular font-normal text-ink-muted">{Math.round(first.opacity * 100)} %</span></span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(first.opacity * 100)}
        {disabled}
        oninput={(event) => preview({ opacity: Number(event.currentTarget.value) / 100 })}
        onchange={commit}
        class="accent-coral"
      />
    </label>

    <div class="flex flex-col gap-2">
      <label class="flex items-center gap-2">
        <input type="checkbox" checked={allVisible} disabled={readOnly} onchange={(event) => commands.setVisible(event.currentTarget.checked)} class="size-4 accent-coral" />
        {m.editor_props_visible()}
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" checked={allLocked} disabled={readOnly} onchange={(event) => commands.setLocked(event.currentTarget.checked)} class="size-4 accent-coral" />
        {m.editor_props_locked()}
      </label>
    </div>

    {#if !readOnly}
      <div class="flex flex-col gap-2">
        <span class="font-semibold">{m.editor_props_order()}</span>
        <div class="flex flex-wrap gap-1">
          <ToolButton side="bottom" label={m.editor_order_front()} disabled={allLocked} onclick={() => commands.zOrder('front')}><BringToFront size={16} aria-hidden="true" /></ToolButton>
          <ToolButton side="bottom" label={m.editor_order_forward()} disabled={allLocked} onclick={() => commands.zOrder('forward')}><ArrowUp size={16} aria-hidden="true" /></ToolButton>
          <ToolButton side="bottom" label={m.editor_order_backward()} disabled={allLocked} onclick={() => commands.zOrder('backward')}><ArrowDown size={16} aria-hidden="true" /></ToolButton>
          <ToolButton side="bottom" label={m.editor_order_back()} disabled={allLocked} onclick={() => commands.zOrder('back')}><SendToBack size={16} aria-hidden="true" /></ToolButton>
          <div class="flex-1"></div>
          <ToolButton side="bottom" label={m.editor_group()} disabled={allLocked} onclick={() => commands.groupSelection()}><Group size={16} aria-hidden="true" /></ToolButton>
          {#if hasContainer}
            <ToolButton side="bottom" label={m.editor_ungroup()} disabled={allLocked} onclick={() => commands.ungroupSelection()}><Ungroup size={16} aria-hidden="true" /></ToolButton>
          {/if}
          <ToolButton side="bottom" label={m.editor_duplicate()} onclick={() => commands.duplicateSelection()}><Copy size={16} aria-hidden="true" /></ToolButton>
          <ToolButton side="bottom" label={m.editor_delete()} disabled={allLocked} onclick={() => commands.deleteSelection()}><Trash size={16} aria-hidden="true" /></ToolButton>
        </div>
      </div>
    {/if}
  {/if}
</aside>
