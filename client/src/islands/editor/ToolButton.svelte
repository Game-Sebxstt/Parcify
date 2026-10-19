<script lang="ts">
  import type { Snippet } from 'svelte';
  import Tooltip from '../../ui/Tooltip.svelte';

  type Props = {
    label: string;
    pressed?: boolean;
    disabled?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    onclick: () => void;
    children: Snippet;
  };

  let { label, pressed, disabled = false, side = 'right', onclick, children: content }: Props = $props();
</script>

<Tooltip text={label} {side}>
  {#snippet children(props)}
    <button
      {...props}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      {disabled}
      {onclick}
      class={[
        'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pressed ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      ].join(' ')}
    >
      {@render content()}
    </button>
  {/snippet}
</Tooltip>
