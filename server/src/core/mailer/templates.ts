export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'propietario',
  admin: 'administrador',
  member: 'miembro',
  editor: 'editor',
  viewer: 'lector',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

type Block = { kind: 'p'; text: string } | { kind: 'code'; code: string } | { kind: 'button'; label: string; url: string };

function layout(title: string, blocks: Block[]): { html: string; text: string } {
  const body = blocks
    .map((block) => {
      switch (block.kind) {
        case 'p':
          return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#2b2b30">${escapeHtml(block.text)}</p>`;
        case 'code':
          return `<p style="margin:8px 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;color:#141416;font-family:'SFMono-Regular',Consolas,monospace">${escapeHtml(block.code)}</p>`;
        case 'button':
          return `<p style="margin:8px 0 24px"><a href="${escapeHtml(block.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#ff6b4a;color:#ffffff;font-weight:600;text-decoration:none">${escapeHtml(block.label)}</a></p>`;
      }
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:Manrope,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-size:18px;font-weight:800;color:#141416">Parcify</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#141416">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0 0;font-size:12px;color:#6b6b73">Si no esperabas este correo, puedes ignorarlo.</p>
</td></tr></table>
</td></tr></table>
</body>
</html>`;

  const text = [
    'Parcify',
    '',
    title,
    '',
    ...blocks.map((block) => {
      switch (block.kind) {
        case 'p':
          return block.text;
        case 'code':
          return `    ${block.code}`;
        case 'button':
          return `${block.label}: ${block.url}`;
      }
    }),
    '',
    'Si no esperabas este correo, puedes ignorarlo.',
  ].join('\n');

  return { html, text };
}

export function verificationCode(input: { code: string; minutes: number }): RenderedMail {
  const title = 'Tu código de verificación';
  return {
    subject: `${input.code} es tu código de Parcify`,
    ...layout(title, [
      { kind: 'p', text: 'Escribe este código en Parcify para verificar tu email:' },
      { kind: 'code', code: input.code },
      { kind: 'p', text: `Caduca en ${input.minutes} minutos. No lo compartas con nadie.` },
    ]),
  };
}

export function passwordResetCode(input: { code: string; minutes: number }): RenderedMail {
  const title = 'Restablece tu contraseña';
  return {
    subject: 'Código para restablecer tu contraseña de Parcify',
    ...layout(title, [
      { kind: 'p', text: 'Alguien pidió restablecer la contraseña de tu cuenta. Usa este código para elegir una nueva:' },
      { kind: 'code', code: input.code },
      {
        kind: 'p',
        text: `Caduca en ${input.minutes} minutos. Si no fuiste tú, ignora este correo: tu contraseña sigue igual.`,
      },
    ]),
  };
}

export function emailChangeCode(input: { code: string; minutes: number }): RenderedMail {
  const title = 'Confirma tu nuevo email';
  return {
    subject: `${input.code} es tu código para cambiar el email en Parcify`,
    ...layout(title, [
      { kind: 'p', text: 'Escribe este código en los ajustes de tu cuenta de Parcify para usar esta dirección:' },
      { kind: 'code', code: input.code },
      { kind: 'p', text: `Caduca en ${input.minutes} minutos. No lo compartas con nadie.` },
    ]),
  };
}

export function emailChangeNotice(input: { newEmail: string }): RenderedMail {
  const title = 'Se pidió cambiar el email de tu cuenta';
  return {
    subject: 'Cambio de email en tu cuenta de Parcify',
    ...layout(title, [
      { kind: 'p', text: `Se pidió cambiar el email de tu cuenta de Parcify a ${input.newEmail}.` },
      {
        kind: 'p',
        text: 'El cambio solo se aplica cuando se verifica la nueva dirección. Si no fuiste tú, cambia tu contraseña y cierra las demás sesiones desde los ajustes de tu cuenta.',
      },
    ]),
  };
}

export function workspaceInvitation(input: {
  inviterName: string;
  workspaceName: string;
  role: string;
  url: string;
  expiresInDays: number;
}): RenderedMail {
  const title = `Te invitaron a ${input.workspaceName}`;
  return {
    subject: `${input.inviterName} te invitó a ${input.workspaceName} en Parcify`,
    ...layout(title, [
      {
        kind: 'p',
        text: `${input.inviterName} te invitó a unirte al espacio ${input.workspaceName} como ${roleLabel(input.role)}.`,
      },
      { kind: 'button', label: 'Ver la invitación', url: input.url },
      { kind: 'p', text: `La invitación caduca en ${input.expiresInDays} días.` },
    ]),
  };
}

export function projectInvitation(input: {
  inviterName: string;
  projectName: string;
  role: string;
  url: string;
  expiresInDays: number;
}): RenderedMail {
  const title = `Te invitaron a ${input.projectName}`;
  return {
    subject: `${input.inviterName} te invitó al proyecto ${input.projectName}`,
    ...layout(title, [
      {
        kind: 'p',
        text: `${input.inviterName} te invitó al proyecto ${input.projectName} de Parcify como ${roleLabel(input.role)}.`,
      },
      { kind: 'button', label: 'Abrir la invitación', url: input.url },
      { kind: 'p', text: `La invitación caduca en ${input.expiresInDays} días.` },
    ]),
  };
}
