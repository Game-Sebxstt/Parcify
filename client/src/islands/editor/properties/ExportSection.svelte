<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import Section from './Section.svelte';

  type Props = { onexport: () => void };

  let { onexport }: Props = $props();
</script>

<Section title={m.editor_props_section_export()} testid="props-export">
  <button
    type="button"
    data-testid="props-export-selection"
    onclick={onexport}
    class="h-7 w-full cursor-pointer rounded-control bg-surface-2 px-2 text-xs font-semibold text-ink transition-colors duration-(--dur-fast) hover:bg-petrol focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral"
  >
    {m.editor_props_export_selection()}
  </button>
</Section>
