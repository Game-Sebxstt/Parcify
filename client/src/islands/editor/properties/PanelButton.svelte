<script lang="ts">
  import type { Snippet } from 'svelte';
  import Tooltip from '../../../ui/Tooltip.svelte';

  type Props = {
    label: string;
    // Tecla que se muestra en el tooltip («⌥+A»).
    kbd?: string | undefined;
    ariaKeys?: string | undefined;
    pressed?: boolean | undefined;
    // Desactivado con el motivo en el tooltip: aria-disabled deja que el tooltip se abra con el puntero y el foco.
    disabledReason?: string | undefined;
    testid?: string | undefined;
    onclick: () => void;
    children: Snippet;
  };

  let { label, kbd, ariaKeys, pressed, disabledReason, testid, onclick, children: icon }: Props = $props();

  const disabled = $derived(disabledReason !== undefined);
</script>

<Tooltip text={disabledReason ?? label} {kbd} side="bottom">
  {#snippet children(tip)}
    <button
      {...tip}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={ariaKeys ?? kbd}
      data-testid={testid}
      onclick={() => {
        if (!disabled) onclick();
      }}
      class={[
        'inline-flex size-6 shrink-0 items-center justify-center rounded-control transition-colors duration-(--dur-fast)',
        'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-coral',
        disabled ? 'cursor-not-allowed text-ink-muted opacity-40' : 'cursor-pointer',
        !disabled && (pressed ? 'bg-petrol text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'),
      ]}
    >
      {@render icon()}
    </button>
  {/snippet}
</Tooltip>
