import { formatCents, priceSession, PricingError, toLocal, type PriceResult } from "@raceground/pricing";
import type { Json } from "@raceground/db";
import type { AppDeps, StaffIdentity } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { getMember, getReferral, type MemberSummary, type ReferralSummary } from "./lookup.js";
import { checkStaffPin } from "./pin-check.js";
import { gstOf, loadPricingContext, loadSettings, parseRange } from "./venue.js";

/** A quote's close time stays valid this long, so the amount on the card terminal can't drift. */
export const QUOTE_VALID_MS = 120_000;
const CLOCK_SKEW_MS = 5_000;

export interface ChargeOptions {
  memberId?: string | undefined;
  referralCode?: string | undefined;
  freeMinutes?: number | undefined;
  closedAt?: string | undefined;
}

/** Booked sessions are prepaid: playing past the booking end is never charged (owner decision D48). */
export type ChargeMode = "walk_in" | "prepaid";

export interface ChargeQuote {
  sessionId: string;
  resourceLabel: string;
  mode: ChargeMode;
  openedAt: string;
  closedAt: string;
  /** Booking end for booking sessions. */
  bookingEndsAt: string | null;
  pricing: PriceResult | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  explanation: string[];
  member: MemberSummary | null;
  referral: ReferralSummary | null;
  maxFreeMinutes: number;
}

export async function quoteClose(deps: AppDeps, sessionId: string, opts: ChargeOptions): Promise<ChargeQuote> {
  const { db, clock } = deps;
  const { data: session, error } = await db
    .from("sessions")
    .select("*, resources!inner(label, resource_type_id), bookings(period, member_id)")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!session) throw new ApiError(404, "not_found", "Session not found");
  if (session.status !== "open") throw new ApiError(409, "session_not_open", "This session has already been closed");

  const now = clock.now();
  const closedAt = opts.closedAt ? new Date(opts.closedAt) : now;
  const openedAt = new Date(session.opened_at);
  if (
    Number.isNaN(closedAt.getTime()) ||
    closedAt.getTime() > now.getTime() + CLOCK_SKEW_MS ||
    closedAt.getTime() < now.getTime() - QUOTE_VALID_MS ||
    closedAt < openedAt
  ) {
    throw new ApiError(422, "quote_expired", "The quote has expired. Get a fresh total before taking payment.");
  }

  const booking = session.bookings as { period: unknown; member_id: string | null } | null;
  const bookingEnd = booking ? parseRange(booking.period).end : null;
  const mode: ChargeMode = bookingEnd ? "prepaid" : "walk_in";
  // Discounts and free play only apply to what is charged at the counter, i.e. walk-ins.
  const memberId = mode === "walk_in" ? opts.memberId : undefined;
  const referralCode = mode === "walk_in" ? opts.referralCode : undefined;
  if (memberId && referralCode) {
    throw new ApiError(422, "member_and_referral", "A membership and a referral code cannot be used together");
  }

  const member = memberId ? await getMember(db, memberId) : null;
  if (member && !member.eligible) {
    throw new ApiError(409, "member_inactive", `This membership is ${member.status.replace("_", " ")}`, { status: member.status });
  }
  const referral = referralCode ? await getReferral(db, referralCode, now) : null;
  if (referral && !referral.usable) {
    throw new ApiError(409, "referral_invalid", "This referral code can no longer be used", { reason: referral.reason });
  }

  const settings = await loadSettings(db);
  const resource = session.resources as { label: string; resource_type_id: string };
  const requestedFree = mode === "prepaid" ? 0 : (opts.freeMinutes ?? 0);
  if (requestedFree > 0 && !member) throw new ApiError(422, "validation_failed", "Free minutes need a member");
  if (member && requestedFree > member.balanceMinutes) {
    throw new ApiError(422, "insufficient_balance", "Not enough free-play minutes", { balanceMinutes: member.balanceMinutes });
  }

  let pricing: PriceResult | null = null;
  if (mode !== "prepaid") {
    const ctx = await loadPricingContext(db, resource.resource_type_id, settings.timezone);
    try {
      pricing = priceSession({
        startAt: openedAt.getTime(),
        endAt: closedAt.getTime(),
        timeZone: ctx.timeZone,
        resourceType: ctx.resourceType,
        rateBands: ctx.rateBands,
        happyHours: ctx.happyHours,
        applyMinimum: true,
        ...(member ? { member: { tierName: member.tierName, discountBp: member.discountBp }, freeMinutes: requestedFree } : {}),
        ...(referral ? { referral: { code: referral.code, type: referral.type, value: referral.value } } : {}),
      });
    } catch (err) {
      if (err instanceof PricingError) throw new ApiError(422, "validation_failed", err.message);
      throw err;
    }
  }

  return {
    sessionId,
    resourceLabel: resource.label,
    mode,
    openedAt: openedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    bookingEndsAt: bookingEnd?.toISOString() ?? null,
    pricing,
    subtotalCents: pricing?.subtotalCents ?? 0,
    discountCents: pricing?.discount?.amountCents ?? 0,
    totalCents: pricing?.totalCents ?? 0,
    gstCents: pricing?.gstCents ?? 0,
    explanation: pricing?.explanation ?? ["Prepaid booking, nothing more to pay"],
    member,
    referral,
    maxFreeMinutes: member && pricing ? Math.min(member.balanceMinutes, pricing.billedMinutes) : 0,
  };
}

export type Tender =
  | { method: "cash"; tenderedCents: number }
  | { method: "card_terminal"; externalRef?: string | undefined }
  | { method: "free" };

export interface CloseRequest extends ChargeOptions {
  closedAt: string;
  expectedTotalCents?: number | undefined;
  tender: Tender;
  override?:
    | {
        totalCents: number;
        reason: string;
        approver?: { staffId: string; pin: string } | undefined;
      }
    | undefined;
}

export async function closeSession(
  deps: AppDeps,
  operator: StaffIdentity,
  sessionId: string,
  req: CloseRequest,
  ip: string | null,
) {
  const quote = await quoteClose(deps, sessionId, req);

  if (!req.override && req.expectedTotalCents !== undefined && req.expectedTotalCents !== quote.totalCents) {
    throw new ApiError(409, "quote_changed", "The total has changed. Check the new amount before taking payment.", {
      totalCents: quote.totalCents,
    });
  }

  let approverStaffId: string | null = null;
  if (req.override) {
    if (req.override.totalCents === quote.totalCents) {
      throw new ApiError(422, "validation_failed", "The override amount is the same as the calculated total");
    }
    if (operator.role === "superadmin") {
      approverStaffId = operator.id;
    } else {
      if (!req.override.approver) throw new ApiError(403, "approval_required", "A superadmin must approve a price override");
      const approver = await checkStaffPin(deps.db, deps.env, req.override.approver.staffId, req.override.approver.pin, {
        actorStaffId: operator.id,
        ip,
      });
      if (approver.role !== "superadmin") throw new ApiError(403, "approval_required", "Only a superadmin can approve a price override");
      approverStaffId = approver.id;
    }
  }

  const totalCents = req.override ? req.override.totalCents : quote.totalCents;
  const method = totalCents === 0 ? (quote.mode === "prepaid" ? null : "free") : req.tender.method;
  if (totalCents > 0 && req.tender.method === "free") {
    throw new ApiError(422, "validation_failed", `Take ${formatCents(totalCents)} by cash or card`);
  }
  const tenderedCents = req.tender.method === "cash" && totalCents > 0 ? req.tender.tenderedCents : null;

  const snapshot = {
    mode: quote.mode,
    closedAt: quote.closedAt,
    bookingEndsAt: quote.bookingEndsAt,
    pricing: quote.pricing,
    explanation: quote.explanation,
    member: quote.member && { id: quote.member.id, memberNo: quote.member.memberNo, tierName: quote.member.tierName },
    referral: quote.referral && { id: quote.referral.id, code: quote.referral.code, type: quote.referral.type, value: quote.referral.value },
    override: req.override ? { originalCents: quote.totalCents, totalCents, reason: req.override.reason, approverStaffId } : null,
    tender: { method, tenderedCents },
  };

  const { data, error } = await deps.db.rpc("pos_close_session", {
    p_session: sessionId,
    p_staff: operator.id,
    p_payload: {
      closedAt: quote.closedAt,
      memberId: quote.member?.id ?? null,
      referralCodeId: quote.referral?.id ?? null,
      freeMinutes: quote.pricing?.freeMinutes ?? 0,
      pricing: snapshot,
      computedTotalCents: quote.totalCents,
      totalCents,
      gstCents: gstOf(totalCents),
      discountCents: quote.referral ? quote.discountCents : 0,
      override: req.override ? { reason: req.override.reason, approverStaffId } : null,
      method,
      externalRef: req.tender.method === "card_terminal" ? (req.tender.externalRef ?? null) : null,
      tenderedCents,
    } as unknown as Json,
  });
  if (error) throw mapDbError(error);

  const result = data as { changeCents: number; receiptNo: number | null; paymentId: string | null };
  return { result, receipt: await buildReceipt(deps, sessionId) };
}

export interface Receipt {
  title: "Tax Invoice" | "Receipt";
  receiptNo: number | null;
  businessName: string;
  abn: string | null;
  issuedAt: string;
  resource: string;
  resourceType: string;
  openedAt: string;
  closedAt: string;
  lines: string[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  paymentMethod: string | null;
  tenderedCents: number | null;
  changeCents: number | null;
  servedBy: string | null;
  memberNo: string | null;
  override: { originalCents: number; reason: string } | null;
  voided: boolean;
}

type Snapshot = {
  pricing?: PriceResult | null;
  explanation?: string[];
  member?: { memberNo: string } | null;
  override?: { originalCents: number; reason: string } | null;
  tender?: { tenderedCents: number | null } | null;
};

export async function buildReceipt(deps: AppDeps, sessionId: string): Promise<Receipt> {
  const { db } = deps;
  const [settings, sessionRes, paymentRes] = await Promise.all([
    loadSettings(db),
    db
      .from("sessions")
      .select("*, resources!inner(label, resource_types!inner(name)), closer:staff!sessions_closed_by_fkey(display_name)")
      .eq("id", sessionId)
      .maybeSingle(),
    db.from("payments").select("receipt_no, method, amount_cents, created_at").eq("session_id", sessionId).maybeSingle(),
  ]);
  if (sessionRes.error) throw mapDbError(sessionRes.error);
  if (paymentRes.error) throw mapDbError(paymentRes.error);
  const s = sessionRes.data;
  if (!s) throw new ApiError(404, "not_found", "Session not found");
  if (s.status === "open") throw new ApiError(409, "session_open", "This session has not been closed yet");

  const snap = (s.pricing_snapshot ?? {}) as Snapshot;
  const total = s.total_cents ?? 0;
  const subtotal = snap.override ? snap.override.originalCents + (snap.pricing?.discount?.amountCents ?? 0) : (snap.pricing?.subtotalCents ?? total);
  const local = (iso: string) => toLocal(new Date(iso).getTime(), settings.timezone).label;
  const resource = s.resources as { label: string; resource_types: { name: string } };
  const tendered = snap.tender?.tenderedCents ?? null;

  return {
    title: total > 8250 ? "Tax Invoice" : "Receipt",
    receiptNo: paymentRes.data?.receipt_no ?? null,
    businessName: settings.business_name ?? "Raceground",
    abn: settings.abn,
    issuedAt: local(paymentRes.data?.created_at ?? s.closed_at ?? s.opened_at),
    resource: resource.label,
    resourceType: resource.resource_types.name,
    openedAt: local(s.opened_at),
    closedAt: local(s.closed_at ?? s.opened_at),
    lines: snap.explanation ?? [],
    subtotalCents: subtotal,
    discountCents: Math.max(0, subtotal - total),
    totalCents: total,
    gstCents: s.gst_cents ?? 0,
    paymentMethod: paymentRes.data?.method ?? null,
    tenderedCents: tendered,
    changeCents: tendered !== null ? tendered - total : null,
    servedBy: (s.closer as { display_name: string } | null)?.display_name ?? null,
    memberNo: snap.member?.memberNo ?? null,
    override: snap.override ? { originalCents: snap.override.originalCents, reason: snap.override.reason } : null,
    voided: s.status === "voided",
  };
}
