import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { requestIp } from "../lib/audit.js";
import { requireOperator } from "../middleware/auth.js";
import { issueFirstCard, startMembershipCheckout } from "../services/billing.js";
import { buildReceipt, closeSession, quoteClose } from "../services/charge.js";
import { getFloor, todaysBookings } from "../services/floor.js";
import { findMemberByQr, getMember, getReferral, searchMembers } from "../services/lookup.js";
import { shiftReport } from "../services/shift-report.js";
import { loadSettings, wallTime } from "../services/venue.js";
import { validate } from "../validate.js";

/**
 * POS operations, mounted inside posRoutes (which already requires the staff device session).
 * Every route here also needs a PIN-verified operator.
 */
export const posOpsRoutes = new Hono<AppEnv>();
posOpsRoutes.use("*", requireOperator());

const Id = z.object({ id: z.uuid() });
const Cents = z.number().int().min(0).max(10_000_000);

// ── Config & floor ───────────────────────────────────────────────────────────
posOpsRoutes.get("/config", async (c) => {
  const { db } = c.get("deps");
  const [settings, types, hours, hhs, tiers, bands] = await Promise.all([
    loadSettings(db),
    db.from("resource_types").select("id, key, name, base_rate_cents, min_minutes, sort").eq("active", true).order("sort"),
    db.from("opening_hours").select("*").order("day_of_week"),
    db.from("happy_hours").select("*").eq("active", true),
    db.from("membership_tiers").select("id, name, discount_bp, monthly_free_minutes, monthly_price_cents, stripe_price_id").eq("active", true).order("sort"),
    db.from("rate_bands").select("*").eq("active", true),
  ]);
  for (const r of [types, hours, hhs, tiers, bands]) if (r.error) throw mapDbError(r.error);
  return c.json({
    timeZone: settings.timezone,
    businessName: settings.business_name ?? "Raceground",
    noShowHoldMinutes: settings.no_show_hold_minutes,
    resourceTypes: types.data,
    openingHours: hours.data!.map((h) => ({ ...h, open_time: wallTime(h.open_time), close_time: wallTime(h.close_time) })),
    happyHours: hhs.data!.map((h) => ({ ...h, start_time: wallTime(h.start_time), end_time: wallTime(h.end_time) })),
    // sellable: has a Stripe price, so it can be sold at the counter.
    tiers: tiers.data!.map(({ stripe_price_id, ...t }) => ({ ...t, sellable: stripe_price_id !== null })),
    rateBands: bands.data!.map((b) => ({ ...b, start_time: wallTime(b.start_time), end_time: wallTime(b.end_time) })),
  });
});

posOpsRoutes.get("/floor", async (c) => c.json(await getFloor(c.get("deps"))));

posOpsRoutes.get("/bookings/today", validate("query", z.object({ q: z.string().max(100).optional() })), async (c) => {
  return c.json({ bookings: await todaysBookings(c.get("deps"), c.req.valid("query").q) });
});

// ── Shifts ───────────────────────────────────────────────────────────────────
posOpsRoutes.get("/shifts/current", async (c) => {
  const { db } = c.get("deps");
  const { data, error } = await db.from("shifts").select("id").is("closed_at", null).maybeSingle();
  if (error) throw mapDbError(error);
  return c.json({ shift: data ? await shiftReport(db, data.id) : null });
});

posOpsRoutes.post("/shifts/open", validate("json", z.object({ openingFloatCents: Cents })), async (c) => {
  const { db } = c.get("deps");
  const { data, error } = await db.rpc("pos_open_shift", {
    p_staff: c.get("operator").id,
    p_opening_float_cents: c.req.valid("json").openingFloatCents,
  });
  if (error) throw mapDbError(error);
  return c.json({ shift: await shiftReport(db, data.id) }, 201);
});

posOpsRoutes.post(
  "/shifts/current/movements",
  validate("json", z.object({ kind: z.enum(["paid_in", "paid_out"]), amountCents: Cents.min(1), reason: z.string().trim().min(1).max(200) })),
  async (c) => {
    const { db } = c.get("deps");
    const body = c.req.valid("json");
    const { data, error } = await db.rpc("pos_cash_movement", {
      p_staff: c.get("operator").id,
      p_kind: body.kind,
      p_amount_cents: body.amountCents,
      p_reason: body.reason,
    });
    if (error) throw mapDbError(error);
    return c.json({ movement: data }, 201);
  },
);

posOpsRoutes.post(
  "/shifts/current/close",
  validate("json", z.object({ countedCashCents: Cents, terminalCardTotalCents: Cents })),
  async (c) => {
    const { db } = c.get("deps");
    const body = c.req.valid("json");
    const { data, error } = await db.rpc("pos_close_shift", {
      p_staff: c.get("operator").id,
      p_counted_cash_cents: body.countedCashCents,
      p_terminal_card_total_cents: body.terminalCardTotalCents,
    });
    if (error) throw mapDbError(error);
    return c.json({ report: await shiftReport(db, data.id) });
  },
);

posOpsRoutes.get("/shifts/:id/report", validate("param", Id), async (c) => {
  return c.json({ report: await shiftReport(c.get("deps").db, c.req.valid("param").id) });
});

// ── Lookups ──────────────────────────────────────────────────────────────────
posOpsRoutes.post("/members/scan", validate("json", z.object({ code: z.string().max(200) })), async (c) => {
  return c.json({ member: await findMemberByQr(c.get("deps").db, c.req.valid("json").code) });
});

posOpsRoutes.get("/members/search", validate("query", z.object({ q: z.string().max(100) })), async (c) => {
  return c.json({ members: await searchMembers(c.get("deps").db, c.req.valid("query").q) });
});

posOpsRoutes.get("/referrals/:code", validate("param", z.object({ code: z.string().max(40) })), async (c) => {
  const { db, clock } = c.get("deps");
  return c.json({ referral: await getReferral(db, c.req.valid("param").code, clock.now()) });
});

// ── Sessions ─────────────────────────────────────────────────────────────────
posOpsRoutes.post("/sessions", validate("json", z.object({ resourceId: z.uuid() })), async (c) => {
  const deps = c.get("deps");
  const { data, error } = await deps.db.rpc("pos_open_walk_in", {
    p_resource: c.req.valid("json").resourceId,
    p_staff: c.get("operator").id,
    p_now: deps.clock.now().toISOString(),
  });
  if (error) throw mapDbError(error);
  const floor = await getFloor(deps);
  const tile = floor.tiles.find((t) => t.resourceId === data.resource_id);
  return c.json(
    {
      session: data,
      nextBooking: tile?.nextBooking ?? null,
      warning:
        tile?.minutesToNextBooking !== null && tile?.minutesToNextBooking !== undefined && tile.minutesToNextBooking <= 60
          ? `Booked from ${tile.nextBooking!.startsAt} — free for ${tile.minutesToNextBooking} min`
          : null,
    },
    201,
  );
});

const ChargeBody = z.object({
  memberId: z.uuid().optional(),
  referralCode: z.string().max(40).optional(),
  freeMinutes: z.number().int().min(0).max(24 * 60).optional(),
});

posOpsRoutes.post("/sessions/:id/quote", validate("param", Id), validate("json", ChargeBody), async (c) => {
  return c.json({ quote: await quoteClose(c.get("deps"), c.req.valid("param").id, c.req.valid("json")) });
});

const CloseBody = ChargeBody.extend({
  closedAt: z.iso.datetime({ offset: true }),
  expectedTotalCents: Cents.optional(),
  tender: z.discriminatedUnion("method", [
    z.object({ method: z.literal("cash"), tenderedCents: Cents }),
    z.object({ method: z.literal("card_terminal"), externalRef: z.string().trim().max(60).optional() }),
    z.object({ method: z.literal("free") }),
  ]),
  override: z
    .object({
      totalCents: Cents,
      reason: z.string().trim().min(3).max(300),
      approver: z.object({ staffId: z.uuid(), pin: z.string().regex(/^\d{4}$/) }).optional(),
    })
    .optional(),
});

posOpsRoutes.post("/sessions/:id/close", validate("param", Id), validate("json", CloseBody), async (c) => {
  const { result, receipt } = await closeSession(c.get("deps"), c.get("operator"), c.req.valid("param").id, c.req.valid("json"), requestIp(c));
  return c.json({ changeCents: result.changeCents, receipt });
});

posOpsRoutes.get("/sessions/:id/receipt", validate("param", Id), async (c) => {
  return c.json({ receipt: await buildReceipt(c.get("deps"), c.req.valid("param").id) });
});

posOpsRoutes.post(
  "/sessions/:id/void",
  requireOperator("superadmin"),
  validate("param", Id),
  validate("json", z.object({ reason: z.string().trim().min(3).max(300) })),
  async (c) => {
    const deps = c.get("deps");
    const { data, error } = await deps.db.rpc("pos_void_session", {
      p_session: c.req.valid("param").id,
      p_staff: c.get("operator").id,
      p_reason: c.req.valid("json").reason,
      p_now: deps.clock.now().toISOString(),
    });
    if (error) throw mapDbError(error);
    return c.json({ result: data });
  },
);

// ── Bookings ─────────────────────────────────────────────────────────────────
posOpsRoutes.post("/bookings/:id/arrive", validate("param", Id), async (c) => {
  const deps = c.get("deps");
  const { data, error } = await deps.db.rpc("pos_arrive_booking", {
    p_booking: c.req.valid("param").id,
    p_staff: c.get("operator").id,
    p_now: deps.clock.now().toISOString(),
  });
  if (error) throw mapDbError(error);
  return c.json({ session: data }, 201);
});

posOpsRoutes.post("/bookings/:id/no-show", validate("param", Id), async (c) => {
  const deps = c.get("deps");
  const { data, error } = await deps.db.rpc("pos_mark_no_show", {
    p_booking: c.req.valid("param").id,
    p_staff: c.get("operator").id,
    p_now: deps.clock.now().toISOString(),
  });
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(500, "internal", "No-show failed");
  return c.json({ booking: { id: data.id, status: data.status } });
});

// ── Memberships at the counter ───────────────────────────────────────────────
posOpsRoutes.post(
  "/memberships/checkout",
  validate("json", z.object({ name: z.string().trim().min(1).max(80), email: z.email(), phone: z.string().trim().max(20).optional(), tierId: z.uuid() })),
  async (c) => {
    const result = await startMembershipCheckout(c.get("deps"), c.get("operator"), c.req.valid("json"));
    return c.json(result, 201);
  },
);

posOpsRoutes.get("/memberships/:id", validate("param", Id), async (c) => {
  const { db } = c.get("deps");
  const member = await getMember(db, c.req.valid("param").id);
  const { data, error } = await db.from("members").select("qr_token_hash, current_period_end").eq("id", member.id).single();
  if (error) throw mapDbError(error);
  return c.json({ member, hasCard: data.qr_token_hash !== null, currentPeriodEnd: data.current_period_end });
});

posOpsRoutes.post("/memberships/:id/card", validate("param", Id), async (c) => {
  return c.json(await issueFirstCard(c.get("deps"), c.get("operator"), c.req.valid("param").id), 201);
});
