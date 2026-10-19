import { expect, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3000';

type Mail = { to: string; subject: string; text: string; sentAt: string };

// Lee el último código de 6 dígitos enviado a «to» cuyo asunto cumple «subject».
export async function readCode(request: APIRequestContext, to: string, subject: RegExp, after = 0): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${API}/v1/__test/mail`, { params: { to } });
        expect(response.ok()).toBe(true);
        const { messages } = (await response.json()) as { messages: Mail[] };
        const matching = messages.filter((mail) => subject.test(mail.subject));
        const latest = matching.length > after ? matching.at(-1) : undefined;
        code = latest?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
        return code;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return code!;
}

export async function countMails(request: APIRequestContext, to: string, subject: RegExp): Promise<number> {
  const response = await request.get(`${API}/v1/__test/mail`, { params: { to } });
  const { messages } = (await response.json()) as { messages: Mail[] };
  return messages.filter((mail) => subject.test(mail.subject)).length;
}

export const VERIFY_SUBJECT = /es tu código de Parcify/;
export const RESET_SUBJECT = /restablecer tu contraseña/;
