<script lang="ts">
  type Props = { class?: string; rounded?: 'panel' | 'full' };

  let { class: className = '', rounded = 'panel' }: Props = $props();
</script>

<div
  aria-hidden="true"
  class={['bg-surface-2', rounded === 'full' ? 'rounded-full' : 'rounded-panel', className].join(' ')}
></div>
