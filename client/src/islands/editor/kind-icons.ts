import ChartPie from '@lucide/svelte/icons/chart-pie';
import Circle from '@lucide/svelte/icons/circle';
import Diamond from '@lucide/svelte/icons/diamond';
import Frame from '@lucide/svelte/icons/frame';
import Group from '@lucide/svelte/icons/group';
import Hexagon from '@lucide/svelte/icons/hexagon';
import ImageIcon from '@lucide/svelte/icons/image';
import MoveUpRight from '@lucide/svelte/icons/move-up-right';
import Slash from '@lucide/svelte/icons/slash';
import Square from '@lucide/svelte/icons/square';
import Star from '@lucide/svelte/icons/star';
import Triangle from '@lucide/svelte/icons/triangle';
import Type from '@lucide/svelte/icons/type';
import Waypoints from '@lucide/svelte/icons/waypoints';
import type { NodeType } from '../../shared/document/schema.js';
import type { MenuIcon } from '../../ui/DropdownMenu.svelte';

// Icono de cada tipo de nodo en las listas del editor, los mismos que usa la barra de herramientas.
const ICONS: Record<NodeType | 'arrow', MenuIcon> = {
  rect: Square,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
  star: Star,
  polygon: Hexagon,
  arc: ChartPie,
  line: Slash,
  arrow: MoveUpRight,
  connector: Waypoints,
  text: Type,
  image: ImageIcon,
  group: Group,
  frame: Frame,
};

export function kindIcon(type: NodeType | 'arrow'): MenuIcon {
  return ICONS[type];
}
