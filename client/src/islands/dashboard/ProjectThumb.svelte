<script lang="ts">
  import { assetUrl } from '../../lib/assets.ts';
  import { m } from '../../paraglide/messages.js';

  type Props = {
    assetId: string | null;
    // Sin texto de «Sin vista previa»: la miniatura de 40×25 de la lista.
    small?: boolean;
  };

  let { assetId, small = false }: Props = $props();

  let preview = $state<string | null>(null);

  $effect(() => {
    const id = assetId;
    preview = null;
    if (!id) return;
    let alive = true;
    void assetUrl(id, 'thumb').then((url) => {
      if (alive) preview = url;
    });
    return () => {
      alive = false;
    };
  });
</script>

<!-- La miniatura se ve entera (object-contain) sobre surface-2: nada del lienzo queda recortado. -->
{#if preview}
  <img src={preview} alt="" loading="lazy" decoding="async" draggable="false" class="size-full object-contain" />
{:else if !small}
  <span class="flex size-full items-center justify-center text-xs text-ink-muted">{m.dashboard_card_no_preview()}</span>
{/if}
