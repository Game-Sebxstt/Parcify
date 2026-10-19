<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import { CODE_LENGTH, normalizeCode } from './validate.ts';

  type Props = { value: string; error?: string | undefined; autofocus?: boolean };

  let { value = $bindable(), error, autofocus = false }: Props = $props();

  $effect(() => {
    const normalized = normalizeCode(value);
    if (normalized !== value) value = normalized;
  });
</script>

<Field label={m.auth_field_code()} hint={m.auth_code_hint()} {error}>
  {#snippet children({ id, describedBy, invalid })}
    <Input
      {id}
      {describedBy}
      {invalid}
      bind:value
      name="code"
      inputmode="numeric"
      autocomplete="one-time-code"
      spellcheck="false"
      class="tabular text-lg tracking-[0.3em]"
      placeholder={'0'.repeat(CODE_LENGTH)}
      data-autofocus={autofocus || undefined}
    />
  {/snippet}
</Field>
