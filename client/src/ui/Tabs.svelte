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
    // Clases de la raíz y de cada panel (por ejemplo, para que el panel ocupe el alto que queda).
    class?: string;
    contentClass?: string;
    // -1 cuando el contenido ya tiene su propio elemento enfocable (un árbol, una lista de botones).
    contentTabindex?: number;
    // Solo se monta el contenido de la pestaña activa (cada pestaña pide sus datos al abrirse).
    lazy?: boolean;
    // Controles a la derecha de las pestañas, en la misma fila (filtros del inicio).
    trailing?: Snippet;
    onValueChange?: (value: string) => void;
  };

  let {
    items,
    value = $bindable(items[0]?.value ?? ''),
    label,
    size = 'md',
    class: className = '',
    contentClass = '',
    contentTabindex = 0,
    lazy = false,
    trailing,
    onValueChange,
  }: Props = $props();
</script>

{#snippet list()}
  <Tabs.List
    aria-label={label}
    class={[
      'scroll-thin flex gap-4 overflow-x-auto',
      trailing ? 'max-w-full min-w-0 flex-[1_0_auto]' : 'shrink-0 border-b border-edge/25',
      size === 'sm' ? 'px-3' : '',
    ].join(' ')}
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
{/snippet}

<Tabs.Root bind:value {onValueChange} class={className}>
  {#if trailing}
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge/25">
      {@render list()}
      <div class="flex flex-wrap items-center gap-2 pb-2 sm:pb-1">{@render trailing()}</div>
    </div>
  {:else}
    {@render list()}
  {/if}
  {#each items as item (item.value)}
    <Tabs.Content value={item.value} tabindex={contentTabindex} class={[size === 'sm' ? '' : 'mt-4', contentClass].join(' ')}>
      {#if !lazy || item.value === value}
        {@render item.content()}
      {/if}
    </Tabs.Content>
  {/each}
</Tabs.Root>
