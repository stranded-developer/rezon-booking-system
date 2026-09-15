import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AccountIdentity, AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";

/**
 * Resolves `Authorization: Bearer <Supabase access token>` to a booking-site account.
 * On first use the login is linked to the customer with the same email, but only once Supabase says the
 * email is confirmed; otherwise anyone could register a member's email and take over their membership.
 * Staff logins are refused here: the booking site is for customers.
 */
async function resolveAccount(c: Context<AppEnv>): Promise<AccountIdentity | null> {
  const { db } = c.get("deps");
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;

  const { data, error } = await db.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) throw new ApiError(401, "unauthenticated", "Your session has expired. Please log in again.");

  const { data: linked, error: linkedError } = await db.from("customers").select("id, email").eq("auth_user_id", userId).maybeSingle();
  if (linkedError) throw mapDbError(linkedError);

  // Linked logins were confirmed when they were linked; the admin lookup is only needed the first time.
  if (linked) return { authUserId: userId, email: String(data.claims.email ?? linked.email ?? ""), customerId: linked.id };

  const { data: userData, error: userError } = await db.auth.admin.getUserById(userId);
  if (userError || !userData.user) throw new ApiError(401, "unauthenticated", "Your session has expired. Please log in again.");
  const user = userData.user;
  if (!user.email || !user.email_confirmed_at) {
    throw new ApiError(403, "email_unconfirmed", "Please confirm your email address first. Check your inbox for the link.");
  }

  const { data: staff } = await db.from("staff").select("id").eq("auth_user_id", userId).maybeSingle();
  if (staff) throw new ApiError(403, "staff_account", "Staff logins can't be used on the booking site. Use a personal account.");

  const meta = (user.user_metadata ?? {}) as { name?: unknown; phone?: unknown };
  const { data: customerId, error: rpcError } = await db.rpc("member_link_account", {
    p_auth_user: userId,
    p_email: user.email,
    p_name: typeof meta.name === "string" ? meta.name : "",
    p_phone: typeof meta.phone === "string" ? meta.phone : "",
  });
  if (rpcError) throw mapDbError(rpcError);
  return { authUserId: userId, email: user.email, customerId: customerId as string };
}

/** Account required (member area). */
export const requireAccount = createMiddleware<AppEnv>(async (c, next) => {
  const account = await resolveAccount(c);
  if (!account) throw new ApiError(401, "unauthenticated", "Please log in");
  c.set("account", account);
  await next();
});

/** Guests allowed; a signed-in customer is recognised (member discount on quotes and bookings). */
export const optionalAccount = createMiddleware<AppEnv>(async (c, next) => {
  c.set("account", (await resolveAccount(c)) ?? undefined);
  await next();
});
