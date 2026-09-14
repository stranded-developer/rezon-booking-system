import {
  validateHappyHours,
  validateRateBands,
  validateTier,
  type HappyHour,
  type IsoDayOfWeek,
  type RateBand,
  type ValidationIssue,
} from "@raceground/pricing";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { auditHeaders } from "../lib/audit-headers.js";
import { wallTime } from "../services/venue.js";
import { validate } from "../validate.js";

/** Venue configuration. Mounted inside adminRoutes (superadmin operator already required). */
export const adminConfigRoutes = new Hono<AppEnv>();

const Id = z.object({ id: z.uuid() });
const Reason = z.string().trim().max(300).optional();
const WallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM");
const Days = z.array(z.number().int().min(1).max(7)).min(1).max(7);
const Cents = z.number().int().min(0).max(10_000_000);

function rejectIssues(issues: ValidationIssue[]) {
  if (issues.length > 0) throw new ApiError(422, "validation_failed", issues[0]!.message, issues);
}

// ── Settings ─────────────────────────────────────────────────────────────────
adminConfigRoutes.get("/settings", async (c) => {
  const { data, error } = await c.get("deps").db.from("venue_settings").select("*").eq("id", 1).single();
  if (error) throw mapDbError(error);
  return c.json({ settings: data });
});

const SettingsBody = z
  .object({
    businessName: z.string().trim().min(1).max(120).nullable().optional(),
    abn: z
      .string()
      .transform((v) => v.replace(/\s/g, ""))
      .pipe(z.string().regex(/^\d{11}$/, "ABN must be 11 digits"))
      .nullable()
      .optional(),
    bookingWindowDays: z.number().int().min(0).max(60).optional(),
    onlineCutoffMinutes: z.number().int().min(0).max(1440).optional(),
    noShowHoldMinutes: z.number().int().min(0).max(120).optional(),
    walkinLastOpenMinutes: z.number().int().min(0).max(240).optional(),
    cashVarianceThresholdCents: Cents.optional(),
    balanceForfeitDays: z.number().int().min(0).max(365).optional(),
    reason: Reason,
  })
  .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update");

adminConfigRoutes.patch("/settings", validate("json", SettingsBody), async (c) => {
  const { reason, ...b } = c.req.valid("json");
  const patch = {
    ...(b.businessName !== undefined ? { business_name: b.businessName } : {}),
    ...(b.abn !== undefined ? { abn: b.abn } : {}),
    ...(b.bookingWindowDays !== undefined ? { booking_window_days: b.bookingWindowDays } : {}),
    ...(b.onlineCutoffMinutes !== undefined ? { online_cutoff_minutes: b.onlineCutoffMinutes } : {}),
    ...(b.noShowHoldMinutes !== undefined ? { no_show_hold_minutes: b.noShowHoldMinutes } : {}),
    ...(b.walkinLastOpenMinutes !== undefined ? { walkin_last_open_minutes: b.walkinLastOpenMinutes } : {}),
    ...(b.cashVarianceThresholdCents !== undefined ? { cash_variance_threshold_cents: b.cashVarianceThresholdCents } : {}),
    ...(b.balanceForfeitDays !== undefined ? { balance_forfeit_days: b.balanceForfeitDays } : {}),
  };
  const { data, error } = await auditHeaders(c.get("deps").db.from("venue_settings").update(patch).eq("id", 1), c.get("operator").id, reason)
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ settings: data });
});

// ── Opening hours ────────────────────────────────────────────────────────────
adminConfigRoutes.get("/opening-hours", async (c) => {
  const { data, error } = await c.get("deps").db.from("opening_hours").select("*").order("day_of_week");
  if (error) throw mapDbError(error);
  return c.json({ days: data.map((d) => ({ ...d, open_time: wallTime(d.open_time), close_time: wallTime(d.close_time) })) });
});

const HoursBody = z.object({
  days: z
    .array(z.object({ dayOfWeek: z.number().int().min(1).max(7), openTime: WallTime, closeTime: WallTime, closed: z.boolean() }))
    .length(7)
    .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, "Give each day once")
    .refine((days) => days.every((d) => d.closeTime > d.openTime), "Closing time must be after opening time"),
  reason: Reason,
});

adminConfigRoutes.put("/opening-hours", validate("json", HoursBody), async (c) => {
  const { days, reason } = c.req.valid("json");
  const rows = days.map((d) => ({ day_of_week: d.dayOfWeek, open_time: d.openTime, close_time: d.closeTime, closed: d.closed }));
  const { data, error } = await auditHeaders(c.get("deps").db.from("opening_hours").upsert(rows, { onConflict: "day_of_week" }), c.get("operator").id, reason)
    .select("*")
    .order("day_of_week");
  if (error) throw mapDbError(error);
  return c.json({ days: data.map((d) => ({ ...d, open_time: wallTime(d.open_time), close_time: wallTime(d.close_time) })) });
});

// ── Resource types and resources ─────────────────────────────────────────────
adminConfigRoutes.get("/resource-types", async (c) => {
  const { data, error } = await c.get("deps").db.from("resource_types").select("*, resources(id, label, sort, active)").order("sort");
  if (error) throw mapDbError(error);
  return c.json({ resourceTypes: data });
});

adminConfigRoutes.post(
  "/resource-types",
  validate(
    "json",
    z.object({
      key: z.string().regex(/^[a-z0-9_]{2,30}$/, "Lowercase letters, digits and underscores"),
      name: z.string().trim().min(1).max(60),
      baseRateCents: Cents,
      minMinutes: z.number().int().min(1).max(240),
      sort: z.number().int().optional(),
      reason: Reason,
    }),
  ),
  async (c) => {
    const b = c.req.valid("json");
    const { data, error } = await auditHeaders(
      c.get("deps").db.from("resource_types").insert({ key: b.key, name: b.name, base_rate_cents: b.baseRateCents, min_minutes: b.minMinutes, sort: b.sort ?? 100 }),
      c.get("operator").id,
      b.reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ resourceType: data }, 201);
  },
);

adminConfigRoutes.patch(
  "/resource-types/:id",
  validate("param", Id),
  validate(
    "json",
    z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        baseRateCents: Cents.optional(),
        minMinutes: z.number().int().min(1).max(240).optional(),
        sort: z.number().int().optional(),
        active: z.boolean().optional(),
        reason: Reason,
      })
      .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update"),
  ),
  async (c) => {
    const { reason, ...b } = c.req.valid("json");
    const { id } = c.req.valid("param");
    if (b.active === false) await assertNoOpenWork(c.get("deps").db, { resourceTypeId: id });
    const patch = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.baseRateCents !== undefined ? { base_rate_cents: b.baseRateCents } : {}),
      ...(b.minMinutes !== undefined ? { min_minutes: b.minMinutes } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    const { data, error } = await auditHeaders(c.get("deps").db.from("resource_types").update(patch).eq("id", id), c.get("operator").id, reason)
      .select("*")
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new ApiError(404, "not_found", "Resource type not found");
    return c.json({ resourceType: data });
  },
);

adminConfigRoutes.post(
  "/resources",
  validate("json", z.object({ resourceTypeId: z.uuid(), label: z.string().trim().min(1).max(40), sort: z.number().int().optional(), reason: Reason })),
  async (c) => {
    const b = c.req.valid("json");
    const { data, error } = await auditHeaders(
      c.get("deps").db.from("resources").insert({ resource_type_id: b.resourceTypeId, label: b.label, sort: b.sort ?? 100 }),
      c.get("operator").id,
      b.reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ resource: data }, 201);
  },
);

adminConfigRoutes.patch(
  "/resources/:id",
  validate("param", Id),
  validate(
    "json",
    z
      .object({ label: z.string().trim().min(1).max(40).optional(), sort: z.number().int().optional(), active: z.boolean().optional(), reason: Reason })
      .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update"),
  ),
  async (c) => {
    const { reason, ...b } = c.req.valid("json");
    const { id } = c.req.valid("param");
    if (b.active === false) await assertNoOpenWork(c.get("deps").db, { resourceId: id });
    const patch = {
      ...(b.label !== undefined ? { label: b.label } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    const { data, error } = await auditHeaders(c.get("deps").db.from("resources").update(patch).eq("id", id), c.get("operator").id, reason)
      .select("*")
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new ApiError(404, "not_found", "Resource not found");
    return c.json({ resource: data });
  },
);

/** A resource (or every resource of a type) can't be retired while it is in use or has bookings ahead. */
async function assertNoOpenWork(db: AppEnv["Variables"]["deps"]["db"], scope: { resourceId?: string; resourceTypeId?: string }) {
  let ids = scope.resourceId ? [scope.resourceId] : [];
  if (scope.resourceTypeId) {
    const { data, error } = await db.from("resources").select("id").eq("resource_type_id", scope.resourceTypeId);
    if (error) throw mapDbError(error);
    ids = data.map((r) => r.id);
  }
  if (ids.length === 0) return;
  const [open, future] = await Promise.all([
    db.from("sessions").select("id", { count: "exact", head: true }).in("resource_id", ids).eq("status", "open"),
    db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("resource_id", ids)
      .in("status", ["held", "confirmed", "arrived"])
      .overlaps("period", `[${new Date().toISOString()},infinity)`),
  ]);
  if (open.error) throw mapDbError(open.error);
  if (future.error) throw mapDbError(future.error);
  if ((open.count ?? 0) > 0) throw new ApiError(409, "resource_in_use", "Close the open session before deactivating");
  if ((future.count ?? 0) > 0) throw new ApiError(409, "has_bookings", "There are upcoming bookings; cancel or move them first");
}

// ── Rate bands ───────────────────────────────────────────────────────────────
type BandRow = { id: string; resource_type_id: string; days_of_week: number[]; start_time: string; end_time: string; rate_cents: number; active: boolean };
const toBand = (b: BandRow): RateBand => ({
  id: b.id,
  resourceTypeId: b.resource_type_id,
  daysOfWeek: b.days_of_week as IsoDayOfWeek[],
  startTime: wallTime(b.start_time),
  endTime: wallTime(b.end_time),
  rateCents: b.rate_cents,
});

async function assertBandsValid(db: AppEnv["Variables"]["deps"]["db"], candidate: RateBand | null, excludeId?: string) {
  const { data, error } = await db.from("rate_bands").select("*").eq("active", true);
  if (error) throw mapDbError(error);
  const others = data.filter((b) => b.id !== excludeId && b.id !== candidate?.id).map(toBand);
  rejectIssues(validateRateBands(candidate ? [...others, candidate] : others));
}

adminConfigRoutes.get("/rate-bands", async (c) => {
  const { data, error } = await c.get("deps").db.from("rate_bands").select("*").order("created_at");
  if (error) throw mapDbError(error);
  return c.json({ rateBands: data.map((b) => ({ ...b, start_time: wallTime(b.start_time), end_time: wallTime(b.end_time) })) });
});

const BandBody = z.object({ resourceTypeId: z.uuid(), daysOfWeek: Days, startTime: WallTime, endTime: WallTime, rateCents: Cents, reason: Reason });

adminConfigRoutes.post("/rate-bands", validate("json", BandBody), async (c) => {
  const b = c.req.valid("json");
  const { db } = c.get("deps");
  await assertBandsValid(db, { id: "new", resourceTypeId: b.resourceTypeId, daysOfWeek: b.daysOfWeek as IsoDayOfWeek[], startTime: b.startTime, endTime: b.endTime, rateCents: b.rateCents });
  const { data, error } = await auditHeaders(
    db.from("rate_bands").insert({
      resource_type_id: b.resourceTypeId,
      days_of_week: b.daysOfWeek,
      start_time: b.startTime,
      end_time: b.endTime,
      rate_cents: b.rateCents,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ rateBand: data }, 201);
});

adminConfigRoutes.patch(
  "/rate-bands/:id",
  validate("param", Id),
  validate("json", BandBody.partial().extend({ active: z.boolean().optional(), reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("rate_bands").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Rate band not found");
    const next: BandRow = {
      ...current,
      ...(b.resourceTypeId !== undefined ? { resource_type_id: b.resourceTypeId } : {}),
      ...(b.daysOfWeek !== undefined ? { days_of_week: b.daysOfWeek } : {}),
      ...(b.startTime !== undefined ? { start_time: b.startTime } : {}),
      ...(b.endTime !== undefined ? { end_time: b.endTime } : {}),
      ...(b.rateCents !== undefined ? { rate_cents: b.rateCents } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    await assertBandsValid(db, next.active ? toBand(next) : null, id);
    const { data, error } = await auditHeaders(
      db
        .from("rate_bands")
        .update({
          resource_type_id: next.resource_type_id,
          days_of_week: next.days_of_week,
          start_time: next.start_time,
          end_time: next.end_time,
          rate_cents: next.rate_cents,
          active: next.active,
        })
        .eq("id", id),
      c.get("operator").id,
      reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ rateBand: data });
  },
);

adminConfigRoutes.delete("/rate-bands/:id", validate("param", Id), validate("query", z.object({ reason: Reason })), async (c) => {
  const { data, error } = await auditHeaders(c.get("deps").db.from("rate_bands").delete().eq("id", c.req.valid("param").id), c.get("operator").id, c.req.valid("query").reason)
    .select("id");
  if (error) throw mapDbError(error);
  if (data.length === 0) throw new ApiError(404, "not_found", "Rate band not found");
  return c.json({ deleted: true });
});

// ── Happy hours ──────────────────────────────────────────────────────────────
type HhRow = {
  id: string;
  name: string;
  resource_type_ids: string[] | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  discount_bp: number;
  active: boolean;
};
const toHh = (h: HhRow): HappyHour => ({
  id: h.id,
  name: h.name,
  resourceTypeIds: h.resource_type_ids,
  daysOfWeek: h.days_of_week as IsoDayOfWeek[],
  startTime: wallTime(h.start_time),
  endTime: wallTime(h.end_time),
  discountBp: h.discount_bp,
});

async function assertHappyHoursValid(db: AppEnv["Variables"]["deps"]["db"], candidate: HappyHour | null, excludeId?: string) {
  const { data, error } = await db.from("happy_hours").select("*").eq("active", true);
  if (error) throw mapDbError(error);
  const others = data.filter((h) => h.id !== excludeId && h.id !== candidate?.id).map(toHh);
  rejectIssues(validateHappyHours(candidate ? [...others, candidate] : others));
}

adminConfigRoutes.get("/happy-hours", async (c) => {
  const { data, error } = await c.get("deps").db.from("happy_hours").select("*").order("created_at");
  if (error) throw mapDbError(error);
  return c.json({ happyHours: data.map((h) => ({ ...h, start_time: wallTime(h.start_time), end_time: wallTime(h.end_time) })) });
});

const HhBody = z.object({
  name: z.string().trim().min(1).max(60),
  resourceTypeIds: z.array(z.uuid()).min(1).nullable(),
  daysOfWeek: Days,
  startTime: WallTime,
  endTime: WallTime,
  discountBp: z.number().int().min(1).max(9999),
  reason: Reason,
});

adminConfigRoutes.post("/happy-hours", validate("json", HhBody), async (c) => {
  const b = c.req.valid("json");
  const { db } = c.get("deps");
  await assertHappyHoursValid(db, {
    id: "new",
    name: b.name,
    resourceTypeIds: b.resourceTypeIds,
    daysOfWeek: b.daysOfWeek as IsoDayOfWeek[],
    startTime: b.startTime,
    endTime: b.endTime,
    discountBp: b.discountBp,
  });
  const { data, error } = await auditHeaders(
    db.from("happy_hours").insert({
      name: b.name,
      resource_type_ids: b.resourceTypeIds,
      days_of_week: b.daysOfWeek,
      start_time: b.startTime,
      end_time: b.endTime,
      discount_bp: b.discountBp,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ happyHour: data }, 201);
});

adminConfigRoutes.patch(
  "/happy-hours/:id",
  validate("param", Id),
  validate("json", HhBody.partial().extend({ active: z.boolean().optional(), reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("happy_hours").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Happy hour not found");
    const next: HhRow = {
      ...current,
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.resourceTypeIds !== undefined ? { resource_type_ids: b.resourceTypeIds } : {}),
      ...(b.daysOfWeek !== undefined ? { days_of_week: b.daysOfWeek } : {}),
      ...(b.startTime !== undefined ? { start_time: b.startTime } : {}),
      ...(b.endTime !== undefined ? { end_time: b.endTime } : {}),
      ...(b.discountBp !== undefined ? { discount_bp: b.discountBp } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    await assertHappyHoursValid(db, next.active ? toHh(next) : null, id);
    const { data, error } = await auditHeaders(
      db
        .from("happy_hours")
        .update({
          name: next.name,
          resource_type_ids: next.resource_type_ids,
          days_of_week: next.days_of_week,
          start_time: next.start_time,
          end_time: next.end_time,
          discount_bp: next.discount_bp,
          active: next.active,
        })
        .eq("id", id),
      c.get("operator").id,
      reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ happyHour: data });
  },
);

adminConfigRoutes.delete("/happy-hours/:id", validate("param", Id), validate("query", z.object({ reason: Reason })), async (c) => {
  const { data, error } = await auditHeaders(c.get("deps").db.from("happy_hours").delete().eq("id", c.req.valid("param").id), c.get("operator").id, c.req.valid("query").reason)
    .select("id");
  if (error) throw mapDbError(error);
  if (data.length === 0) throw new ApiError(404, "not_found", "Happy hour not found");
  return c.json({ deleted: true });
});

// ── Membership tiers ─────────────────────────────────────────────────────────
adminConfigRoutes.get("/tiers", async (c) => {
  const { db } = c.get("deps");
  const [tiers, members] = await Promise.all([
    db.from("membership_tiers").select("*").order("sort"),
    db.from("members").select("tier_id, status").in("status", ["active", "cancelling", "past_due"]),
  ]);
  if (tiers.error) throw mapDbError(tiers.error);
  if (members.error) throw mapDbError(members.error);
  return c.json({
    tiers: tiers.data.map((t) => ({ ...t, activeMembers: members.data.filter((m) => m.tier_id === t.id).length })),
  });
});

adminConfigRoutes.patch(
  "/tiers/:id",
  validate("param", Id),
  validate(
    "json",
    z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        discountBp: z.number().int().min(0).max(9999).optional(),
        monthlyFreeMinutes: z.number().int().min(0).max(24 * 60).optional(),
        maxBalanceMinutes: z.number().int().min(0).max(100 * 60).optional(),
        active: z.boolean().optional(),
        reason: Reason,
      })
      .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update"),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("membership_tiers").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Tier not found");
    const next = {
      name: b.name ?? current.name,
      discount_bp: b.discountBp ?? current.discount_bp,
      monthly_free_minutes: b.monthlyFreeMinutes ?? current.monthly_free_minutes,
      max_balance_minutes: b.maxBalanceMinutes ?? current.max_balance_minutes,
      active: b.active ?? current.active,
    };
    rejectIssues(
      validateTier({
        name: next.name,
        discountBp: next.discount_bp,
        monthlyPriceCents: current.monthly_price_cents,
        monthlyFreeMinutes: next.monthly_free_minutes,
        maxBalanceMinutes: next.max_balance_minutes,
      }),
    );
    const { data, error } = await auditHeaders(db.from("membership_tiers").update(next).eq("id", id), c.get("operator").id, reason)
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ tier: data });
  },
);

adminConfigRoutes.post(
  "/tiers/:id/price",
  validate("param", Id),
  validate("json", z.object({ amountCents: Cents, reason: Reason })),
  async (c) => {
    const { db } = c.get("deps");
    const { amountCents, reason } = c.req.valid("json");
    const { data, error } = await auditHeaders(
      db.rpc("admin_set_tier_price", { p_tier: c.req.valid("param").id, p_staff: c.get("operator").id, p_amount_cents: amountCents, p_reason: reason ?? "" }),
      c.get("operator").id,
      reason,
    );
    if (error) throw mapDbError(error);
    // Stripe price sync and member price-change emails are added with Stripe Billing (Phase 5).
    return c.json({ tier: data, stripeSyncPending: true });
  },
);
