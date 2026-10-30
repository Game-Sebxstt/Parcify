import ChartPie from '@lucide/svelte/icons/chart-pie';
import Circle from '@lucide/svelte/icons/circle';
import Diamond from '@lucide/svelte/icons/diamond';
import Frame from '@lucide/svelte/icons/frame';
import Hand from '@lucide/svelte/icons/hand';
import Hexagon from '@lucide/svelte/icons/hexagon';
import MousePointer from '@lucide/svelte/icons/mouse-pointer-2';
import MoveUpRight from '@lucide/svelte/icons/move-up-right';
import PenTool from '@lucide/svelte/icons/pen-tool';
import Slash from '@lucide/svelte/icons/slash';
import Square from '@lucide/svelte/icons/square';
import Star from '@lucide/svelte/icons/star';
import Triangle from '@lucide/svelte/icons/triangle';
import Type from '@lucide/svelte/icons/type';
import Waypoints from '@lucide/svelte/icons/waypoints';
import type { Tool } from '../../../engine/index.ts';
import type { MenuIcon } from '../../../ui/DropdownMenu.svelte';
import { m } from '../../../paraglide/messages.js';

export type ToolGroupId = 'navigation' | 'shapes' | 'lines' | 'text' | 'frame';

// Catálogo de la barra flotante (§2.6). `label` es el nombre corto del tooltip y del desplegable; `shortcut`, la
// tecla que se muestra en un `kbd` y, entre paréntesis, en el nombre accesible («Rectángulo (R)»).
export type ToolItem = { id: Tool; group: ToolGroupId; label: () => string; icon: MenuIcon; shortcut?: string };

export function toolAria(item: ToolItem): string {
  return item.shortcut ? `${item.label()} (${item.shortcut})` : item.label();
}

export const TOOLS: readonly ToolItem[] = [
  { id: 'select', group: 'navigation', label: m.editor_tool_select_name, icon: MousePointer, shortcut: 'V' },
  { id: 'hand', group: 'navigation', label: m.editor_tool_hand_name, icon: Hand, shortcut: 'H' },
  { id: 'frame', group: 'frame', label: m.editor_tool_frame_name, icon: Frame, shortcut: 'F' },
  { id: 'rect', group: 'shapes', label: m.editor_tool_rect_name, icon: Square, shortcut: 'R' },
  { id: 'ellipse', group: 'shapes', label: m.editor_tool_ellipse_name, icon: Circle, shortcut: 'O' },
  { id: 'triangle', group: 'shapes', label: m.editor_tool_triangle, icon: Triangle },
  { id: 'diamond', group: 'shapes', label: m.editor_tool_diamond, icon: Diamond },
  { id: 'star', group: 'shapes', label: m.editor_tool_star, icon: Star },
  { id: 'polygon', group: 'shapes', label: m.editor_tool_polygon, icon: Hexagon },
  { id: 'arc', group: 'shapes', label: m.editor_tool_arc, icon: ChartPie },
  { id: 'line', group: 'lines', label: m.editor_tool_line_name, icon: Slash, shortcut: 'L' },
  { id: 'arrow', group: 'lines', label: m.editor_tool_arrow_name, icon: MoveUpRight, shortcut: 'Shift+L' },
  { id: 'connector', group: 'lines', label: m.editor_tool_connector_name, icon: Waypoints, shortcut: 'C' },
  { id: 'pen', group: 'lines', label: m.editor_tool_pen_name, icon: PenTool, shortcut: 'P' },
  { id: 'text', group: 'text', label: m.editor_tool_text_name, icon: Type, shortcut: 'T' },
];

export function toolsOf(group: ToolGroupId): readonly ToolItem[] {
  return TOOLS.filter((item) => item.group === group);
}

export function toolById(id: Tool): ToolItem {
  return TOOLS.find((item) => item.id === id)!;
}

// Atajo de Imagen, que es una acción y no una herramienta (hallazgo 12).
export const IMAGE_SHORTCUT = 'Ctrl+Shift+K';
