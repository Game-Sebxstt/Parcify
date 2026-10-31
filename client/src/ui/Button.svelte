<script lang="ts" module>
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
  export type ButtonSize = 'sm' | 'md';

  const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-coral text-coral-ink hover:bg-coral-hover',
    secondary: 'bg-surface-2 text-ink hover:bg-petrol',
    ghost: 'bg-transparent text-ink hover:bg-surface-2',
    danger: 'bg-danger text-coral-ink hover:brightness-110',
    'danger-ghost': 'bg-transparent text-danger hover:bg-surface-2',
  };

  // En una hoja del móvil o en un diálogo con el dedo (`sheet:`), 44 px.
  const SIZES: Record<ButtonSize, string> = {
    sm: 'h-8 gap-1.5 px-3.5 text-sm sheet:h-11',
    md: 'h-10 gap-2 px-5 text-sm sheet:h-11',
  };

  const ICON_SIZES: Record<ButtonSize, string> = { sm: 'size-8 sheet:size-11', md: 'size-10 sheet:size-11' };
</script>

<script lang="ts">
  import { Button } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = Omit<HTMLButtonAttributes, 'children'> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    href?: string;
    // Obligatorio en botones de solo icono: es su nombre accesible.
    label?: string;
    iconOnly?: boolean;
    ref?: HTMLElement | null;
    children?: Snippet;
  };

  let {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    type = 'button',
    href,
    label,
    iconOnly = false,
    ref = $bindable(null),
    class: className = '',
    children,
    ...rest
  }: Props = $props();

  const classes = $derived(
    [
      'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold whitespace-nowrap transition-colors duration-150',
      'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
      VARIANTS[variant],
      iconOnly ? ICON_SIZES[size] : SIZES[size],
      className,
    ].join(' '),
  );
</script>

{#if href}
  <Button.Root bind:ref {href} class={classes} aria-label={label} {...rest as Record<string, unknown>}>
    {@render children?.()}
  </Button.Root>
{:else}
  <Button.Root
    bind:ref
    {type}
    class={classes}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    aria-label={label}
    {...rest}
  >
    {@render children?.()}
  </Button.Root>
{/if}
