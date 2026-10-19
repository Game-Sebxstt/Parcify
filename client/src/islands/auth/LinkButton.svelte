<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = { onclick: () => void; disabled?: boolean; children: Snippet };

  let { onclick, disabled = false, children }: Props = $props();
</script>

<button
  type="button"
  {onclick}
  {disabled}
  class="inline-flex min-h-6 cursor-pointer items-center rounded-[4px] font-semibold text-ink underline decoration-ink-muted underline-offset-4 hover:decoration-ink disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
>
  {@render children()}
</button>
