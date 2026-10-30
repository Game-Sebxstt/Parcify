<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Minus from '@lucide/svelte/icons/minus';
  import { Checkbox } from 'bits-ui';

  type Props = {
    checked?: boolean;
    indeterminate?: boolean;
    // Texto visible a la derecha de la casilla; sin él, hace falta `ariaLabel`.
    label?: string;
    ariaLabel?: string;
    description?: string;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    value?: string;
    id?: string;
    testid?: string;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
    // Se llama antes del cambio; con `preventDefault()` la casilla no cambia sola (selección con Shift, por ejemplo).
    onclick?: (event: MouseEvent) => void;
  };

  const uid = $props.id();
  let {
    checked = $bindable(false),
    indeterminate = $bindable(false),
    label,
    ariaLabel,
    description,
    disabled = false,
    required = false,
    name,
    value,
    id = `checkbox-${uid}`,
    testid,
    class: className = '',
    onCheckedChange,
    onclick,
  }: Props = $props();

  const descriptionId = $derived(description ? `${id}-description` : undefined);
</script>

{#snippet box()}
  <Checkbox.Root
    bind:checked
    bind:indeterminate
    {id}
    {disabled}
    {required}
    {name}
    {value}
    aria-label={label ? undefined : ariaLabel}
    aria-describedby={descriptionId}
    data-testid={testid}
    {onCheckedChange}
    {onclick}
    class={[
      'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs border border-edge bg-surface-2 text-coral-ink',
      'transition-colors duration-(--dur-fast) hover:border-ink-muted',
      'data-[state=checked]:border-coral data-[state=checked]:bg-coral data-[state=indeterminate]:border-coral data-[state=indeterminate]:bg-coral',
      'data-disabled:cursor-not-allowed',
      disabled && !label ? 'opacity-40' : '',
      label ? '' : className,
    ].join(' ')}
  >
    {#snippet children({ checked: on, indeterminate: partial })}
      {#if partial}
        <Minus size={12} strokeWidth={3} aria-hidden="true" />
      {:else if on}
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      {/if}
    {/snippet}
  </Checkbox.Root>
{/snippet}

{#if label}
  <!-- La etiqueta envuelve al botón de la casilla: un clic en el texto la marca y le da su nombre accesible. -->
  <label class={['inline-flex min-h-6 items-start gap-2 text-sm text-ink', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', className]}>
    <span class="flex h-5 items-center">{@render box()}</span>
    <span class="flex min-w-0 flex-col">
      <span>{label}</span>
      {#if description}
        <span id={descriptionId} class="text-xs text-ink-muted">{description}</span>
      {/if}
    </span>
  </label>
{:else}
  {@render box()}
{/if}
