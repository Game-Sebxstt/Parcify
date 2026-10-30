<script lang="ts">
  import { Switch } from 'bits-ui';

  type Props = {
    checked?: boolean;
    // Texto visible a la izquierda del conmutador; sin él, hace falta `ariaLabel`.
    label?: string;
    ariaLabel?: string;
    description?: string;
    disabled?: boolean;
    name?: string;
    id?: string;
    testid?: string;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
  };

  const uid = $props.id();
  let {
    checked = $bindable(false),
    label,
    ariaLabel,
    description,
    disabled = false,
    name,
    id = `switch-${uid}`,
    testid,
    class: className = '',
    onCheckedChange,
  }: Props = $props();

  const descriptionId = $derived(description ? `${id}-description` : undefined);
</script>

{#snippet control()}
  <Switch.Root
    bind:checked
    {id}
    {disabled}
    {name}
    aria-label={label ? undefined : ariaLabel}
    aria-describedby={descriptionId}
    data-testid={testid}
    {onCheckedChange}
    class={[
      'inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full bg-edge p-0.5',
      'transition-colors duration-(--dur-base) data-[state=checked]:bg-coral',
      'data-disabled:cursor-not-allowed',
      disabled && !label ? 'opacity-40' : '',
      label ? '' : className,
    ].join(' ')}
  >
    <Switch.Thumb
      class="pointer-events-none block size-3 rounded-full bg-ink transition-transform duration-(--dur-base) ease-out data-[state=checked]:translate-x-3 data-[state=checked]:bg-coral-ink"
    />
  </Switch.Root>
{/snippet}

{#if label}
  <!-- La etiqueta envuelve al conmutador: un clic en el texto lo cambia y le da su nombre accesible. -->
  <label
    class={['flex min-h-6 items-center justify-between gap-3 text-sm text-ink', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', className]}
  >
    <span class="flex min-w-0 flex-col">
      <span>{label}</span>
      {#if description}
        <span id={descriptionId} class="text-xs text-ink-muted">{description}</span>
      {/if}
    </span>
    {@render control()}
  </label>
{:else}
  {@render control()}
{/if}
