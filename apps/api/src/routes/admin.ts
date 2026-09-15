import { Hono } from "hono";
import { adminBookingRoutes } from "./admin-bookings.js";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { mapDbError } from "../errors.js";
import { requestIp } from "../lib/audit.js";
import { PIN_PATTERN } from "../lib/pin.js";
import { requireOperator, requireStaffDevice } from "../middleware/auth.js";
import { createStaff, listStaff, updateStaff } from "../services/staff.js";
import { validate } from "../validate.js";
import { adminConfigRoutes } from "./admin-config.js";
import { adminMemberRoutes } from "./admin-members.js";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireStaffDevice, requireOperator("superadmin"));

const Role = z.enum(["superadmin", "cashier"]);
const Pin = z.string().regex(PIN_PATTERN, "PIN must be 4 digits");
const DisplayName = z.string().trim().min(1).max(60);

adminRoutes.get("/staff", async (c) => {
  return c.json({ staff: await listStaff(c.get("deps").db) });
});

const CreateStaffBody = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  displayName: DisplayName,
  role: Role,
  pin: Pin,
});

adminRoutes.post("/staff", validate("json", CreateStaffBody), async (c) => {
  const body = c.req.valid("json");
  const staff = await createStaff(c.get("deps").db, body, {
    actorStaffId: c.get("operator").id,
    ip: requestIp(c),
  });
  return c.json({ staff }, 201);
});

const UpdateStaffBody = z
  .object({
    displayName: DisplayName.optional(),
    role: Role.optional(),
    active: z.boolean().optional(),
    pin: Pin.optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update");

adminRoutes.patch("/staff/:id", validate("param", z.object({ id: z.uuid() })), validate("json", UpdateStaffBody), async (c) => {
  const { id } = c.req.valid("param");
  const { reason, ...changes } = c.req.valid("json");
  const staff = await updateStaff(c.get("deps").db, id, changes, {
    actorStaffId: c.get("operator").id,
    ip: requestIp(c),
    reason: reason ?? null,
  });
  return c.json({ staff });
});

const AuditQuery = z.object({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  actorStaffId: z.uuid().optional(),
  action: z.string().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminRoutes.get("/audit", validate("query", AuditQuery), async (c) => {
  const q = c.req.valid("query");
  let query = c
    .get("deps")
    .db.from("audit_log")
    .select("*, actor:staff!audit_log_actor_staff_id_fkey(display_name), approver:staff!audit_log_approver_staff_id_fkey(display_name)")
    .order("id", { ascending: false })
    .limit(q.limit);
  if (q.entity) query = query.eq("entity", q.entity);
  if (q.entityId) query = query.eq("entity_id", q.entityId);
  if (q.actorStaffId) query = query.eq("actor_staff_id", q.actorStaffId);
  if (q.action) query = query.eq("action", q.action);
  if (q.before) query = query.lt("id", q.before);
  const { data, error } = await query;
  if (error) throw mapDbError(error);
  const last = data.at(-1);
  return c.json({
    entries: data.map((e) => ({
      ...e,
      actor: (e.actor as { display_name: string } | null)?.display_name ?? null,
      approver: (e.approver as { display_name: string } | null)?.display_name ?? null,
    })),
    nextBefore: data.length === q.limit && last ? last.id : null,
  });
});

adminRoutes.route("/", adminConfigRoutes);
adminRoutes.route("/", adminMemberRoutes);
adminRoutes.route("/", adminBookingRoutes);
