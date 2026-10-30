import { m } from '../../paraglide/messages.js';
import type { ProjectRole } from '../../shared/permissions.js';

export const PROJECT_ROLE_LABEL: Record<ProjectRole, () => string> = {
  admin: m.share_role_admin,
  editor: m.share_role_editor,
  viewer: m.share_role_viewer,
};

// Clases del `Select` de rol (tamaño `lg`) para que mida lo mismo que el campo y el botón de al lado.
export const SELECT_CLASS = 'h-9 px-2.5 text-sm';
