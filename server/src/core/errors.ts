import type { ErrorCode } from '../shared/api/errors.js';

export const ERROR_CATALOG = {
  VALIDATION_FAILED: { status: 400, message: 'Hay datos que no son válidos.' },
  INVALID_ASSET: { status: 400, message: 'Esa imagen no se puede usar aquí.' },
  INVALID_ATTACHMENT: { status: 400, message: 'Algún adjunto no pertenece a este proyecto.' },
  INVALID_ARCHIVE: { status: 400, message: 'El archivo .parcify no es válido.' },
  UNAUTHORIZED: { status: 401, message: 'Tienes que iniciar sesión.' },
  FORBIDDEN: { status: 403, message: 'No tienes permiso para hacer esto.' },
  BAD_ORIGIN: { status: 403, message: 'La petición no viene de un origen permitido.' },
  EMAIL_NOT_VERIFIED: { status: 403, message: 'Primero tienes que verificar tu email.' },
  SESSION_NOT_FRESH: { status: 403, message: 'Por seguridad, vuelve a iniciar sesión para confirmar.' },
  NOT_FOUND: { status: 404, message: 'No encontramos lo que buscas.' },
  PROJECT_NOT_FOUND: { status: 404, message: 'No encontramos ese proyecto.' },
  WORKSPACE_NOT_FOUND: { status: 404, message: 'No encontramos ese espacio.' },
  ASSET_NOT_FOUND: { status: 404, message: 'No encontramos esa imagen.' },
  INVITE_NOT_FOUND: { status: 404, message: 'No encontramos esa invitación.' },
  CONFLICT: { status: 409, message: 'Ya existe algo con esos datos.' },
  LAST_OWNER: { status: 409, message: 'El espacio necesita al menos un propietario.' },
  PERSONAL_WORKSPACE: { status: 409, message: 'No puedes hacer esto con tu espacio personal.' },
  WORKSPACE_IN_TRASH: { status: 409, message: 'Este espacio está en la papelera. Restáuralo para seguir.' },
  MUST_TRANSFER_OWNERSHIP: {
    status: 409,
    message: 'Antes de borrar tu cuenta, cede la propiedad de los espacios que compartes.',
  },
  MEMBERSHIP_LIMIT: { status: 409, message: 'Este espacio ya no admite más miembros.' },
  INVITE_ALREADY_HANDLED: { status: 409, message: 'Esta invitación ya se usó o se canceló.' },
  INVITE_EMAIL_MISMATCH: { status: 404, message: 'No encontramos esa invitación.' },
  DOCUMENT_RELOADED: { status: 409, message: 'El proyecto se recargó. Inténtalo de nuevo.' },
  RESTORE_IN_PROGRESS: { status: 409, message: 'Ya se está restaurando una versión de este proyecto.' },
  INVITE_EXPIRED: { status: 410, message: 'Esta invitación caducó. Pide una nueva a quien te invitó.' },
  INVITE_REVOKED: { status: 410, message: 'Esta invitación se revocó.' },
  INVITE_USED_UP: { status: 410, message: 'Esta invitación ya no admite más usos.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'El contenido es demasiado grande.' },
  UNSUPPORTED_FILE: { status: 422, message: 'Ese archivo no es una imagen compatible.' },
  PROCESSING_TIMEOUT: { status: 422, message: 'La imagen tardó demasiado en procesarse.' },
  AI_REFUSED: { status: 422, message: 'El proveedor rechazó esta petición.' },
  RATE_LIMITED: { status: 429, message: 'Demasiadas peticiones. Espera un momento.' },
  AI_QUOTA_EXCEEDED: { status: 429, message: 'Se agotó la cuota de IA.' },
  INTERNAL: { status: 500, message: 'Algo falló por nuestra parte. Inténtalo de nuevo.' },
  AI_BAD_OUTPUT: { status: 502, message: 'La IA devolvió una respuesta que no pudimos usar.' },
  AI_PROVIDER_ERROR: { status: 502, message: 'El proveedor de IA falló.' },
  STORAGE_ERROR: { status: 502, message: 'No pudimos acceder al almacenamiento.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'El servicio está saturado. Inténtalo en unos segundos.' },
  COLLAB_UNAVAILABLE: { status: 503, message: 'No se pudo completar ahora. Inténtalo en un momento.' },
  AI_BUSY: { status: 503, message: 'La IA está ocupada. Inténtalo en un momento.' },
  AI_JOB_LOST: { status: 503, message: 'La generación se interrumpió. Inténtalo de nuevo.' },
  AI_PROVIDER_BUSY: { status: 503, message: 'El proveedor de IA está saturado.' },
  AI_TIMEOUT: { status: 504, message: 'La IA tardó demasiado en responder.' },
} as const satisfies Record<ErrorCode, { status: number; message: string }>;

export type { ErrorCode };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      details?: Record<string, unknown>;
      headers?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_CATALOG[code].message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_CATALOG[code].status;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
