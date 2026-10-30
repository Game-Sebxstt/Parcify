<script lang="ts" module>
  import type { Component } from 'svelte';

  export type MenuIcon = Component<{ size?: number; class?: string }>;

  type Shared = { id: string; label: string; icon?: MenuIcon | undefined; disabled?: boolean | undefined };

  export type MenuEntry =
    | (Shared & {
        kind: 'item';
        keys?: string | undefined;
        ariaKeys?: string | undefined;
        danger?: boolean | undefined;
        // Deja vacía la columna de la marca para alinearse con las entradas `check` del mismo menú.
        inset?: boolean | undefined;
        onSelect: () => void;
      })
    | (Shared & { kind: 'check'; checked: boolean; keys?: string | undefined; ariaKeys?: string | undefined; onSelect: () => void })
    | (Shared & { kind: 'sub'; items: MenuEntry[] })
    | { kind: 'label'; id: string; label: string; items: MenuEntry[] }
    | { kind: 'separator'; id: string };
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { DropdownMenu } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { VirtualAnchor } from './anchor.ts';

  type Props = {
    items: MenuEntry[];
    open?: boolean;
    trigger?: Snippet<[Record<string, unknown>]>;
    // Sin disparador, el menú se ancla aquí (un punto del lienzo, por ejemplo).
    anchor?: VirtualAnchor | HTMLElement | null;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    // 'always': se desplaza lo que haga falta para caber entero, aunque se separe del ancla (menú en un punto).
    sticky?: 'partial' | 'always';
    label?: string;
    testid?: string;
    class?: string;
    // Con el menú en un punto no hay disparador que reciba el foco: va a la primera entrada que se puede usar.
    focusFirst?: boolean;
    onOpenChange?: (open: boolean) => void;
    onInteractOutside?: (event: PointerEvent) => void;
    onCloseAutoFocus?: (event: Event) => void;
  };

  let {
    items,
    open = $bindable(false),
    trigger,
    anchor = null,
    side = 'bottom',
    align = 'start',
    sideOffset = 6,
    sticky = 'partial',
    label,
    testid,
    class: className = '',
    focusFirst = false,
    onOpenChange,
    onInteractOutside,
    onCloseAutoFocus,
  }: Props = $props();

  let content = $state<HTMLElement | null>(null);
  let triggerRef = $state<HTMLElement | null>(null);
  // Sin `label`, el menú toma el nombre de su disparador.
  const labelledBy = $derived(label ? undefined : triggerRef?.id || undefined);

  const ITEM = [
    'flex min-h-8 cursor-default items-center gap-2 rounded-control px-2 outline-none select-none pointer-coarse:min-h-11',
    'data-highlighted:bg-petrol data-disabled:cursor-not-allowed data-disabled:text-ink-muted',
  ].join(' ');
  const PANEL =
    'z-(--z-popover) max-h-(--bits-floating-available-height) min-w-48 overflow-x-hidden overflow-y-auto scroll-thin rounded-panel border border-edge/40 bg-surface-2 p-1 text-ui text-ink shadow-float outline-none';

  function openAutoFocus(event: Event) {
    if (!focusFirst) return;
    event.preventDefault();
    // Sin entradas habilitadas (solo lectura, sin selección) el foco va al panel: así sale del lienzo y Esc lo cierra.
    const first = content?.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])');
    (first ?? content)?.focus();
  }

  // bits-ui devuelve el foco al disparador al cerrar; si la acción ya lo llevó a otro sitio (un campo de nombre), se queda allí.
  function closeAutoFocus(event: Event) {
    if (onCloseAutoFocus) return onCloseAutoFocus(event);
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest('[data-floating]')) event.preventDefault();
  }

  // bits-ui solo saca el foco con Tab hacia el elemento siguiente al disparador; sin disparador, Tab cierra el menú.
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || trigger) return;
    event.preventDefault();
    open = false;
    onOpenChange?.(false);
  }
</script>

{#snippet leading(icon: MenuIcon | undefined)}
  {#if icon}
    {@const Icon = icon}
    <span aria-hidden="true" class="inline-flex size-4 shrink-0 items-center justify-center text-ink-muted"><Icon size={16} /></span>
  {/if}
{/snippet}

{#snippet shortcut(keys: string | undefined)}
  {#if keys}
    <span aria-hidden="true" class="ml-auto shrink-0 pl-6 text-2xs text-ink-muted tabular">{keys}</span>
  {/if}
{/snippet}

{#snippet list(entries: MenuEntry[])}
  {#each entries as entry (entry.id)}
    {#if entry.kind === 'separator'}
      <DropdownMenu.Separator class="mx-1 my-1 h-px bg-edge/25" />
    {:else if entry.kind === 'label'}
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading class="px-2 pt-1.5 pb-1 text-2xs font-semibold text-ink-muted">{entry.label}</DropdownMenu.GroupHeading>
        {@render list(entry.items)}
      </DropdownMenu.Group>
    {:else if entry.kind === 'item'}
      <DropdownMenu.Item
        disabled={entry.disabled ?? false}
        textValue={entry.label}
        aria-keyshortcuts={entry.ariaKeys}
        onSelect={() => entry.onSelect()}
        class={[ITEM, entry.danger && !entry.disabled ? 'text-danger' : ''].join(' ')}
      >
        {#if entry.inset}<span aria-hidden="true" class="size-4 shrink-0"></span>{/if}
        {@render leading(entry.icon)}
        <span class="min-w-0 flex-1 truncate">{entry.label}</span>
        {@render shortcut(entry.keys)}
      </DropdownMenu.Item>
    {:else if entry.kind === 'check'}
      <DropdownMenu.CheckboxItem
        checked={entry.checked}
        disabled={entry.disabled ?? false}
        textValue={entry.label}
        aria-keyshortcuts={entry.ariaKeys}
        onSelect={() => entry.onSelect()}
        class={ITEM}
      >
        <span aria-hidden="true" class="inline-flex size-4 shrink-0 items-center justify-center text-coral">
          {#if entry.checked}<Check size={14} />{/if}
        </span>
        {@render leading(entry.icon)}
        <span class="min-w-0 flex-1 truncate">{entry.label}</span>
        {@render shortcut(entry.keys)}
      </DropdownMenu.CheckboxItem>
    {:else}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger disabled={entry.disabled ?? false} textValue={entry.label} class={[ITEM, 'data-[state=open]:bg-petrol'].join(' ')}>
          {@render leading(entry.icon)}
          <span class="min-w-0 flex-1 truncate">{entry.label}</span>
          <span aria-hidden="true" class="ml-auto inline-flex shrink-0 pl-4 text-ink-muted"><ChevronRight size={14} /></span>
        </DropdownMenu.SubTrigger>
        <!-- En portal: el panel padre tiene scroll propio y recortaría el submenú. -->
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent sideOffset={4} collisionPadding={8} data-floating="" data-own-keys="" class={PANEL}>
            {@render list(entry.items)}
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    {/if}
  {/each}
{/snippet}

<DropdownMenu.Root bind:open onOpenChange={(value) => onOpenChange?.(value)}>
  {#if trigger}
    <DropdownMenu.Trigger bind:ref={triggerRef}>
      {#snippet child({ props })}
        {@render trigger(props)}
      {/snippet}
    </DropdownMenu.Trigger>
  {/if}
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      bind:ref={content}
      customAnchor={anchor}
      {side}
      {align}
      {sideOffset}
      {sticky}
      collisionPadding={8}
      avoidCollisions
      aria-label={label}
      aria-labelledby={labelledBy}
      data-testid={testid}
      data-floating=""
      data-own-keys=""
      onOpenAutoFocus={openAutoFocus}
      onkeydown={onKeydown}
      oncontextmenu={(event: MouseEvent) => event.preventDefault()}
      {...onInteractOutside ? { onInteractOutside } : {}}
      onCloseAutoFocus={closeAutoFocus}
      class={[PANEL, className].join(' ')}
    >
      {@render list(items)}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
