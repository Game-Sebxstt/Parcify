<script lang="ts">
  import type { Snippet } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';

  type Props = {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    danger?: boolean;
    busy?: boolean;
    children?: Snippet;
    onconfirm: () => void;
    onCloseAutoFocus?: (event: Event) => void;
  };

  let { open = $bindable(false), title, description, confirmLabel, danger = false, busy = false, children, onconfirm, onCloseAutoFocus }: Props = $props();
</script>

<Dialog bind:open {title} {description} {onCloseAutoFocus}>
  {@render children?.()}
  <div class="mt-1 flex justify-end gap-2">
    <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
    <Button variant={danger ? 'danger' : 'secondary'} loading={busy} onclick={onconfirm}>{confirmLabel}</Button>
  </div>
</Dialog>
