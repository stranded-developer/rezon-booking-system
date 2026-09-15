import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { addDaysToDate, formatCents, isWallTime, localToInstant, priceSession, PricingError, toLocal, type PriceResult } from "@raceground/pricing";
import type { Json } from "@raceground/db";
import type { AppDeps } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { writeAudit } from "../lib/audit.js";
import { buildIcs } from "../lib/ics.js";
import { requireStripe, stripeCall } from "../lib/stripe.js";
import { getReferral, type MemberSummary, type ReferralSummary } from "./lookup.js";
import { loadPricingContext, loadSettings, parseRange, wallTime } from "./venue.js";

const MINUTE_MS = 60_000;
const SLOT_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hashBookingToken = (token: string) => createHash("sha256").update(token).digest("hex");

const bookingLink = (deps: AppDeps, ref: string, token: string) => `${deps.env.BOOKING_SITE_URL}/booking/${ref}?token=${encodeURIComponent(token)}`;

/** "Tue 15 Jan 2030" and "12:00" in venue time. */
function venueText(instant: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(instant)
    .replace(/,/g, "");
  return { date, time: toLocal(instant.getTime(), timeZone).label.slice(11) };
}

async function activeType(deps: AppDeps, idOrKey: string) {
  const query = deps.db.from("resource_types").select("id, key, name, base_rate_cents, min_minutes, active");
  const { data, error } = await (UUID.test(idOrKey) ? query.eq("id", idOrKey) : query.eq("key", idOrKey)).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data || !data.active) throw new ApiError(404, "not_found", "That kind of booking isn't available");
  return data;
}

async function activeResources(deps: AppDeps, typeId: string) {
  const { data, error } = await deps.db.from("resources").select("id, label, sort").eq("resource_type_id", typeId).eq("active", true).order("sort").order("label");
  if (error) throw mapDbError(error);
  return data;
}

// ── Public config ────────────────────────────────────────────────────────────
export async function publicConfig(deps: AppDeps) {
  const { db, clock } = deps;
  const [settings, types, resources, hours, hhs, tiers, bands] = await Promise.all([
    loadSettings(db),
    db.from("resource_types").select("id, key, name, base_rate_cents, min_minutes, sort").eq("active", true).order("sort"),
    db.from("resources").select("id, label, resource_type_id, sort").eq("active", true).order("sort").order("label"),
    db.from("opening_hours").select("*").order("day_of_week"),
    db.from("happy_hours").select("*").eq("active", true),
    db.from("membership_tiers").select("id, name, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes, stripe_price_id, sort").eq("active", true).order("sort"),
    db.from("rate_bands").select("*").eq("active", true),
  ]);
  for (const r of [types, resources, hours, hhs, tiers, bands]) if (r.error) throw mapDbError(r.error);
  return {
    businessName: settings.business_name ?? "Raceground",
    timeZone: settings.timezone,
    today: toLocal(clock.now().getTime(), settings.timezone).date,
    bookingWindowDays: settings.booking_window_days,
    onlineCutoffMinutes: settings.online_cutoff_minutes,
    holdMinutes: settings.hold_ttl_minutes,
    noShowHoldMinutes: settings.no_show_hold_minutes,
    refundPolicy: { fullRefundHoursBefore: 24, halfRefundHoursBefore: 2 },
    resourceTypes: types.data!.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      baseRateCents: t.base_rate_cents,
      minMinutes: t.min_minutes,
      resources: resources.data!.filter((r) => r.resource_type_id === t.id).map((r) => ({ id: r.id, label: r.label })),
    })),
    openingHours: hours.data!.map((h) => ({ dayOfWeek: h.day_of_week, open: wallTime(h.open_time), close: wallTime(h.close_time), closed: h.closed })),
    happyHours: hhs.data!.map((h) => ({
      name: h.name,
      resourceTypeIds: h.resource_type_ids,
      daysOfWeek: h.days_of_week,
      startTime: wallTime(h.start_time),
      endTime: wallTime(h.end_time),
      discountBp: h.discount_bp,
    })),
    rateBands: bands.data!.map((b) => ({
      resourceTypeId: b.resource_type_id,
      daysOfWeek: b.days_of_week,
      startTime: wallTime(b.start_time),
      endTime: wallTime(b.end_time),
      rateCents: b.rate_cents,
    })),
    tiers: tiers.data!.map((t) => ({
      id: t.id,
      name: t.name,
      discountBp: t.discount_bp,
      monthlyPriceCents: t.monthly_price_cents,
      monthlyFreeMinutes: t.monthly_free_minutes,
      maxBalanceMinutes: t.max_balance_minutes,
      sellable: t.stripe_price_id !== null,
    })),
  };
}

// ── Availability ─────────────────────────────────────────────────────────────
interface Busy {
  resourceId: string;
  start: number;
  end: number;
}

async function busyPeriods(deps: AppDeps, resourceIds: string[], from: number, to: number, now: Date): Promise<Busy[]> {
  if (resourceIds.length === 0) return [];
  const { data, error } = await deps.db
    .from("bookings")
    .select("resource_id, period, status, hold_expires_at")
    .in("resource_id", resourceIds)
    .in("status", ["held", "confirmed", "arrived"])
    .overlaps("period", `[${new Date(from).toISOString()},${new Date(to).toISOString()})`);
  if (error) throw mapDbError(error);
  return data
    .filter((b) => b.status !== "held" || (b.hold_expires_at !== null && new Date(b.hold_expires_at) > now))
    .map((b) => {
      const { start, end } = parseRange(b.period);
      return { resourceId: b.resource_id, start: start.getTime(), end: end.getTime() };
    });
}

/** Longest bookable length (15-minute steps) on a resource from `start`, or 0 if it's taken at `start`. */
function maxMinutesFrom(start: number, closeAt: number, busy: Busy[]): number {
  let limit = closeAt;
  for (const b of busy) {
    if (b.start <= start && b.end > start) return 0;
    if (b.start > start && b.start < limit) limit = b.start;
  }
  return Math.max(0, Math.floor((limit - start) / (SLOT_MINUTES * MINUTE_MS)) * SLOT_MINUTES);
}

export async function availability(deps: AppDeps, typeIdOrKey: string, date: string) {
  const now = deps.clock.now();
  const settings = await loadSettings(deps.db);
  const tz = settings.timezone;
  const type = await activeType(deps, typeIdOrKey);
  const resources = await activeResources(deps, type.id);
  const today = toLocal(now.getTime(), tz).date;
  const lastDate = addDaysToDate(today, settings.booking_window_days);
  const dayOfWeek = toLocal(localToInstant(date, "12:00", tz), tz).isoDayOfWeek;
  const { data: hours, error } = await deps.db.from("opening_hours").select("*").eq("day_of_week", dayOfWeek).maybeSingle();
  if (error) throw mapDbError(error);

  const base = {
    date,
    timeZone: tz,
    today,
    lastDate,
    resourceType: { id: type.id, key: type.key, name: type.name, minMinutes: type.min_minutes, baseRateCents: type.base_rate_cents },
    resources: resources.map((r) => ({ id: r.id, label: r.label })),
    open: hours ? wallTime(hours.open_time) : null,
    close: hours ? wallTime(hours.close_time) : null,
    closed: !hours || hours.closed,
    inWindow: date >= today && date <= lastDate,
  };
  if (base.closed || !base.inWindow || resources.length === 0) return { ...base, slots: [] };

  const openAt = localToInstant(date, base.open!, tz);
  const closeAt = localToInstant(date, base.close!, tz);
  const earliest = now.getTime() + settings.online_cutoff_minutes * MINUTE_MS;
  const busy = await busyPeriods(deps, resources.map((r) => r.id), openAt, closeAt, now);

  const slots = [];
  for (let t = openAt; t + type.min_minutes * MINUTE_MS <= closeAt; t += SLOT_MINUTES * MINUTE_MS) {
    if (t < earliest) continue;
    const resourceMaxMinutes: Record<string, number> = {};
    for (const r of resources) {
      const max = maxMinutesFrom(
        t,
        closeAt,
        busy.filter((b) => b.resourceId === r.id),
      );
      resourceMaxMinutes[r.id] = max >= type.min_minutes ? max : 0;
    }
    const lengths = Object.values(resourceMaxMinutes);
    slots.push({
      time: toLocal(t, tz).label.slice(11),
      startsAt: new Date(t).toISOString(),
      availableResources: lengths.filter((m) => m > 0).length,
      maxMinutes: Math.max(0, ...lengths),
      resourceMaxMinutes,
    });
  }
  return { ...base, slots };
}

// ── Referral and quote ───────────────────────────────────────────────────────
/** Referral status for online use: live holds count as reserved uses. */
export async function checkReferral(deps: AppDeps, code: string, now: Date): Promise<ReferralSummary> {
  const referral = await getReferral(deps.db, code, now);
  if (!referral.usable) return referral;
  const { count, error } = await deps.db
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("referral_code_id", referral.id)
    .eq("status", "held")
    .gt("hold_expires_at", now.toISOString());
  if (error) throw mapDbError(error);
  if (referral.usesCount + (count ?? 0) >= referral.maxUses) return { ...referral, usable: false, reason: "used_up" };
  return referral;
}

export interface BookingRequest {
  resourceTypeId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  referralCode?: string | undefined;
  freeMinutes?: number | undefined;
}

export interface BookingQuote {
  resourceTypeId: string;
  resourceTypeName: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  pricing: PriceResult;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  explanation: string[];
  referral: { id: string; code: string; type: "percent" | "fixed"; value: number } | null;
  member: { id: string; memberNo: string; tierName: string; discountBp: number; balanceMinutes: number } | null;
  maxFreeMinutes: number;
}

/** Prices a booking with the one engine. `member` is the signed-in, eligible member (6b-2), else null. */
export async function quoteBooking(deps: AppDeps, req: BookingRequest, member: MemberSummary | null): Promise<BookingQuote> {
  const now = deps.clock.now();
  const settings = await loadSettings(deps.db);
  const tz = settings.timezone;
  const type = await activeType(deps, req.resourceTypeId);
  if (!isWallTime(req.startTime)) throw new ApiError(422, "validation_failed", "Start time must be HH:MM");
  const startAt = localToInstant(req.date, req.startTime, tz);
  if (toLocal(startAt, tz).label !== `${req.date} ${req.startTime}`) {
    throw new ApiError(422, "invalid_time", "That time doesn't exist on this day (daylight saving change)");
  }
  const endAt = startAt + req.durationMinutes * MINUTE_MS;
  if (member && req.referralCode) throw new ApiError(422, "member_and_referral", "A membership and a referral code cannot be used together");
  if (member && !member.eligible) throw new ApiError(409, "member_inactive", "This membership is not active");

  const referral = req.referralCode ? await checkReferral(deps, req.referralCode, now) : null;
  if (referral && !referral.usable) {
    throw new ApiError(409, "referral_invalid", "This referral code can no longer be used", { reason: referral.reason });
  }
  const freeMinutes = req.freeMinutes ?? 0;
  if (freeMinutes > 0 && !member) throw new ApiError(422, "validation_failed", "Free minutes need a member");
  if (member && freeMinutes > member.balanceMinutes) {
    throw new ApiError(422, "insufficient_balance", "Not enough free-play minutes", { balanceMinutes: member.balanceMinutes });
  }

  const ctx = await loadPricingContext(deps.db, type.id, tz);
  let pricing: PriceResult;
  try {
    pricing = priceSession({
      startAt,
      endAt,
      timeZone: tz,
      resourceType: ctx.resourceType,
      rateBands: ctx.rateBands,
      happyHours: ctx.happyHours,
      applyMinimum: true,
      ...(member ? { member: { tierName: member.tierName, discountBp: member.discountBp }, freeMinutes } : {}),
      ...(referral ? { referral: { code: referral.code, type: referral.type, value: referral.value } } : {}),
    });
  } catch (err) {
    if (err instanceof PricingError) throw new ApiError(422, "validation_failed", err.message);
    throw err;
  }

  return {
    resourceTypeId: type.id,
    resourceTypeName: type.name,
    startsAt: new Date(startAt).toISOString(),
    endsAt: new Date(endAt).toISOString(),
    durationMinutes: req.durationMinutes,
    pricing,
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discount?.amountCents ?? 0,
    totalCents: pricing.totalCents,
    gstCents: pricing.gstCents,
    explanation: pricing.explanation,
    referral: referral && { id: referral.id, code: referral.code, type: referral.type, value: referral.value },
    member: member && { id: member.id, memberNo: member.memberNo, tierName: member.tierName, discountBp: member.discountBp, balanceMinutes: member.balanceMinutes },
    maxFreeMinutes: member ? Math.min(member.balanceMinutes, req.durationMinutes) : 0,
  };
}

// ── Hold → pay ───────────────────────────────────────────────────────────────
export interface HoldRequest extends BookingRequest {
  resourceId?: string | undefined;
  customer?: { name: string; email?: string | undefined; phone?: string | undefined } | undefined;
  expectedTotalCents: number;
}

export type HoldResult =
  | { status: "confirmed"; bookingId: string; ref: string; token: string }
  | { status: "pending_payment"; bookingId: string; ref: string; token: string; checkoutUrl: string; holdExpiresAt: string };

export async function holdBooking(deps: AppDeps, req: HoldRequest, member: MemberSummary | null): Promise<HoldResult> {
  const now = deps.clock.now();
  const quote = await quoteBooking(deps, req, member);
  if (req.expectedTotalCents !== quote.totalCents) {
    throw new ApiError(409, "quote_changed", `The price is now ${formatCents(quote.totalCents)}. Please check it before paying.`, { quote });
  }
  if (!member && !req.customer) throw new ApiError(422, "validation_failed", "Your name and an email or phone number are required");
  if (quote.totalCents > 0) requireStripe(deps);

  const resources = await activeResources(deps, quote.resourceTypeId);
  const candidates = req.resourceId ? resources.filter((r) => r.id === req.resourceId) : resources;
  if (candidates.length === 0) throw new ApiError(404, "not_found", "That table or simulator is not available");

  const token = randomBytes(32).toString("base64url");
  const snapshot = {
    source: "online",
    pricing: quote.pricing,
    explanation: quote.explanation,
    discountCents: quote.referral ? quote.discountCents : 0,
    referral: quote.referral,
    member: quote.member && { id: quote.member.id, memberNo: quote.member.memberNo, tierName: quote.member.tierName },
  };

  let booking: { id: string; ref: string; hold_expires_at: string | null; resource_id: string } | null = null;
  for (const [i, resource] of candidates.entries()) {
    const { data, error } = await deps.db.rpc("booking_hold", {
      p: {
        resourceId: resource.id,
        startsAt: quote.startsAt,
        endsAt: quote.endsAt,
        now: now.toISOString(),
        memberId: member?.id ?? null,
        customer: member ? null : req.customer,
        referralCodeId: quote.referral?.id ?? null,
        freeMinutes: quote.pricing.freeMinutes,
        pricing: snapshot,
        totalCents: quote.totalCents,
        gstCents: quote.gstCents,
        cancelTokenHash: hashBookingToken(token),
      } as unknown as Json,
    });
    if (!error) {
      booking = data;
      break;
    }
    const mapped = mapDbError(error);
    if (mapped.code === "slot_taken" && i < candidates.length - 1) continue;
    throw mapped;
  }
  if (!booking) throw new ApiError(409, "slot_taken", "That time has just been booked. Please choose another.");
  const resourceLabel = candidates.find((r) => r.id === booking.resource_id)?.label ?? "";

  if (quote.totalCents === 0) {
    const { error } = await deps.db.rpc("booking_confirm", { p_booking: booking.id, p: { method: "free", amountPaidCents: 0 } });
    if (error) throw mapDbError(error);
    await sendBookingConfirmation(deps, booking.id, token);
    return { status: "confirmed", bookingId: booking.id, ref: booking.ref, token };
  }

  const stripe = requireStripe(deps);
  const settings = await loadSettings(deps.db);
  const start = venueText(new Date(quote.startsAt), settings.timezone);
  const end = venueText(new Date(quote.endsAt), settings.timezone);
  const link = bookingLink(deps, booking.ref, token);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripeCall(() =>
      stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "aud",
                unit_amount: quote.totalCents,
                product_data: {
                  name: `${quote.resourceTypeName} · ${resourceLabel}`,
                  description: `${start.date}, ${start.time}–${end.time} (Sydney time) · booking ${booking.ref}`,
                },
              },
            },
          ],
          ...(member?.email ? { customer_email: member.email } : req.customer?.email ? { customer_email: req.customer.email } : {}),
          client_reference_id: booking.id,
          // The link token rides along so the webhook can put it in the confirmation email (only its hash is stored).
          metadata: { booking_id: booking.id, booking_ref: booking.ref, booking_token: token },
          payment_intent_data: { metadata: { booking_id: booking.id, booking_ref: booking.ref }, description: `Raceground booking ${booking.ref}` },
          payment_method_types: ["card"],
          success_url: `${link}&paid=1`,
          cancel_url: `${link}&abandoned=1`,
          // Stripe needs ≥ 30 min; the database hold lasts 10 minutes longer than this.
          expires_at: Math.floor(now.getTime() / 1000) + settings.hold_ttl_minutes * 60 + 60,
          adaptive_pricing: { enabled: false },
        },
        { idempotencyKey: `booking-checkout-${booking.id}` },
      ),
    );
  } catch (err) {
    await deps.db.rpc("booking_release_hold", { p_booking: booking.id });
    throw err;
  }
  const { error: attachError } = await deps.db.rpc("booking_attach_checkout", { p_booking: booking.id, p_checkout_session_id: session.id });
  if (attachError) {
    await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    throw mapDbError(attachError);
  }
  return { status: "pending_payment", bookingId: booking.id, ref: booking.ref, token, checkoutUrl: session.url!, holdExpiresAt: booking.hold_expires_at! };
}

// ── Webhooks ─────────────────────────────────────────────────────────────────
const paymentIntentOf = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

/** checkout.session.completed (mode=payment). Returns false when the session isn't one of our bookings. */
export async function handleBookingCheckoutCompleted(deps: AppDeps, session: Stripe.Checkout.Session): Promise<boolean> {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return false;
  if (session.payment_status !== "paid") return false; // card payments are paid on completion; nothing else is enabled
  if (session.currency !== "aud") {
    throw new ApiError(500, "unexpected_currency", `Checkout ${session.id} is in ${session.currency}, expected aud`);
  }
  const paymentIntentId = paymentIntentOf(session);
  const { data, error } = await deps.db.rpc("booking_confirm", {
    p_booking: bookingId,
    p: {
      method: "stripe",
      paymentIntentId,
      checkoutSessionId: session.id,
      amountPaidCents: session.amount_total,
      email: session.customer_details?.email ?? null,
    },
  });
  if (error) {
    const mapped = mapDbError(error);
    if (mapped.code !== "hold_expired" && mapped.code !== "amount_mismatch") throw mapped;
    // Paid for a hold we no longer have (or the wrong amount): give all of it back.
    const refund = await stripeCall(() =>
      requireStripe(deps).refunds.create(
        { payment_intent: paymentIntentId!, metadata: { booking_id: bookingId, kind: "booking_unconfirmed" } },
        { idempotencyKey: `booking-unconfirmed-${bookingId}` },
      ),
    );
    await writeAudit(deps.db, {
      actorStaffId: null,
      action: "booking.payment_refunded",
      entity: "bookings",
      entityId: bookingId,
      after: { reason: mapped.code, stripe_refund_id: refund.id, amount_cents: refund.amount, payment_intent: paymentIntentId },
    });
    const email = session.customer_details?.email;
    if (email) {
      await deps.email.send({
        template: "booking_payment_refunded",
        to: email,
        subject: `Raceground booking ${session.metadata?.booking_ref ?? ""}: payment refunded`,
        text: `Hi,\n\nYour payment came through after we had to release the time you picked, so the booking wasn't made and we've refunded the full ${formatCents(refund.amount)} to your card. Refunds usually show within 5–10 business days.\n\nPlease book again at ${deps.env.BOOKING_SITE_URL}.\n\nRaceground`,
        entity: "bookings",
        entityId: `${bookingId}:refunded`,
      });
    }
    return true;
  }
  const result = data as { confirmed: boolean };
  if (result.confirmed) {
    const token = session.metadata?.booking_token;
    await sendBookingConfirmation(deps, bookingId, token ?? null);
  }
  return true;
}

/** checkout.session.expired: free the slot now instead of waiting for the hold to lapse. */
export async function handleBookingCheckoutExpired(deps: AppDeps, session: Stripe.Checkout.Session): Promise<boolean> {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return false;
  const { error } = await deps.db.rpc("booking_release_hold", { p_booking: bookingId });
  if (error) throw mapDbError(error);
  return true;
}

// ── Customer links ───────────────────────────────────────────────────────────
const BOOKING_SELECT = "*, resources!inner(label, resource_types!inner(name, key)), customers!inner(name, email, phone)" as const;

type BookingRow = {
  id: string;
  ref: string;
  status: string;
  period: unknown;
  hold_expires_at: string | null;
  free_minutes_used: number;
  total_cents: number | null;
  gst_cents: number | null;
  pricing_snapshot: { explanation?: string[] } | null;
  cancel_token_hash: string | null;
  cancelled_at: string | null;
  refund_cents: number | null;
  member_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  resources: { label: string; resource_types: { name: string; key: string } };
  customers: { name: string; email: string | null; phone: string | null };
};

/** A booking link is valid only with its token; anything else looks like "not found". */
async function bookingByLink(deps: AppDeps, ref: string, token: string): Promise<BookingRow> {
  const normalized = ref.trim().toUpperCase();
  const { data, error } = await deps.db.from("bookings").select(BOOKING_SELECT).eq("ref", normalized).maybeSingle();
  if (error) throw mapDbError(error);
  const row = data as unknown as BookingRow | null;
  const given = Buffer.from(hashBookingToken(token), "hex");
  const stored = Buffer.from(row?.cancel_token_hash ?? "", "hex");
  if (!row || stored.length !== given.length || !timingSafeEqual(stored, given)) {
    throw new ApiError(404, "not_found", "Booking not found. Check the link in your email.");
  }
  return row;
}

async function cancelQuote(deps: AppDeps, bookingId: string, now: Date) {
  const { data, error } = await deps.db.rpc("booking_cancel_quote", { p_booking: bookingId, p_now: now.toISOString(), p_venue_fault: false });
  if (error) throw mapDbError(error);
  return data as { allowed: boolean; rule?: string; reason?: string; refundCents?: number; paidCents?: number; returnMinutes?: number; hoursBefore: number };
}

export async function viewBooking(deps: AppDeps, ref: string, token: string) {
  const b = await bookingByLink(deps, ref, token);
  const now = deps.clock.now();
  const { start, end } = parseRange(b.period);
  const settings = await loadSettings(deps.db);
  const quote = b.status === "confirmed" ? await cancelQuote(deps, b.id, now) : null;
  const s = venueText(start, settings.timezone);
  return {
    ref: b.ref,
    status: b.status,
    resourceType: b.resources.resource_types.name,
    resource: b.resources.label,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    venueDate: s.date,
    venueStartTime: s.time,
    venueEndTime: venueText(end, settings.timezone).time,
    timeZone: settings.timezone,
    durationMinutes: Math.round((end.getTime() - start.getTime()) / MINUTE_MS),
    customerName: b.customers.name,
    totalCents: b.total_cents,
    gstCents: b.gst_cents,
    freeMinutesUsed: b.free_minutes_used,
    explanation: b.pricing_snapshot?.explanation ?? [],
    holdExpiresAt: b.status === "held" ? b.hold_expires_at : null,
    cancelledAt: b.cancelled_at,
    refundCents: b.refund_cents,
    checkInCode: `rg:b:${b.ref}`,
    cancellation: quote && {
      allowed: quote.allowed,
      rule: quote.rule ?? null,
      reason: quote.reason ?? null,
      refundCents: quote.refundCents ?? 0,
      paidCents: quote.paidCents ?? 0,
      returnMinutes: quote.returnMinutes ?? 0,
    },
  };
}

/** Customer gave up at Stripe Checkout: close the checkout and free the slot straight away. */
export async function abandonBooking(deps: AppDeps, ref: string, token: string) {
  const b = await bookingByLink(deps, ref, token);
  if (b.status !== "held") return { status: b.status };
  if (b.stripe_checkout_session_id && deps.stripe) {
    try {
      await deps.stripe.checkout.sessions.expire(b.stripe_checkout_session_id);
    } catch (err) {
      if (!(err instanceof Stripe.errors.StripeError)) throw err;
      // Can't expire a completed checkout: the payment is on its way, keep the hold for the webhook.
      const session = await stripeCall(() => deps.stripe!.checkout.sessions.retrieve(b.stripe_checkout_session_id!));
      if (session.status === "complete") return { status: "held" };
    }
  }
  const { data, error } = await deps.db.rpc("booking_release_hold", { p_booking: b.id });
  if (error) throw mapDbError(error);
  return { status: data as string };
}

export async function cancelBookingByCustomer(deps: AppDeps, ref: string, token: string, expectedRefundCents: number) {
  const b = await bookingByLink(deps, ref, token);
  const now = deps.clock.now();
  const quote = await cancelQuote(deps, b.id, now);
  if (!quote.allowed) {
    if (quote.reason === "too_late") {
      throw new ApiError(409, "too_late", "Bookings can't be cancelled online less than 2 hours before the start. Please call the venue.");
    }
    throw new ApiError(409, "not_cancellable", "This booking can't be cancelled");
  }
  const refundCents = quote.refundCents ?? 0;
  if (expectedRefundCents !== refundCents) {
    throw new ApiError(409, "refund_changed", `The refund is now ${formatCents(refundCents)}. Please check it again.`, { refundCents, rule: quote.rule });
  }

  let stripeRefundId: string | null = null;
  if (refundCents > 0) {
    const stripe = requireStripe(deps);
    const paymentIntent = b.stripe_payment_intent_id;
    if (!paymentIntent) throw new ApiError(500, "internal", "The online payment for this booking is missing");
    // A retry after a failure below reuses the refund Stripe already made for this cancellation.
    const existing = (await stripeCall(() => stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 }))).data.find(
      (r) => r.metadata?.kind === "booking_cancel" && r.status !== "failed" && r.status !== "canceled",
    );
    if (existing && existing.amount !== refundCents) {
      throw new ApiError(409, "refund_in_progress", "A different refund is already in progress for this booking. Please contact the venue.");
    }
    const refund =
      existing ??
      (await stripeCall(() =>
        stripe.refunds.create(
          { payment_intent: paymentIntent, amount: refundCents, metadata: { booking_id: b.id, kind: "booking_cancel", rule: quote.rule ?? "" } },
          { idempotencyKey: `booking-cancel-${b.id}-${refundCents}` },
        ),
      ));
    stripeRefundId = refund.id;
  }

  const { data, error } = await deps.db.rpc("booking_cancel", {
    p_booking: b.id,
    p: { now: now.toISOString(), refundCents, stripeRefundId },
  });
  if (error) throw mapDbError(error);
  const result = data as { refundCents: number; minutesReturned: number; rule: string };

  if (b.customers.email) {
    const settings = await loadSettings(deps.db);
    const { start, end } = parseRange(b.period);
    const s = venueText(start, settings.timezone);
    const moneyLine =
      result.refundCents > 0
        ? `We've refunded ${formatCents(result.refundCents)} to your card. Refunds usually show within 5–10 business days.`
        : "No refund applies to this cancellation.";
    const minutesLine = result.minutesReturned > 0 ? `\n${result.minutesReturned} minutes of free play are back in your balance.` : "";
    await deps.email.send({
      template: "booking_cancelled",
      to: b.customers.email,
      subject: `Raceground booking ${b.ref} cancelled`,
      text: `Hi ${b.customers.name},\n\nYour booking ${b.ref} (${b.resources.resource_types.name} · ${b.resources.label}, ${s.date} ${s.time}–${venueText(end, settings.timezone).time}) is cancelled.\n${moneyLine}${minutesLine}\n\nRaceground`,
      entity: "bookings",
      entityId: `${b.id}:cancelled`,
    });
  }
  return result;
}

// ── Emails ───────────────────────────────────────────────────────────────────
export async function sendBookingConfirmation(deps: AppDeps, bookingId: string, token: string | null) {
  const { data, error } = await deps.db.from("bookings").select(BOOKING_SELECT).eq("id", bookingId).single();
  if (error) throw mapDbError(error);
  const b = data as unknown as BookingRow;
  if (!b.customers.email) return { sent: false };
  const settings = await loadSettings(deps.db);
  const { start, end } = parseRange(b.period);
  const s = venueText(start, settings.timezone);
  const endTime = venueText(end, settings.timezone).time;
  const what = `${b.resources.resource_types.name} · ${b.resources.label}`;
  const paid = b.total_cents
    ? `Paid: ${formatCents(b.total_cents)} (incl. GST ${formatCents(b.gst_cents ?? 0)})`
    : "Paid: $0.00";
  const free = b.free_minutes_used > 0 ? `\nFree play used: ${b.free_minutes_used} min` : "";
  const link = token ? `\n\nView or cancel your booking: ${bookingLink(deps, b.ref, token)}` : "";
  const text = `Hi ${b.customers.name},\n\nYour booking is confirmed.\n\nBooking code: ${b.ref}\n${what}\n${s.date}, ${s.time}–${endTime} (Sydney time)\n${paid}${free}\n\nShow your booking code at the counter when you arrive. We hold your spot for ${settings.no_show_hold_minutes} minutes after the start time.\n\nCancellations: full refund up to 24 hours before, 50% from 24 to 2 hours before, no online cancellation within 2 hours.${link}\n\nRaceground`;
  const ics = buildIcs({
    uid: `${b.id}@raceground`,
    start,
    end,
    stamp: deps.clock.now(),
    summary: `Raceground: ${what}`,
    description: `Booking ${b.ref}. Show this code at the counter.`,
    location: settings.business_name ?? "Raceground",
    ...(token ? { url: bookingLink(deps, b.ref, token) } : {}),
  });
  return deps.email.send({
    template: "booking_confirmed",
    to: b.customers.email,
    subject: `Raceground booking ${b.ref} confirmed: ${s.date} ${s.time}`,
    text,
    entity: "bookings",
    entityId: `${b.id}:confirmed`,
    attachments: [{ filename: `raceground-${b.ref}.ics`, contentType: "text/calendar; charset=utf-8; method=PUBLISH", content: ics }],
  });
}
