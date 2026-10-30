<script lang="ts">
  let { size = 16, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
  <circle cx="4" cy="12" r="1.5" />
  <circle cx="9.33" cy="12" r="1.5" />
  <circle cx="14.67" cy="12" r="1.5" />
  <circle cx="20" cy="12" r="1.5" />
</svg>
