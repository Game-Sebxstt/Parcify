<script lang="ts" module>
  export type MenuItem = {
    label: string;
    onSelect: () => void;
    danger?: boolean;
    disabled?: boolean;
  };
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  type Props = {
    items: MenuItem[];
    trigger: Snippet<[Record<string, unknown>]>;
    align?: 'start' | 'center' | 'end';
    side?: 'bottom' | 'top';
  };

  let { items, trigger, align = 'end', side = 'bottom' }: Props = $props();

  // Patrón de menú de WAI-ARIA sin librería de posicionamiento: se abre bajo el disparador o, con side="top", encima.
  const uid = $props.id();
  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let list = $state<HTMLElement | null>(null);

  const enabled = () => [...(list?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  async function show(focus: 'first' | 'last' = 'first') {
    open = true;
    await tick();
    const options = enabled();
    (focus === 'first' ? options[0] : options.at(-1))?.focus();
  }

  function hide(returnFocus = true) {
    if (!open) return;
    open = false;
    if (returnFocus) root?.querySelector<HTMLElement>(`#${uid}-trigger`)?.focus();
  }

  function onTriggerKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void show('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      void show('last');
    }
  }

  function onListKey(event: KeyboardEvent) {
    const options = enabled();
    const index = options.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      options[(next + options.length) % options.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(options.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    } else if (event.key === 'Tab') hide(false);
  }

  function choose(item: MenuItem) {
    if (item.disabled) return;
    hide();
    item.onSelect();
  }

  const position = $derived(
    [
      side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
      align === 'start' ? 'left-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0',
    ].join(' '),
  );
</script>

<svelte:window
  onpointerdown={(event) => {
    if (open && root && !root.contains(event.target as Node)) hide(false);
  }}
/>

<div bind:this={root} class="relative inline-flex">
  {@render trigger({
    id: `${uid}-trigger`,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': `${uid}-menu`,
    onclick: () => (open ? hide() : void show()),
    onkeydown: onTriggerKey,
  })}
  {#if open}
    <div
      bind:this={list}
      id="{uid}-menu"
      role="menu"
      tabindex="-1"
      aria-labelledby="{uid}-trigger"
      onkeydown={onListKey}
      class="absolute z-50 min-w-48 rounded-panel bg-surface-2 p-1 text-sm text-ink shadow-float {position}"
    >
      {#each items as item (item.label)}
        <div
          role="menuitem"
          tabindex="-1"
          aria-disabled={item.disabled || undefined}
          onclick={() => choose(item)}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              choose(item);
            }
          }}
          class={[
            'flex h-9 cursor-pointer items-center rounded-[6px] px-3 outline-none select-none hover:bg-petrol focus:bg-petrol',
            'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
            item.danger ? 'text-danger' : '',
          ].join(' ')}
        >
          {item.label}
        </div>
      {/each}
    </div>
  {/if}
</div>
