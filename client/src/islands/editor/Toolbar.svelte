<script lang="ts">
  import ChartPie from '@lucide/svelte/icons/chart-pie';
  import Circle from '@lucide/svelte/icons/circle';
  import Diamond from '@lucide/svelte/icons/diamond';
  import Frame from '@lucide/svelte/icons/frame';
  import Hand from '@lucide/svelte/icons/hand';
  import Hexagon from '@lucide/svelte/icons/hexagon';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Images from '@lucide/svelte/icons/images';
  import MousePointer from '@lucide/svelte/icons/mouse-pointer-2';
  import MoveUpRight from '@lucide/svelte/icons/move-up-right';
  import Slash from '@lucide/svelte/icons/slash';
  import Square from '@lucide/svelte/icons/square';
  import Star from '@lucide/svelte/icons/star';
  import Triangle from '@lucide/svelte/icons/triangle';
  import Type from '@lucide/svelte/icons/type';
  import Waypoints from '@lucide/svelte/icons/waypoints';
  import type { Component } from 'svelte';
  import type { Tool } from '../../engine/index.ts';
  import { m } from '../../paraglide/messages.js';
  import ToolButton from './ToolButton.svelte';

  type Props = { tool: Tool; readOnly: boolean; gallery: boolean; onselect: (tool: Tool) => void; onimage: () => void; ongallery: () => void };

  let { tool, readOnly, gallery, onselect, onimage, ongallery }: Props = $props();

  const NAVIGATION: Array<{ id: Tool; label: () => string; icon: Component }> = [
    { id: 'select', label: m.editor_tool_select, icon: MousePointer },
    { id: 'hand', label: m.editor_tool_hand, icon: Hand },
  ];

  const SHAPES: Array<{ id: Tool; label: () => string; icon: Component }> = [
    { id: 'rect', label: m.editor_tool_rect, icon: Square },
    { id: 'ellipse', label: m.editor_tool_ellipse, icon: Circle },
    { id: 'triangle', label: m.editor_tool_triangle, icon: Triangle },
    { id: 'diamond', label: m.editor_tool_diamond, icon: Diamond },
    { id: 'star', label: m.editor_tool_star, icon: Star },
    { id: 'polygon', label: m.editor_tool_polygon, icon: Hexagon },
    { id: 'arc', label: m.editor_tool_arc, icon: ChartPie },
    { id: 'line', label: m.editor_tool_line, icon: Slash },
    { id: 'arrow', label: m.editor_tool_arrow, icon: MoveUpRight },
    { id: 'connector', label: m.editor_tool_connector, icon: Waypoints },
    { id: 'text', label: m.editor_tool_text, icon: Type },
    { id: 'frame', label: m.editor_tool_frame, icon: Frame },
  ];
</script>

<nav aria-label={m.editor_tools_label()} class="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto bg-surface-1 py-2">
  {#each NAVIGATION as item (item.id)}
    <ToolButton label={item.label()} pressed={tool === item.id} onclick={() => onselect(item.id)}>
      <item.icon size={18} aria-hidden="true" />
    </ToolButton>
  {/each}
  {#if !readOnly}
    <div class="h-3" aria-hidden="true"></div>
    {#each SHAPES as item (item.id)}
      <ToolButton label={item.label()} pressed={tool === item.id} onclick={() => onselect(item.id)}>
        <item.icon size={18} aria-hidden="true" />
      </ToolButton>
    {/each}
    <ToolButton label={m.editor_tool_image()} onclick={onimage}>
      <ImagePlus size={18} aria-hidden="true" />
    </ToolButton>
  {/if}
  <div class="flex-1" aria-hidden="true"></div>
  <ToolButton label={m.editor_gallery()} pressed={gallery} onclick={ongallery}>
    <Images size={18} aria-hidden="true" />
  </ToolButton>
</nav>
