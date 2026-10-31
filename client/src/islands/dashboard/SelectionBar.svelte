<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';

  type Props = {
    count: number;
    total: number;
    trash: boolean;
    busy: boolean;
    onselectall: () => void;
    onclear: () => void;
    onduplicate: () => void;
    ondelete: () => void;
    onrestore: () => void;
  };

  let { count, total, trash, busy, onselectall, onclear, onduplicate, ondelete, onrestore }: Props = $props();
</script>

<!-- Flota sobre la rejilla mientras hay selección; Escape la vacía desde la lista. Es sticky y no fixed: ocupa su sitio al
     final de la lista, así que en el móvil, donde mide varias líneas, no tapa la última fila. -->
<div
  role="toolbar"
  aria-label={m.dashboard_selection_label()}
  class="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto mt-4 flex w-full max-w-4xl flex-wrap items-center gap-2 rounded-panel bg-surface-2 py-1.5 pr-1.5 pl-5 shadow-float sm:rounded-full"
>
  <p class="mr-auto text-sm font-semibold tabular" aria-live="polite">{m.dashboard_selection_count({ count })}</p>
  {#if count < total}
    <Button size="sm" variant="ghost" onclick={onselectall}>{m.dashboard_select_all()}</Button>
  {/if}
  {#if trash}
    <Button size="sm" variant="secondary" loading={busy} onclick={onrestore}>{m.dashboard_restore()}</Button>
  {:else}
    <Button size="sm" variant="secondary" loading={busy} onclick={onduplicate}>{m.dashboard_duplicate()}</Button>
    <Button size="sm" variant="danger" disabled={busy} onclick={ondelete}>{m.dashboard_move_to_trash()}</Button>
  {/if}
  <Button size="sm" variant="ghost" onclick={onclear}>{m.dashboard_selection_clear()}</Button>
</div>
