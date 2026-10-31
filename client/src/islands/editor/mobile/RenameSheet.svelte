<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import Sheet from '../../../ui/Sheet.svelte';

  type Props = {
    open?: boolean;
    // Nombre accesible del campo («Nombre del proyecto», «Nombre de la capa»).
    label: string;
    value: string;
    maxlength?: number;
    // Devuelve false si no se pudo guardar: la hoja sigue abierta con lo escrito.
    onsave: (name: string) => Promise<boolean> | boolean;
    onOpenChange?: (open: boolean) => void;
    // Alto de la hoja en pantalla.
    height?: number;
  };

  let { open = $bindable(false), label, value, maxlength = 80, onsave, onOpenChange, height = $bindable(0) }: Props = $props();

  let field = $state<HTMLInputElement | null>(null);
  // Borrador que vuelve al nombre real cada vez que este cambia; quien abre la hoja la monta con el nombre actual.
  let draft = $derived(value);
  let saving = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || name === value) {
      open = false;
      onOpenChange?.(false);
      return;
    }
    saving = true;
    const ok = await onsave(name);
    saving = false;
    if (!ok) return;
    open = false;
    onOpenChange?.(false);
  }
</script>

<Sheet bind:open bind:height title={m.editor_mobile_rename_title()} modal={false} initialFocus={() => field} testid="rename-sheet" {onOpenChange}>
  <form class="flex flex-col gap-3 px-4 pt-1 pb-4" onsubmit={submit}>
    <input
      bind:this={field}
      bind:value={draft}
      aria-label={label}
      {maxlength}
      disabled={saving}
      enterkeyhint="done"
      autocomplete="off"
      class="h-9 w-full min-w-0 rounded-control border border-transparent bg-surface-2 px-3 text-sm text-ink outline-none hover:border-edge/60 focus:outline-1 focus:-outline-offset-1 focus:outline-coral"
      onfocus={() => field?.select()}
    />
    <button
      type="submit"
      disabled={saving}
      class="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-card bg-coral px-4 text-sm font-semibold text-coral-ink transition-colors duration-(--dur-fast) hover:bg-coral-hover disabled:cursor-wait disabled:opacity-60"
    >
      {m.common_save()}
    </button>
  </form>
</Sheet>
