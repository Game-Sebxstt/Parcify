<script lang="ts" module>
  export type FieldControl = { id: string; describedBy: string | undefined; invalid: boolean };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    label: string;
    hint?: string;
    error?: string | null;
    id?: string;
    children: Snippet<[FieldControl]>;
  };

  const uid = $props.id();
  let { label, hint, error = null, id = `field-${uid}`, children }: Props = $props();

  const hintId = $derived(`${id}-hint`);
  const errorId = $derived(`${id}-error`);
  const describedBy = $derived([hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined);
</script>

<div class="flex flex-col gap-1.5">
  <label for={id} class="text-sm font-medium text-ink">{label}</label>
  {@render children({ id, describedBy, invalid: Boolean(error) })}
  {#if hint}
    <p id={hintId} class="text-xs text-ink-muted">{hint}</p>
  {/if}
  <p id={errorId} aria-live="polite" class="text-sm text-danger empty:hidden">{error ?? ''}</p>
</div>
