// Better Auth compara la ruta exacta y responde 404; las llamadas auth.api.* del servidor no se ven afectadas.
export const DISABLED_AUTH_PATHS = [
  // Acceso por OTP: el producto solo ofrece email y contraseña, y Google.
  // El cambio de email por código (/email-otp/request-email-change y /email-otp/change-email) sí se usa.
  '/sign-in/email-otp',
  // Rutas de OTP que el cliente no usa.
  '/forget-password/email-otp',
  '/email-otp/check-verification-otp',
  // Espacios, miembros e invitaciones solo cambian a través de /v1.
  '/organization/create',
  '/organization/update',
  '/organization/delete',
  '/organization/leave',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/create-role',
  '/organization/update-role',
  '/organization/delete-role',
  // Cualquier miembro vería los emails invitados; /v1 la limita a admins.
  '/organization/list-invitations',
] as const;
