<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  type Props = Omit<HTMLInputAttributes, 'value'> & {
    value?: string;
    invalid?: boolean;
    describedBy?: string | undefined;
    ref?: HTMLInputElement | null;
  };

  let {
    value = $bindable(''),
    invalid = false,
    describedBy,
    ref = $bindable(null),
    type = 'text',
    class: className = '',
    ...rest
  }: Props = $props();
</script>

<input
  bind:this={ref}
  bind:value
  {type}
  aria-invalid={invalid || undefined}
  aria-describedby={describedBy}
  class={[
    // El alto y el tamaño de letra de `class` sustituyen a los de serie: Tailwind no resuelve el conflicto por orden.
    /(^|\s)h-\d/.test(String(className ?? '')) ? '' : 'h-11',
    /(^|\s)text-(xs|sm|base|lg|xl)\b/.test(String(className ?? '')) ? '' : 'text-base',
    'w-full rounded-panel bg-surface-2 px-3.5 text-ink placeholder:text-ink-muted',
    'border border-edge transition-colors duration-150 hover:border-ink-muted focus-visible:border-coral',
    'aria-invalid:border-danger disabled:opacity-60',
    className,
  ].join(' ')}
  {...rest}
/>
