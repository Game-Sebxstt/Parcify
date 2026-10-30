<script lang="ts">
  import { assetUrl } from '../../lib/assets.ts';

  type Props = { name: string; logoAssetId: string | null; size?: 'sm' | 'md' };
  let { name, logoAssetId, size = 'md' }: Props = $props();

  let src = $state<string | null>(null);

  $effect(() => {
    const id = logoAssetId;
    src = null;
    if (!id) return;
    let alive = true;
    void assetUrl(id).then((url) => {
      if (alive) src = url;
    });
    return () => {
      alive = false;
    };
  });

  const initial = $derived(name.trim().charAt(0).toLocaleUpperCase('es') || '?');
</script>

<!-- Decorativo: el nombre del espacio siempre va en texto al lado o como nombre accesible del enlace. -->
<span
  aria-hidden="true"
  class={[
    'inline-flex shrink-0 items-center justify-center overflow-hidden bg-petrol font-semibold text-ink',
    size === 'md' ? 'size-6 rounded-control text-2xs' : 'size-4 rounded-xs text-[10px]',
  ]}
>
  {#if src}<img {src} alt="" class="size-full object-cover" />{:else}{initial}{/if}
</span>
