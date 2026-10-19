<script lang="ts">
  import { assetUrl, type AssetVariant } from '../../lib/assets.ts';
  import { m } from '../../paraglide/messages.js';

  type Props = {
    assetId: string | null;
    variant?: AssetVariant;
    // Vacío cuando el nombre de la plantilla ya está junto a la imagen.
    alt?: string;
    class?: string;
    compact?: boolean;
    fit?: 'cover' | 'contain';
  };

  let { assetId, variant = 'thumb', alt = '', class: className = '', compact = false, fit = 'cover' }: Props = $props();

  let src = $state<string | null>(null);

  $effect(() => {
    const id = assetId;
    src = null;
    if (!id) return;
    let alive = true;
    void assetUrl(id, variant).then((url) => {
      if (alive) src = url;
    });
    return () => {
      alive = false;
    };
  });
</script>

<span class={['flex items-center justify-center overflow-hidden bg-ground', className].join(' ')}>
  {#if src}
    <img {src} {alt} loading="lazy" decoding="async" class={['size-full', fit === 'cover' ? 'object-cover' : 'object-contain'].join(' ')} />
  {:else if !compact}
    <span class="text-xs text-ink-muted">{m.dashboard_card_no_preview()}</span>
  {/if}
</span>
