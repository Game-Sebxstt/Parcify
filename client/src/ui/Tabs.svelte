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
    onValueChange?: (value: string) => void;
  };

  let { items, value = $bindable(items[0]?.value ?? ''), label, onValueChange }: Props = $props();
</script>

<Tabs.Root bind:value {onValueChange}>
  <Tabs.List aria-label={label} class="inline-flex gap-1 rounded-full bg-surface-1 p-1">
    {#each items as item (item.value)}
      <Tabs.Trigger
        value={item.value}
        class="h-8 cursor-pointer rounded-full px-4 text-sm font-medium text-ink-muted hover:text-ink data-[state=active]:bg-surface-2 data-[state=active]:text-ink"
      >
        {item.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>
  {#each items as item (item.value)}
    <Tabs.Content value={item.value} class="mt-4">
      {@render item.content()}
    </Tabs.Content>
  {/each}
</Tabs.Root>
