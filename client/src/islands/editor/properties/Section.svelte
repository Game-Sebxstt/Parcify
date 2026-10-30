<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    testid?: string;
    // Iconos de 24 px a la derecha del título: añadir, quitar, ver.
    actions?: Snippet;
    children?: Snippet;
  };

  let { title, testid, actions, children }: Props = $props();

  const uid = $props.id();
</script>

<section aria-labelledby="{uid}-title" data-testid={testid} class="min-w-0 border-t border-edge/25 first:border-t-0">
  <div class="flex h-8 min-w-0 items-center gap-1 pr-2 pl-3">
    <h2 id="{uid}-title" class="min-w-0 flex-1 truncate text-2xs font-semibold text-ink-muted">{title}</h2>
    {#if actions}
      <div class="flex shrink-0 items-center">{@render actions()}</div>
    {/if}
  </div>
  {#if children}
    <!-- Sin filas (relleno o sombra quitados) solo queda el título: empty:hidden quita el hueco del cuerpo. -->
    <div class="flex min-w-0 flex-col gap-2 px-3 pb-3 empty:hidden">{@render children()}</div>
  {/if}
</section>
