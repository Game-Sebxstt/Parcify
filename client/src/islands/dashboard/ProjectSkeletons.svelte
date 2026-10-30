<script lang="ts">
  import Skeleton from '../../ui/Skeleton.svelte';
  import type { ProjectView } from './view.ts';

  type Props = { view: ProjectView; count?: number };

  let { view, count = 10 }: Props = $props();

  const slots = $derived(Array.from({ length: count }, (_, index) => index));
</script>

<!-- Mismo tamaño que las tarjetas y las filas reales: al llegar los datos nada salta. -->
<ul
  aria-hidden="true"
  data-testid="project-skeletons"
  class={view === 'grid'
    ? 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(208px,1fr))] sm:gap-4'
    : 'flex flex-col'}
>
  {#each slots as index (index)}
    {#if view === 'grid'}
      <li class="flex flex-col">
        <Skeleton class="aspect-[16/10] w-full rounded-card!" />
        <!-- Las dos líneas de texto de la tarjeta: 13 px con interlineado 1,4 y 12 px con 16 px. -->
        <div class="mt-2 px-0.5">
          <div class="flex h-[18.2px] items-center"><Skeleton class="h-3 w-2/3 rounded-xs!" /></div>
          <div class="flex h-4 items-center"><Skeleton class="h-2.5 w-1/2 rounded-xs!" /></div>
        </div>
      </li>
    {:else}
      <li class="flex h-11 items-center gap-3 px-2">
        <Skeleton class="h-[25px] w-10 rounded-xs!" />
        <Skeleton class="h-3.5 w-1/3 rounded-xs!" />
      </li>
    {/if}
  {/each}
</ul>
