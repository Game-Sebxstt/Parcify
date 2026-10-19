<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';

  type Props = {
    open: boolean;
    title: string;
    label: string;
    submitLabel: string;
    initial?: string;
    primary?: boolean;
    // Devuelve el mensaje de error o null si todo fue bien.
    onsubmit: (name: string) => Promise<string | null>;
  };

  let { open = $bindable(false), title, label, submitLabel, initial = '', primary = false, onsubmit }: Props = $props();

  let value = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (open) {
      value = initial;
      error = null;
    }
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const name = value.trim();
    if (!name) {
      error = m.dashboard_name_required();
      return;
    }
    busy = true;
    error = await onsubmit(name);
    busy = false;
    if (!error) open = false;
  }
</script>

<Dialog bind:open {title}>
  <form onsubmit={submit} class="flex flex-col gap-5" novalidate>
    <Field {label} {error}>
      {#snippet children(control)}
        <Input
          id={control.id}
          describedBy={control.describedBy}
          invalid={control.invalid}
          bind:value
          maxlength={80}
          autocomplete="off"
          autofocus
        />
      {/snippet}
    </Field>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button type="submit" variant={primary ? 'primary' : 'secondary'} loading={busy}>{submitLabel}</Button>
    </div>
  </form>
</Dialog>
