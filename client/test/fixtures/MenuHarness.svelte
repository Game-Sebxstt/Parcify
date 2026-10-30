<script lang="ts">
  import Menu from '../../src/ui/Menu.svelte';

  let editing = $state(false);
  let name = $state('Página 1');

  const focusInput = (node: HTMLInputElement) => {
    node.focus();
    node.select();
  };

  function finish(value: string | null) {
    editing = false;
    if (value !== null) name = value;
  }
</script>

{#if editing}
  <input
    {@attach focusInput}
    aria-label="Nombre de la página"
    value={name}
    onkeydown={(event) => {
      if (event.key === 'Enter') finish(event.currentTarget.value);
      else if (event.key === 'Escape') finish(null);
    }}
    onblur={(event) => {
      if (editing) finish(event.currentTarget.value);
    }}
  />
{:else}
  <span>{name}</span>
{/if}
<Menu items={[{ label: 'Renombrar', onSelect: () => (editing = true) }]}>
  {#snippet trigger(props)}
    <button {...props} type="button" aria-label="Acciones">⋯</button>
  {/snippet}
</Menu>
