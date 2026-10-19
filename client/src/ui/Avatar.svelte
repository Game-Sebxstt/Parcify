<script lang="ts">
  import { Avatar } from 'bits-ui';

  type Props = {
    name: string;
    src?: string | null;
    size?: 'sm' | 'md' | 'lg';
    color?: string;
  };

  let { name, src = null, size = 'md', color }: Props = $props();

  const SIZES = { sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-12 text-base' } as const;

  const initials = $derived(
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toLocaleUpperCase('es'))
      .join('') || '?',
  );
</script>

<Avatar.Root
  class={['inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold', SIZES[size]].join(' ')}
  style={color ? `background-color: ${color}; color: var(--color-coral-ink)` : undefined}
>
  {#if src}
    <Avatar.Image {src} alt={name} class="size-full object-cover" />
  {/if}
  <Avatar.Fallback class={['flex size-full items-center justify-center', color ? '' : 'bg-petrol text-ink'].join(' ')}>
    <span aria-hidden="true">{initials}</span>
    <span class="sr-only">{name}</span>
  </Avatar.Fallback>
</Avatar.Root>
