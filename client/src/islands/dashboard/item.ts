import type { Attachment } from 'svelte/attachments';
import { formatRelative } from '../../lib/format.ts';
import { m } from '../../paraglide/messages.js';
import type { ProjectSummary } from '../../shared/api/projects.js';
import { longPress } from '../../ui/longpress.ts';

export type MenuPoint = { x: number; y: number };

export function editedLabel(project: ProjectSummary, meId: string): string {
  if (project.deletedAt) return m.dashboard_card_trashed({ when: formatRelative(project.deletedAt) });
  const when = formatRelative(project.lastEditedAt);
  if (!project.lastEditedBy) return m.dashboard_card_edited({ when });
  if (project.lastEditedBy.id === meId) return m.dashboard_card_edited_by_you({ when });
  return m.dashboard_card_edited_by({ when, name: project.lastEditedBy.name });
}

// Menú contextual de una tarjeta o fila: clic derecho (ratón y touchpad), Shift+F10 o la tecla Menú, y pulsación larga
// con el dedo o el lápiz. El contextmenu nativo que llega tras un toque ya lo descarta `longPress`.
export function projectContextMenu(open: (point: MenuPoint) => void): Attachment<HTMLElement> {
  const press = longPress((point) => open({ x: point.clientX, y: point.clientY }));
  return (node) => {
    const release = press(node);
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      // Desde el teclado el evento no trae coordenadas: el menú sale bajo el elemento con el foco.
      if (event.clientX === 0 && event.clientY === 0 && event.target instanceof Element) {
        const rect = event.target.getBoundingClientRect();
        open({ x: rect.left + 8, y: rect.bottom });
        return;
      }
      open({ x: event.clientX, y: event.clientY });
    };
    node.addEventListener('contextmenu', onContextMenu);
    return () => {
      if (typeof release === 'function') release();
      node.removeEventListener('contextmenu', onContextMenu);
    };
  };
}

// Props del disparador de un Tooltip para un texto: sin `disabled`, que no existe en un enlace ni en un párrafo, y sin
// `tabindex`, para que la segunda línea no sea una parada más del tabulador.
export function textTooltipProps(tip: Record<string, unknown>): Record<string, unknown> {
  const { disabled: _disabled, tabindex: _tabindex, ...rest } = tip;
  return rest;
}

// Con la selección en marcha, o con Mayús o Ctrl/⌘, el clic en la miniatura o el nombre selecciona en vez de abrir.
export function selectsInsteadOfOpening(event: MouseEvent, selecting: boolean): boolean {
  return selecting || event.shiftKey || event.metaKey || event.ctrlKey;
}
