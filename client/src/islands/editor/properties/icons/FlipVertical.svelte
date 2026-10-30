<script lang="ts">
  let { size = 16, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<!-- Dos triángulos enfrentados a un eje horizontal discontinuo. -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
  <path d="M3 12h2M9 12h2M13 12h2M19 12h2" />
  <path d="M6 8 18 3v5z" />
  <path d="m6 16 12 5v-5z" />
</svg>
