import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { requestIp, writeAudit } from "../lib/audit.js";
import { signOperatorToken } from "../lib/operator-token.js";
import { PIN_PATTERN, verifyPin } from "../lib/pin.js";
import { OPERATOR_HEADER, requireOperator, requireStaffDevice } from "../middleware/auth.js";
import { validate } from "../validate.js";

export const posRoutes = new Hono<AppEnv>();

posRoutes.use("*", requireStaffDevice);

/** Lock screen: active staff names to tap before entering a PIN. */
posRoutes.get("/staff", async (c) => {
  const { db } = c.get("deps");
  const { data, error } = await db
    .from("staff")
    .select("id, display_name, role")
    .eq("active", true)
    .order("display_name");
  if (error) throw mapDbError(error);
  return c.json({ staff: data });
});

const OperatorBody = z.object({
  staffId: z.uuid(),
  pin: z.string().regex(PIN_PATTERN, "PIN must be 4 digits"),
});

/** PIN → short-lived operator token bound to this device session. */
posRoutes.post("/operator", validate("json", OperatorBody), async (c) => {
  const { db, env } = c.get("deps");
  const device = c.get("device");
  const { staffId, pin } = c.req.valid("json");

  const { data: staff, error } = await db
    .from("staff")
    .select("id, display_name, role, active, pin_hash, pin_locked_until")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  // Unknown and inactive staff get the same answer as a wrong PIN.
  if (!staff || !staff.active) throw new ApiError(401, "pin_invalid", "Incorrect PIN");

  if (staff.pin_locked_until && new Date(staff.pin_locked_until) > new Date()) {
    throw new ApiError(423, "pin_locked", "Too many attempts. Try again later.", { lockedUntil: staff.pin_locked_until });
  }

  const correct = await verifyPin(pin, staff.pin_hash);
  const { data: attempt, error: attemptError } = await db
    .rpc("register_pin_attempt", {
      p_staff_id: staffId,
      p_success: correct,
      p_max_attempts: env.PIN_MAX_ATTEMPTS,
      p_lock_minutes: env.PIN_LOCK_MINUTES,
    })
    .single();
  if (attemptError || !attempt) throw attemptError ? mapDbError(attemptError) : new ApiError(500, "internal", "PIN check failed");

  if (attempt.just_locked) {
    await writeAudit(db, {
      actorStaffId: device.id,
      action: "staff.pin_locked",
      entity: "staff",
      entityId: staffId,
      after: { locked_until: attempt.locked_until },
      ip: requestIp(c),
    });
  }

  if (!attempt.accepted) {
    if (attempt.locked_until) {
      throw new ApiError(423, "pin_locked", "Too many attempts. Try again later.", { lockedUntil: attempt.locked_until });
    }
    throw new ApiError(401, "pin_invalid", "Incorrect PIN", { attemptsRemaining: env.PIN_MAX_ATTEMPTS - attempt.failed_count });
  }

  await writeAudit(db, {
    actorStaffId: staffId,
    action: "pos.operator_signin",
    entity: "staff",
    entityId: staffId,
    after: { device_staff_id: device.id },
    ip: requestIp(c),
  });

  const token = await signOperatorToken(staffId, device.authUserId, env.OPERATOR_TOKEN_SECRET, env.OPERATOR_IDLE_SECONDS);
  c.header(OPERATOR_HEADER, token);
  return c.json({
    operator: { id: staff.id, displayName: staff.display_name, role: staff.role },
    token,
    expiresInSeconds: env.OPERATOR_IDLE_SECONDS,
  });
});

posRoutes.get("/me", requireOperator(), (c) => {
  const operator = c.get("operator");
  const device = c.get("device");
  return c.json({
    operator: { id: operator.id, displayName: operator.displayName, role: operator.role },
    device: { id: device.id, displayName: device.displayName },
  });
});
