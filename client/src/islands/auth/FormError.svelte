<script lang="ts">
  type Props = { message: string | null; id?: string };

  let { message, id }: Props = $props();
</script>

<p {id} aria-live="polite" class="text-sm text-danger empty:hidden">{message ?? ''}</p>
