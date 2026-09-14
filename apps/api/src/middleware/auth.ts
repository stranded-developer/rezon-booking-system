import { createMiddleware } from "hono/factory";
import type { AppEnv, StaffIdentity, StaffRole } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { signOperatorToken, verifyOperatorToken } from "../lib/operator-token.js";

export const OPERATOR_HEADER = "X-Operator-Token";

type StaffRow = { id: string; auth_user_id: string; display_name: string; role: string; active: boolean };

function toIdentity(row: StaffRow): StaffIdentity {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    role: row.role as StaffRole,
  };
}

/**
 * Requires `Authorization: Bearer <Supabase access token>` for a user linked to an active staff row.
 * This is the POS device session.
 */
export const requireStaffDevice = createMiddleware<AppEnv>(async (c, next) => {
  const { db } = c.get("deps");
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) throw new ApiError(401, "unauthenticated", "Sign in required");

  const { data, error } = await db.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) throw new ApiError(401, "unauthenticated", "Invalid or expired session");

  const { data: staff, error: dbError } = await db
    .from("staff")
    .select("id, auth_user_id, display_name, role, active")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (dbError) throw mapDbError(dbError);
  if (!staff || !staff.active) throw new ApiError(403, "forbidden", "This account is not active staff");

  c.set("device", toIdentity(staff));
  await next();
});

/**
 * Requires a PIN-verified operator token bound to the current device session.
 * Re-checks the operator's staff row on every request and slides the token expiry (idle lock).
 * Must run after requireStaffDevice.
 */
export function requireOperator(...roles: StaffRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { db, env } = c.get("deps");
    const device = c.get("device");
    const token = c.req.header(OPERATOR_HEADER);
    if (!token) throw new ApiError(401, "operator_required", "Enter your PIN to continue");

    const claims = await verifyOperatorToken(token, env.OPERATOR_TOKEN_SECRET);
    if (!claims || claims.dev !== device.authUserId) {
      throw new ApiError(401, "operator_required", "Operator session expired, enter your PIN again");
    }

    const { data: staff, error } = await db
      .from("staff")
      .select("id, auth_user_id, display_name, role, active")
      .eq("id", claims.sub)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!staff || !staff.active) throw new ApiError(403, "forbidden", "This staff member is not active");

    const operator = toIdentity(staff);
    if (roles.length > 0 && !roles.includes(operator.role)) {
      throw new ApiError(403, "forbidden", "You do not have permission to do that");
    }

    c.set("operator", operator);
    await next();
    c.header(
      OPERATOR_HEADER,
      await signOperatorToken(operator.id, device.authUserId, env.OPERATOR_TOKEN_SECRET, env.OPERATOR_IDLE_SECONDS),
    );
  });
}
