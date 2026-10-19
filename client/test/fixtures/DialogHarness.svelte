<script lang="ts">
  import Button from '../../src/ui/Button.svelte';
  import Dialog from '../../src/ui/Dialog.svelte';
</script>

<button type="button">Fuera</button>
<Dialog title="Renombrar proyecto" description="El nombre se ve en la lista de proyectos.">
  {#snippet trigger(props)}
    <Button {...props}>Renombrar</Button>
  {/snippet}
  <label>Nombre <input name="nombre" /></label>
  <Button variant="primary">Guardar</Button>
</Dialog>
