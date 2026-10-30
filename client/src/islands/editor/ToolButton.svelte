<script lang="ts">
  import type { Snippet } from 'svelte';
  import Lock from '@lucide/svelte/icons/lock';
  import Tooltip from '../../ui/Tooltip.svelte';

  type Props = {
    label: string;
    // Texto del tooltip si no es el nombre accesible (p. ej. «Rectángulo» cuando el nombre es «Rectángulo (R)»).
    tip?: string | undefined;
    // Tecla que se muestra en el tooltip, p. ej. «R» o «Ctrl+Shift+K».
    kbd?: string | undefined;
    pressed?: boolean;
    disabled?: boolean;
    // Candado en la esquina inferior derecha (herramienta bloqueada, §3.3).
    locked?: boolean;
    // 'panel' (redondo, por defecto) para los paneles; 'tool' para la barra flotante y la de zoom (§3.3).
    variant?: 'panel' | 'tool';
    // 36 px con radius-card (barra flotante) o 32 px con radius-control (barra de zoom). Solo con variant 'tool'.
    size?: 'md' | 'sm';
    side?: 'top' | 'right' | 'bottom' | 'left';
    // Tabindex itinerante de la barra que lo contiene y la marca con la que la barra encuentra sus botones.
    tabindex?: number | undefined;
    stop?: string | undefined;
    testid?: string | undefined;
    onclick: () => void;
    ondblclick?: (() => void) | undefined;
    children: Snippet;
  };

  let {
    label,
    tip,
    kbd,
    pressed,
    disabled = false,
    locked = false,
    variant = 'panel',
    size = 'md',
    side = 'right',
    tabindex,
    stop,
    testid,
    onclick,
    ondblclick,
    children: content,
  }: Props = $props();

  const shape = $derived(variant === 'panel' ? 'size-9 rounded-full' : size === 'md' ? 'size-9 rounded-card' : 'size-8 rounded-control');
  const state = $derived(
    variant === 'panel'
      ? pressed
        ? 'bg-petrol text-ink'
        : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
      : pressed
        ? 'bg-coral text-coral-ink'
        : 'text-ink-muted hover:bg-petrol hover:text-ink',
  );
</script>

<Tooltip text={tip ?? label} {kbd} {side}>
  {#snippet children(props)}
    <button
      {...props}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={kbd}
      {disabled}
      {tabindex}
      data-stop={stop}
      data-testid={testid}
      {onclick}
      {ondblclick}
      class={[
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center',
        'disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'tool'
          ? 'transition-[color,background-color,scale] duration-120 active:scale-96 motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral'
          : 'transition-colors duration-150',
        shape,
        state,
      ].join(' ')}
    >
      {@render content()}
      {#if locked}
        <span aria-hidden="true" class="absolute right-0.5 bottom-0.5 text-current"><Lock size={8} strokeWidth={3} /></span>
      {/if}
    </button>
  {/snippet}
</Tooltip>
