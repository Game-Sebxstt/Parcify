import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { PROJECT_ROLES } from '../shared/permissions.js';

export const COLLAB_TOKEN_TTL_SECONDS = 120;
const ALGORITHM = 'HS256';

const ClaimsSchema = z.object({
  sub: z.string().min(1).max(64),
  pid: z.uuid(),
  role: z.enum(PROJECT_ROLES),
  sid: z.string().min(1).max(64),
  ep: z.number().int().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type CollabTokenClaims = z.infer<typeof ClaimsSchema>;

export type CollabTokenInput = Pick<CollabTokenClaims, 'sub' | 'pid' | 'role' | 'sid' | 'ep'>;

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signCollabToken(
  secret: string,
  input: CollabTokenInput,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({ pid: input.pid, role: input.role, sid: input.sid, ep: input.ep })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(input.sub)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + COLLAB_TOKEN_TTL_SECONDS)
    .sign(keyOf(secret));
}

export type CollabTokenFailure = 'expired' | 'bad_signature' | 'malformed';

export class CollabTokenError extends Error {
  constructor(readonly reason: CollabTokenFailure) {
    super(`Token de colaboración inválido: ${reason}`);
    this.name = 'CollabTokenError';
  }
}

export async function verifyCollabToken(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<CollabTokenClaims> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, keyOf(secret), { algorithms: [ALGORITHM], currentDate: now }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new CollabTokenError('expired');
    if (error instanceof errors.JWSSignatureVerificationFailed) throw new CollabTokenError('bad_signature');
    throw new CollabTokenError('malformed');
  }
  const parsed = ClaimsSchema.safeParse(payload);
  if (!parsed.success) throw new CollabTokenError('malformed');
  return parsed.data;
}
