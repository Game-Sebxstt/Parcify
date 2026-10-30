<script lang="ts">
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import List from '@lucide/svelte/icons/list';
  import { m } from '../../paraglide/messages.js';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import { writeView, type ProjectView } from './view.ts';

  type Props = { view: ProjectView; onchange: (view: ProjectView) => void };

  let { view, onchange }: Props = $props();
</script>

<!-- 28 px: el tamaño sm del control con su margen interior. -->
<SegmentedControl
  items={[
    { value: 'grid', label: m.dashboard_view_grid(), icon: LayoutGrid },
    { value: 'list', label: m.dashboard_view_list(), icon: List },
  ]}
  bind:value={
    () => view,
    (next) => {
      const chosen: ProjectView = next === 'list' ? 'list' : 'grid';
      writeView(chosen);
      onchange(chosen);
    }
  }
  label={m.dashboard_view_label()}
  iconOnly
  size="sm"
  testid="project-view"
/>
