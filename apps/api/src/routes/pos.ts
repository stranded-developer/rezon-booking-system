import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { mapDbError } from "../errors.js";
import { requestIp, writeAudit } from "../lib/audit.js";
import { signOperatorToken } from "../lib/operator-token.js";
import { PIN_PATTERN } from "../lib/pin.js";
import { OPERATOR_HEADER, requireOperator, requireStaffDevice } from "../middleware/auth.js";
import { checkStaffPin } from "../services/pin-check.js";
import { validate } from "../validate.js";
import { posOpsRoutes } from "./pos-floor.js";

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

  const staff = await checkStaffPin(db, env, staffId, pin, { actorStaffId: device.id, ip: requestIp(c) });

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
    operator: { id: staff.id, displayName: staff.displayName, role: staff.role },
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

// Operations (config, floor, shifts, sessions, lookups) — operator required.
posRoutes.route("/", posOpsRoutes);
