<script lang="ts" module>
  import type { MenuIcon } from './DropdownMenu.svelte';

  export type SegmentItem = { value: string; label: string; icon?: MenuIcon | undefined; disabled?: boolean | undefined };
</script>

<script lang="ts">
  import { RadioGroup } from 'bits-ui';
  import Tooltip from './Tooltip.svelte';

  type Props = {
    items: SegmentItem[];
    value?: string;
    // Nombre accesible del grupo.
    label: string;
    // id del texto de ayuda que describe el grupo.
    describedBy?: string | undefined;
    // Solo iconos: el nombre de cada opción va en su tooltip y en su aria-label.
    iconOnly?: boolean;
    // sm: 24 px (panel de propiedades); md: 32 px.
    size?: 'sm' | 'md';
    disabled?: boolean;
    name?: string;
    testid?: string;
    class?: string;
    onValueChange?: (value: string) => void;
  };

  let {
    items,
    value = $bindable(''),
    label,
    describedBy,
    iconOnly = false,
    size = 'md',
    disabled = false,
    name,
    testid,
    class: className = '',
    onValueChange,
  }: Props = $props();

  const ITEM = $derived(
    [
      'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xs text-ink-muted outline-none select-none',
      'transition-colors duration-(--dur-fast) hover:text-ink aria-checked:bg-petrol aria-checked:text-ink',
      'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral',
      'data-disabled:cursor-not-allowed data-disabled:opacity-40',
      size === 'sm' ? 'h-6 min-w-6 px-1.5 text-xs' : 'h-8 min-w-8 px-3 text-ui',
      'sheet:h-11 sheet:min-w-11',
      iconOnly ? 'px-0' : '',
    ].join(' '),
  );
</script>

{#snippet face(item: SegmentItem)}
  {#if item.icon}
    {@const Icon = item.icon}
    <span aria-hidden="true" class="inline-flex size-4 items-center justify-center"><Icon size={size === 'sm' ? 14 : 16} /></span>
  {/if}
  {#if !iconOnly || !item.icon}
    <span class="truncate">{item.label}</span>
  {/if}
{/snippet}

<RadioGroup.Root
  bind:value
  {onValueChange}
  {disabled}
  {name}
  orientation="horizontal"
  loop
  aria-label={label}
  aria-describedby={describedBy}
  data-testid={testid}
  class={['inline-flex max-w-full items-center gap-0.5 rounded-control bg-surface-2 p-0.5', className].join(' ')}
>
  {#each items as item (item.value)}
    {#if iconOnly && item.icon}
      <Tooltip text={item.label}>
        {#snippet children(tip)}
          <RadioGroup.Item {...tip} value={item.value} disabled={item.disabled ?? false} aria-label={item.label} class={ITEM}>
            {@render face(item)}
          </RadioGroup.Item>
        {/snippet}
      </Tooltip>
    {:else}
      <RadioGroup.Item value={item.value} disabled={item.disabled ?? false} class={ITEM}>
        {@render face(item)}
      </RadioGroup.Item>
    {/if}
  {/each}
</RadioGroup.Root>
