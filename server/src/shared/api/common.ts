import { z } from 'zod';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !CONTROL_CHARS.test(value), { message: 'no puede contener caracteres de control' });

export const UuidSchema = z.uuid();
export const AuthIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const SlugSchema = z.string().regex(/^[a-z0-9-]{1,48}$/);
export const EmailSchema = z.email().max(254).transform((value) => value.toLowerCase());
export const IsoDateSchema = z.iso.datetime({ offset: true });

export const ListQuerySchema = z.object({
  cursor: UuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: UuidSchema.nullable() });
}

export const OkSchema = z.object({ ok: z.literal(true) });
