<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { MenuIcon } from './DropdownMenu.svelte';

  export type SelectItem = {
    value: string;
    label: string;
    icon?: MenuIcon | undefined;
    // Miniatura propia (la punta de una flecha, por ejemplo); va antes del texto en la lista y en el botón.
    preview?: Snippet | undefined;
    // Estilo del texto de la opción: cada familia de letra se muestra con su fuente.
    style?: string | undefined;
    disabled?: boolean | undefined;
  };
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Select } from 'bits-ui';
  import { m } from '../paraglide/messages.js';

  type Props = {
    items: SelectItem[];
    value?: string;
    // Nombre accesible del botón.
    label: string;
    placeholder?: string;
    // sm: 24 px (panel de propiedades); md: 32 px (barras); lg: 44 px, como los campos de los formularios.
    size?: 'sm' | 'md' | 'lg';
    // Sin texto en el botón: solo la miniatura o el icono de la opción elegida.
    compact?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    name?: string;
    id?: string;
    describedBy?: string | undefined;
    side?: 'top' | 'bottom';
    // 'touch': botón y opciones de 44 px de alto, con el tamaño de letra de `size`.
    density?: 'default' | 'touch';
    testid?: string;
    class?: string;
    onValueChange?: (value: string) => void;
  };

  let {
    items,
    value = $bindable(''),
    label,
    placeholder,
    size = 'md',
    compact = false,
    disabled = false,
    invalid = false,
    name,
    id,
    describedBy,
    side = 'bottom',
    density = 'default',
    testid,
    class: className = '',
    onValueChange,
  }: Props = $props();

  const uid = $props.id();
  const listId = `${uid}-list`;
  let open = $state(false);

  const selected = $derived(items.find((item) => item.value === value));
  const typeahead = $derived(items.map((item) => ({ value: item.value, label: item.label, disabled: item.disabled ?? false })));

  // El nombre accesible incluye la opción elegida: `aria-label` sustituye al texto del botón.
  const accessibleName = $derived(selected ? `${label}: ${selected.label}` : label);

  // El alto, el fondo y el tamaño de letra de `class` sustituyen a los de serie: Tailwind no resuelve el conflicto por orden.
  const own = $derived({
    height: /(^|\s)h-\d/.test(className),
    background: /(^|\s)bg-/.test(className),
    text: /(^|\s)text-(2xs|xs|ui|sm|base|lg)\b/.test(className),
    padding: /(^|\s)px-/.test(className),
  });

  const TRIGGER = $derived(
    [
      'inline-flex min-w-0 cursor-pointer items-center gap-1.5 border text-left text-ink transition-colors duration-(--dur-fast)',
      'data-disabled:cursor-not-allowed data-disabled:opacity-40',
      own.background ? '' : 'bg-surface-2',
      size === 'lg'
        ? 'rounded-panel hover:border-ink-muted focus-visible:border-coral'
        : 'rounded-control hover:border-edge/60 focus-visible:outline-1 focus-visible:-outline-offset-1 data-[state=open]:border-edge/60',
      own.padding ? '' : size === 'sm' ? 'px-1.5' : size === 'md' ? 'px-2' : 'px-3.5',
      own.height ? '' : size === 'sm' ? 'h-6' : size === 'md' ? 'h-8' : 'h-11',
      // min-height gana a cualquier alto, también al que llega en `class`.
      density === 'touch' ? 'min-h-11' : 'sheet:min-h-11',
      own.text ? '' : size === 'sm' ? 'text-xs' : size === 'md' ? 'text-ui' : 'text-base',
      invalid ? 'border-danger' : size === 'lg' ? 'border-edge' : 'border-transparent',
      className,
    ].join(' '),
  );
  const ITEM = $derived(
    [
      'flex cursor-default items-center gap-2 rounded-control px-2 text-ui outline-none select-none',
      density === 'touch' ? 'min-h-11' : 'min-h-8 pointer-coarse:min-h-11',
      'data-highlighted:bg-petrol data-disabled:cursor-not-allowed data-disabled:text-ink-muted',
    ].join(' '),
  );
</script>

{#snippet leading(item: SelectItem)}
  {#if item.preview}
    <span aria-hidden="true" class="inline-flex shrink-0 items-center justify-center">{@render item.preview()}</span>
  {:else if item.icon}
    {@const Icon = item.icon}
    <span aria-hidden="true" class="inline-flex size-4 shrink-0 items-center justify-center text-ink-muted"><Icon size={16} /></span>
  {/if}
{/snippet}

<!-- Combobox de solo selección (APG): el foco se queda en el botón y aria-activedescendant señala la opción. -->
<Select.Root type="single" bind:value bind:open {onValueChange} items={typeahead} {disabled} {name}>
  <Select.Trigger
    {id}
    role="combobox"
    aria-controls={open ? listId : undefined}
    aria-label={accessibleName} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid={testid} class={TRIGGER}>
    {#if selected}
      {@render leading(selected)}
      {#if !compact || (!selected.preview && !selected.icon)}
        <span class="min-w-0 flex-1 truncate" style={selected.style}>{selected.label}</span>
      {/if}
    {:else}
      <span class="min-w-0 flex-1 truncate text-ink-muted">{placeholder ?? m.ui_select_placeholder()}</span>
    {/if}
    <ChevronDown size={size === 'sm' ? 12 : 14} aria-hidden="true" class="ml-auto shrink-0 text-ink-muted" />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content
      id={listId}
      aria-label={label}
      {side}
      sideOffset={4}
      collisionPadding={8}
      avoidCollisions
      data-floating=""
      data-own-keys=""
      class="z-(--z-popover) max-h-(--bits-select-content-available-height) min-w-(--bits-select-anchor-width) overflow-hidden rounded-panel border border-edge/40 bg-surface-2 text-ink shadow-float outline-none"
    >
      <Select.Viewport class="scroll-thin min-h-0 overflow-x-hidden overscroll-contain p-1">
        {#each items as item (item.value)}
          <Select.Item value={item.value} label={item.label} disabled={item.disabled ?? false} class={ITEM}>
            {#snippet children({ selected: isSelected })}
              <span aria-hidden="true" class="inline-flex size-4 shrink-0 items-center justify-center text-coral">
                {#if isSelected}<Check size={14} />{/if}
              </span>
              {@render leading(item)}
              <span class="min-w-0 flex-1 truncate" style={item.style}>{item.label}</span>
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
