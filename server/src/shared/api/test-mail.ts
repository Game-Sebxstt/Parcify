import { z } from 'zod';

export const TestMailQuerySchema = z.object({ to: z.email().max(254) });

export const TestMailResponseSchema = z.object({
  messages: z.array(
    z.object({
      to: z.string(),
      subject: z.string(),
      text: z.string(),
      html: z.string(),
      sentAt: z.string(),
    }),
  ),
});
