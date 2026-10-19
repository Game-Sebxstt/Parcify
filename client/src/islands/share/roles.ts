import { m } from '../../paraglide/messages.js';
import type { ProjectRole } from '../../shared/permissions.js';

export const PROJECT_ROLE_LABEL: Record<ProjectRole, () => string> = {
  admin: m.share_role_admin,
  editor: m.share_role_editor,
  viewer: m.share_role_viewer,
};

export const SELECT_CLASS =
  'h-9 cursor-pointer rounded-panel border border-edge bg-surface-2 px-2 text-sm text-ink hover:border-ink-muted focus-visible:border-coral';
