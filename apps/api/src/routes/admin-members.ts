import { randomBytes } from "node:crypto";
import { addDaysToDate, localToInstant, toLocal } from "@raceground/pricing";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { auditHeaders } from "../lib/audit-headers.js";
import { changeMemberTier, setCancelAtPeriodEnd, syncCatalog } from "../services/billing.js";
import { getMember, hashQrToken } from "../services/lookup.js";
import { loadSettings, parseRange } from "../services/venue.js";
import { validate } from "../validate.js";

/** Members, referral codes, sales/refunds, shifts. Mounted inside adminRoutes (superadmin operator). */
export const adminMemberRoutes = new Hono<AppEnv>();

const Id = z.object({ id: z.uuid() });
const Cents = z.number().int().min(0).max(10_000_000);

/** A new member card: the raw token is returned exactly once for the QR code; only its hash is stored. */
function newCardToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, qr: `rg:m:${token}`, hash: hashQrToken(token) };
}

// ── Members ──────────────────────────────────────────────────────────────────
adminMemberRoutes.get(
  "/members",
  validate("query", z.object({ q: z.string().max(100).optional(), status: z.enum(["pending", "active", "past_due", "cancelling", "ended"]).optional() })),
  async (c) => {
    const { q, status } = c.req.valid("query");
    const { db } = c.get("deps");
    let query = db
      .from("members")
      .select("id, member_no, status, current_period_end, customers!inner(name, email, phone), membership_tiers!members_tier_id_fkey(name)")
      .order("member_no", { ascending: false })
      .limit(100);
    if (status) query = query.eq("status", status);
    const term = q?.replace(/[,()%*\\]/g, " ").trim();
    if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`, { referencedTable: "customers" });
    const { data, error } = await query;
    if (error) throw mapDbError(error);
    const ids = data.map((m) => m.id);
    const { data: balances, error: balanceError } = ids.length
      ? await db.from("member_balances").select("member_id, balance_minutes").in("member_id", ids)
      : { data: [], error: null };
    if (balanceError) throw mapDbError(balanceError);
    return c.json({
      members: data.map((m) => ({
        id: m.id,
        memberNo: m.member_no,
        status: m.status,
        currentPeriodEnd: m.current_period_end,
        name: (m.customers as { name: string }).name,
        email: (m.customers as { email: string | null }).email,
        phone: (m.customers as { phone: string | null }).phone,
        tierName: (m.membership_tiers as { name: string }).name,
        balanceMinutes: balances?.find((b) => b.member_id === m.id)?.balance_minutes ?? 0,
      })),
    });
  },
);

adminMemberRoutes.get("/members/:id", validate("param", Id), async (c) => {
  const { db } = c.get("deps");
  const { id } = c.req.valid("param");
  const member = await getMember(db, id);
  const { data: ledger, error } = await db
    .from("member_balance_ledger")
    .select("id, delta_minutes, kind, reason, created_at, session_id, booking_id, actor:staff!member_balance_ledger_actor_staff_id_fkey(display_name)")
    .eq("member_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw mapDbError(error);
  const { data: row, error: rowError } = await db.from("members").select("current_period_end, pending_tier_id, stripe_subscription_id").eq("id", id).single();
  if (rowError) throw mapDbError(rowError);
  return c.json({
    member: {
      ...member,
      currentPeriodEnd: row.current_period_end,
      pendingTierId: row.pending_tier_id,
      billing: row.stripe_subscription_id ? "stripe" : "complimentary",
    },
    ledger: ledger.map((l) => ({ ...l, actor: (l.actor as { display_name: string } | null)?.display_name ?? null })),
  });
});

adminMemberRoutes.post(
  "/members",
  validate(
    "json",
    z
      .object({
        name: z.string().trim().min(1).max(80),
        email: z.email().optional(),
        phone: z.string().trim().min(6).max(20).optional(),
        tierId: z.uuid(),
        validUntil: z.iso.datetime({ offset: true }).optional(),
        reason: z.string().trim().min(3).max(300),
      })
      .refine((b) => b.email || b.phone, "An email or phone number is required"),
  ),
  async (c) => {
    const b = c.req.valid("json");
    const card = newCardToken();
    const { data, error } = await c.get("deps").db.rpc("admin_create_member", {
      p_staff: c.get("operator").id,
      p_member: { name: b.name, email: b.email ?? null, phone: b.phone ?? null, tierId: b.tierId, validUntil: b.validUntil ?? null, qrTokenHash: card.hash },
      p_reason: b.reason,
    });
    if (error) throw mapDbError(error);
    return c.json({ member: await getMember(c.get("deps").db, data.id), card: { qr: card.qr } }, 201);
  },
);

adminMemberRoutes.post(
  "/members/:id/balance",
  validate("param", Id),
  validate("json", z.object({ deltaMinutes: z.number().int().min(-6000).max(6000).refine((v) => v !== 0, "Add or remove minutes"), reason: z.string().trim().min(3).max(300) })),
  async (c) => {
    const { deltaMinutes, reason } = c.req.valid("json");
    const { data, error } = await c.get("deps").db.rpc("admin_adjust_balance", {
      p_member: c.req.valid("param").id,
      p_staff: c.get("operator").id,
      p_delta_minutes: deltaMinutes,
      p_reason: reason,
    });
    if (error) throw mapDbError(error);
    return c.json({ balanceMinutes: data });
  },
);

adminMemberRoutes.post(
  "/members/:id/card",
  validate("param", Id),
  validate("json", z.object({ reason: z.string().trim().max(300).optional() })),
  async (c) => {
    const card = newCardToken();
    const { error } = await c.get("deps").db.rpc("admin_reissue_qr", {
      p_member: c.req.valid("param").id,
      p_staff: c.get("operator").id,
      p_token_hash: card.hash,
      p_reason: c.req.valid("json").reason ?? "",
    });
    if (error) throw mapDbError(error);
    return c.json({ card: { qr: card.qr } });
  },
);

// ── Referral codes ───────────────────────────────────────────────────────────
adminMemberRoutes.get("/referral-codes", validate("query", z.object({ include: z.enum(["active", "all"]).default("all") })), async (c) => {
  let query = c.get("deps").db.from("referral_codes").select("*, creator:staff!referral_codes_created_by_fkey(display_name)").order("created_at", { ascending: false }).limit(500);
  if (c.req.valid("query").include === "active") query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw mapDbError(error);
  const now = c.get("deps").clock.now();
  return c.json({
    codes: data.map((r) => ({
      ...r,
      creator: (r.creator as { display_name: string } | null)?.display_name ?? null,
      usable: r.active && (!r.valid_until || new Date(r.valid_until) > now) && r.uses_count < r.max_uses,
    })),
  });
});

const CodeValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent"), value: z.number().int().min(1).max(9999) }),
  z.object({ type: z.literal("fixed"), value: z.number().int().min(1).max(1_000_000) }),
]);

adminMemberRoutes.post(
  "/referral-codes",
  validate(
    "json",
    z.intersection(
      CodeValue,
      z.object({
        maxUses: z.number().int().min(1).max(100_000),
        validUntil: z.iso.datetime({ offset: true }).nullable().optional(),
        count: z.number().int().min(1).max(100).default(1),
        reason: z.string().trim().max(300).optional(),
      }),
    ),
  ),
  async (c) => {
    const b = c.req.valid("json");
    const rows = Array.from({ length: b.count }, () => ({
      discount_type: b.type,
      discount_value: b.value,
      max_uses: b.maxUses,
      valid_until: b.validUntil ?? null,
      created_by: c.get("operator").id,
    }));
    const { data, error } = await auditHeaders(c.get("deps").db.from("referral_codes").insert(rows), c.get("operator").id, b.reason).select("*");
    if (error) throw mapDbError(error);
    return c.json({ codes: data }, 201);
  },
);

adminMemberRoutes.patch(
  "/referral-codes/:id",
  validate("param", Id),
  validate(
    "json",
    z
      .object({
        active: z.boolean().optional(),
        maxUses: z.number().int().min(1).max(100_000).optional(),
        validUntil: z.iso.datetime({ offset: true }).nullable().optional(),
        reason: z.string().trim().max(300).optional(),
      })
      .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update"),
  ),
  async (c) => {
    const { reason, ...b } = c.req.valid("json");
    const patch = {
      ...(b.active !== undefined ? { active: b.active } : {}),
      ...(b.maxUses !== undefined ? { max_uses: b.maxUses } : {}),
      ...(b.validUntil !== undefined ? { valid_until: b.validUntil } : {}),
    };
    const { data, error } = await auditHeaders(c.get("deps").db.from("referral_codes").update(patch).eq("id", c.req.valid("param").id), c.get("operator").id, reason)
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23514" && error.message.includes("uses_within_max")) {
        throw new ApiError(422, "validation_failed", "Max uses can't be lower than the uses already made");
      }
      throw mapDbError(error);
    }
    if (!data) throw new ApiError(404, "not_found", "Referral code not found");
    return c.json({ code: data });
  },
);

adminMemberRoutes.get("/referral-codes/:id/redemptions", validate("param", Id), async (c) => {
  const { data, error } = await c.get("deps").db
    .from("referral_redemptions")
    .select("id, discount_cents, created_at, session_id, booking_id")
    .eq("code_id", c.req.valid("param").id)
    .order("created_at", { ascending: false });
  if (error) throw mapDbError(error);
  return c.json({ redemptions: data });
});

// ── Sales ────────────────────────────────────────────────────────────────────
adminMemberRoutes.get("/sales", validate("query", z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })), async (c) => {
  const deps = c.get("deps");
  const settings = await loadSettings(deps.db);
  const date = c.req.valid("query").date ?? toLocal(deps.clock.now().getTime(), settings.timezone).date;
  const start = new Date(localToInstant(date, "00:00", settings.timezone)).toISOString();
  const end = new Date(localToInstant(addDaysToDate(date, 1), "00:00", settings.timezone)).toISOString();
  const { data, error } = await deps.db
    .from("sessions")
    .select(
      "id, kind, status, opened_at, closed_at, total_cents, void_reason, resources!inner(label), closer:staff!sessions_closed_by_fkey(display_name), payments(id, method, amount_cents, receipt_no, refunds(amount_cents)), price_overrides(id), bookings(ref, period)",
    )
    .in("status", ["closed", "voided"])
    .gte("closed_at", start)
    .lt("closed_at", end)
    .order("closed_at", { ascending: false });
  if (error) throw mapDbError(error);
  return c.json({
    date,
    sales: data.map((s) => {
      const payment = (s.payments as { id: string; method: string; amount_cents: number; receipt_no: number; refunds: { amount_cents: number }[] }[])[0] ?? null;
      const booking = s.bookings as { ref: string; period: unknown } | null;
      return {
        sessionId: s.id,
        kind: s.kind,
        status: s.status,
        resource: (s.resources as { label: string }).label,
        openedAt: s.opened_at,
        closedAt: s.closed_at,
        totalCents: s.total_cents,
        voidReason: s.void_reason,
        closedBy: (s.closer as { display_name: string } | null)?.display_name ?? null,
        overridden: (s.price_overrides as unknown[]).length > 0,
        bookingRef: booking?.ref ?? null,
        bookingEndsAt: booking ? parseRange(booking.period).end.toISOString() : null,
        payment: payment && {
          id: payment.id,
          method: payment.method,
          amountCents: payment.amount_cents,
          receiptNo: payment.receipt_no,
          refundedCents: payment.refunds.reduce((a, r) => a + r.amount_cents, 0),
        },
      };
    }),
  });
});

adminMemberRoutes.post("/sales/:id/void", validate("param", Id), validate("json", z.object({ reason: z.string().trim().min(3).max(300) })), async (c) => {
  const deps = c.get("deps");
  const { data, error } = await deps.db.rpc("pos_void_session", {
    p_session: c.req.valid("param").id,
    p_staff: c.get("operator").id,
    p_reason: c.req.valid("json").reason,
    p_now: deps.clock.now().toISOString(),
  });
  if (error) throw mapDbError(error);
  return c.json({ result: data });
});

adminMemberRoutes.post(
  "/payments/:id/refund",
  validate("param", Id),
  validate("json", z.object({ amountCents: Cents.min(1), reason: z.string().trim().min(3).max(300) })),
  async (c) => {
    const { amountCents, reason } = c.req.valid("json");
    const { data, error } = await c.get("deps").db.rpc("pos_refund_payment", {
      p_payment: c.req.valid("param").id,
      p_staff: c.get("operator").id,
      p_amount_cents: amountCents,
      p_reason: reason,
    });
    if (error) throw mapDbError(error);
    return c.json({ refund: data }, 201);
  },
);

// ── Shifts ───────────────────────────────────────────────────────────────────
adminMemberRoutes.get(
  "/shifts",
  validate("query", z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), flagged: z.enum(["true", "false"]).optional() })),
  async (c) => {
    const q = c.req.valid("query");
    let query = c.get("deps").db
      .from("shifts")
      .select(
        "id, opened_at, closed_at, opening_float_cents, expected_cash_cents, counted_cash_cents, cash_variance_cents, pos_card_total_cents, terminal_card_total_cents, card_variance_cents, flagged, opener:staff!shifts_staff_id_fkey(display_name), closer:staff!shifts_closed_by_fkey(display_name)",
      )
      .order("opened_at", { ascending: false })
      .limit(q.limit);
    if (q.flagged) query = query.eq("flagged", q.flagged === "true");
    const { data, error } = await query;
    if (error) throw mapDbError(error);
    return c.json({
      shifts: data.map((s) => ({
        ...s,
        opener: (s.opener as { display_name: string } | null)?.display_name ?? null,
        closer: (s.closer as { display_name: string } | null)?.display_name ?? null,
      })),
    });
  },
);

// ── Billing ──────────────────────────────────────────────────────────────────
adminMemberRoutes.post("/billing/sync-catalog", async (c) => {
  return c.json({ tiers: await syncCatalog(c.get("deps"), c.get("operator").id) });
});

adminMemberRoutes.post(
  "/members/:id/tier",
  validate("param", Id),
  validate("json", z.object({ tierId: z.uuid(), reason: z.string().trim().max(300).optional() })),
  async (c) => {
    const { tierId, reason } = c.req.valid("json");
    return c.json(await changeMemberTier(c.get("deps"), c.get("operator"), c.req.valid("param").id, tierId, reason ?? null));
  },
);

adminMemberRoutes.post("/members/:id/cancel", validate("param", Id), validate("json", z.object({ reason: z.string().trim().max(300).optional() })), async (c) => {
  return c.json(await setCancelAtPeriodEnd(c.get("deps"), c.get("operator"), c.req.valid("param").id, true, c.req.valid("json").reason ?? null));
});

adminMemberRoutes.post("/members/:id/resume", validate("param", Id), validate("json", z.object({ reason: z.string().trim().max(300).optional() })), async (c) => {
  return c.json(await setCancelAtPeriodEnd(c.get("deps"), c.get("operator"), c.req.valid("param").id, false, c.req.valid("json").reason ?? null));
});
