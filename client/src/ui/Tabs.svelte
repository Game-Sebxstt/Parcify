<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type TabItem = { value: string; label: string; content: Snippet };
</script>

<script lang="ts">
  import { Tabs } from 'bits-ui';

  type Props = {
    items: TabItem[];
    value?: string;
    label: string;
    // sm: pestañas de 32 px de los paneles; md: las de una página.
    size?: 'sm' | 'md';
    onValueChange?: (value: string) => void;
  };

  let { items, value = $bindable(items[0]?.value ?? ''), label, size = 'md', onValueChange }: Props = $props();
</script>

<Tabs.Root bind:value {onValueChange}>
  <Tabs.List
    aria-label={label}
    class={['scroll-thin flex gap-4 overflow-x-auto border-b border-edge/25', size === 'sm' ? 'px-3' : ''].join(' ')}
  >
    {#each items as item (item.value)}
      <Tabs.Trigger
        value={item.value}
        class={[
          'relative shrink-0 cursor-pointer font-medium whitespace-nowrap text-ink-muted transition-colors duration-(--dur-fast) hover:text-ink',
          'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-coral after:opacity-0',
          'data-[state=active]:text-ink data-[state=active]:after:opacity-100 focus-visible:-outline-offset-2',
          size === 'sm' ? 'h-8 text-ui' : 'h-10 text-sm',
        ].join(' ')}
      >
        {item.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>
  {#each items as item (item.value)}
    <Tabs.Content value={item.value} class={size === 'sm' ? '' : 'mt-4'}>
      {@render item.content()}
    </Tabs.Content>
  {/each}
</Tabs.Root>
