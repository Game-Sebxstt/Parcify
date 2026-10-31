<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { m } from '../../../paraglide/messages.js';
  import type { MenuEntry, MenuIcon } from '../../../ui/DropdownMenu.svelte';
  import Sheet from '../../../ui/Sheet.svelte';

  type Props = {
    // Las mismas entradas que el menú de escritorio; los atajos de teclado no se muestran.
    items: MenuEntry[];
    title: string;
    // returnFocus: se cerró sin elegir nada, o después de una acción que no lleva el foco a otro sitio.
    onclose: (returnFocus: boolean) => void;
    testid?: string;
  };

  let { items, title, onclose, testid = 'action-sheet' }: Props = $props();

  type Leaf = Extract<MenuEntry, { kind: 'item' | 'check' | 'sub' }>;
  type Section = { id: string; label: string | null; rows: Leaf[] };

  let open = $state(true);
  // Submenú abierto («Ordenar ▸»): la hoja muestra sus entradas y una fila para volver.
  let sub = $state.raw<Extract<MenuEntry, { kind: 'sub' }> | null>(null);
  let list = $state<HTMLElement | null>(null);

  // Las entradas desactivadas no se muestran: en el móvil la hoja solo ofrece lo que se puede hacer. Lo destructivo va
  // al final, en su propia sección.
  const sections = $derived.by((): Section[] => {
    const result: Section[] = [];
    const danger: Leaf[] = [];
    let current: Section = { id: 'first', label: null, rows: [] };
    const push = () => {
      if (current.rows.length) result.push(current);
    };
    for (const entry of sub?.items ?? items) {
      if (entry.kind === 'separator') {
        push();
        current = { id: entry.id, label: null, rows: [] };
      } else if (entry.kind === 'label') {
        push();
        result.push({ id: entry.id, label: entry.label, rows: entry.items.filter(usable) });
        current = { id: `${entry.id}-after`, label: null, rows: [] };
      } else if (usable(entry)) {
        if (entry.kind === 'item' && entry.danger) danger.push(entry);
        else current.rows.push(entry);
      }
    }
    push();
    if (danger.length) result.push({ id: 'danger', label: null, rows: danger });
    return result.filter((section) => section.rows.length);
  });

  function usable(entry: MenuEntry): entry is Leaf {
    return (entry.kind === 'item' || entry.kind === 'check' || entry.kind === 'sub') && !entry.disabled;
  }

  let closed = false;

  function finish(returnFocus: boolean) {
    if (closed) return;
    closed = true;
    open = false;
    onclose(returnFocus);
  }

  // La hoja aparece bajo el dedo de la pulsación larga: al levantarlo, el navegador puede mandar un clic a la fila que
  // quedó debajo. Solo cuentan los toques que empiezan dentro de la hoja (y el teclado, que llega con detail 0).
  let armed = false;
  const stray = (event: MouseEvent) => event.detail !== 0 && !armed;

  // La acción corre dentro del toque: pegar y copiar necesitan el gesto del usuario.
  function choose(entry: Leaf, event: MouseEvent) {
    if (stray(event)) return;
    if (entry.kind === 'sub') {
      sub = entry;
      focusFirst();
      return;
    }
    entry.onSelect();
    finish(true);
  }

  function back() {
    sub = null;
    focusFirst();
  }

  function focusFirst() {
    requestAnimationFrame(() => list?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }));
  }
</script>

{#snippet leading(icon: MenuIcon | undefined)}
  {#if icon}
    {@const Icon = icon}
    <span aria-hidden="true" class="inline-flex size-5 shrink-0 items-center justify-center text-ink-muted"><Icon size={20} /></span>
  {/if}
{/snippet}

<Sheet
  bind:open
  title={sub ? sub.label : title}
  modal
  {testid}
  onOpenChange={(value) => {
    if (!value) finish(true);
  }}
>
  <div bind:this={list} onpointerdowncapture={() => (armed = true)} class="flex flex-col px-2 pb-2" role="presentation">
    {#if sub}
      <button
        type="button"
        onclick={(event) => {
          if (!stray(event)) back();
        }}
        class="flex h-12 w-full cursor-pointer items-center gap-3 rounded-card px-3 text-left text-sm text-ink hover:bg-surface-2"
      >
        <ChevronLeft size={20} aria-hidden="true" class="shrink-0 text-ink-muted" />
        {m.editor_mobile_actions_back()}
      </button>
    {/if}
    {#each sections as section (section.id)}
      <div role="group" aria-label={section.label ?? undefined} class="flex flex-col border-t border-edge/25 py-1 first:border-t-0">
        {#if section.label}
          <p aria-hidden="true" class="px-3 pt-2 pb-1 text-2xs font-semibold text-ink-muted">{section.label}</p>
        {/if}
        {#each section.rows as entry (entry.id)}
          <button
            type="button"
            aria-pressed={entry.kind === 'check' ? entry.checked : undefined}
            aria-haspopup={entry.kind === 'sub' ? 'true' : undefined}
            onclick={(event) => choose(entry, event)}
            class={[
              'flex h-12 w-full cursor-pointer items-center gap-3 rounded-card px-3 text-left text-sm hover:bg-surface-2',
              entry.kind === 'item' && entry.danger ? 'text-danger' : 'text-ink',
            ]}
            data-action={entry.id}
          >
            {@render leading(entry.icon)}
            <span class="min-w-0 flex-1 truncate">{entry.label}</span>
            {#if entry.kind === 'check' && entry.checked}
              <Check size={18} aria-hidden="true" class="shrink-0 text-coral" />
            {:else if entry.kind === 'sub'}
              <ChevronRight size={18} aria-hidden="true" class="shrink-0 text-ink-muted" />
            {/if}
          </button>
        {/each}
      </div>
    {/each}
    <div class="border-t border-edge/25 pt-1">
      <button
        type="button"
        onclick={(event) => {
          if (!stray(event)) finish(true);
        }}
        class="flex h-12 w-full cursor-pointer items-center justify-center rounded-card px-3 text-sm font-semibold text-ink hover:bg-surface-2"
      >
        {m.common_cancel()}
      </button>
    </div>
  </div>
</Sheet>
