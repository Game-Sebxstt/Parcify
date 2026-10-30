<script lang="ts" module>
  export type MenuItem = {
    label: string;
    onSelect: () => void;
    danger?: boolean;
    disabled?: boolean;
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import DropdownMenu, { type MenuEntry } from './DropdownMenu.svelte';

  type Props = {
    items: MenuItem[];
    trigger: Snippet<[Record<string, unknown>]>;
    align?: 'start' | 'center' | 'end';
    side?: 'bottom' | 'top';
  };

  let { items, trigger, align = 'end', side = 'bottom' }: Props = $props();

  // La lista va en portal y se recoloca al chocar con los bordes: ningún contenedor con scroll la recorta.
  const entries = $derived(
    items.map(
      (item, index): MenuEntry => ({
        kind: 'item',
        id: `${index}-${item.label}`,
        label: item.label,
        danger: item.danger,
        disabled: item.disabled,
        onSelect: item.onSelect,
      }),
    ),
  );
</script>

<DropdownMenu items={entries} {trigger} {align} {side} />
