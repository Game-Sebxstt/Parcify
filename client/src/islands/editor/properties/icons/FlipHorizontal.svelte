<script lang="ts">
  let { size = 16, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<!-- Dos triángulos enfrentados a un eje vertical discontinuo. -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
  <path d="M12 3v2M12 9v2M12 13v2M12 19v2" />
  <path d="M8 6 3 18h5z" />
  <path d="m16 6 5 12h-5z" />
</svg>
