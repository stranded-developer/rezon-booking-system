import { sign, verify } from "hono/jwt";

const TYP = "rg-operator";

export interface OperatorClaims {
  /** Operator staff id. */
  sub: string;
  /** Auth user id of the POS device session the token is bound to. */
  dev: string;
  typ: typeof TYP;
  iat: number;
  exp: number;
}

export async function signOperatorToken(
  staffId: string,
  deviceAuthUserId: string,
  secret: string,
  ttlSeconds: number,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const claims: OperatorClaims = { sub: staffId, dev: deviceAuthUserId, typ: TYP, iat: now, exp: now + ttlSeconds };
  return sign({ ...claims }, secret, "HS256");
}

/** Returns claims, or null for any invalid, tampered, expired or foreign token. */
export async function verifyOperatorToken(token: string, secret: string): Promise<OperatorClaims | null> {
  try {
    const payload = await verify(token, secret, "HS256");
    if (
      payload.typ !== TYP ||
      typeof payload.sub !== "string" ||
      typeof payload.dev !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    return payload as unknown as OperatorClaims;
  } catch {
    return null;
  }
}
