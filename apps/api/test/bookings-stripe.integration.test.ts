/**
 * Online booking payments against a real Stripe account in TEST mode (key from apps/api/.env.local),
 * on the real clock. Creates real Checkout sessions and real card payments (PaymentIntents with the
 * test Visa); the checkout.session.completed event is built from the real session plus that payment
 * and delivered signed, because completing Checkout itself needs a browser (covered by the site e2e).
 * Refunds are real Stripe refunds. Skipped when no sk_test_ key is configured.
 */
import { randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { addDaysToDate, localToInstant, toLocal } from "@raceground/pricing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { call, testContext, type CallOptions, type TestContext } from "./helpers.js";

const stripeKey = inject("supabase").stripeKey;
const WEBHOOK_SECRET = `whsec_test_${randomBytes(16).toString("hex")}`;
const run = randomUUID().slice(0, 8);
const TZ = "Australia/Sydney";

let ctx: TestContext;
let stripe: Stripe;
let typeId: string;
const resourceIds: string[] = [];
const checkoutIds: string[] = [];
/** Two days ahead in venue time: always ≥ 24 h away and inside the 7-day window. */
const day = () => addDaysToDate(toLocal(Date.now(), TZ).date, 2);

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const api = (path: string, opts: CallOptions = {}) => call(ctx, path, { ...opts, headers: { "x-forwarded-for": randomIp(), ...opts.headers } });

async function hold(startTime: string) {
  const request = { resourceTypeId: typeId, date: day(), startTime, durationMinutes: 60 };
  const quote = await api("/public/quote", { body: request });
  expect(quote.status, JSON.stringify(quote.json)).toBe(200);
  const r = await api("/bookings/hold", {
    body: { ...request, customer: { name: "Stripe Sam", email: `sam-${run}@raceground.test` }, expectedTotalCents: quote.json.quote.totalCents, acceptTerms: true },
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  const row = (await ctx.db.from("bookings").select("stripe_checkout_session_id").eq("id", r.json.bookingId).single()).data!;
  checkoutIds.push(row.stripe_checkout_session_id!);
  return { ...(r.json as { bookingId: string; ref: string; token: string; checkoutUrl: string; status: string }), totalCents: quote.json.quote.totalCents as number, sessionId: row.stripe_checkout_session_id! };
}

/** A real, succeeded card payment for the amount (what Checkout would have created). */
const pay = (amount: number) =>
  stripe.paymentIntents.create({
    amount,
    currency: "aud",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { test_run: run },
  });

async function deliverCompleted(sessionId: string, paymentIntentId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const event = {
    id: `evt_test_${randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { ...session, status: "complete", payment_status: "paid", payment_intent: paymentIntentId, customer_details: { email: `sam-${run}@raceground.test` } } },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await ctx.app.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: payload });
  const json = (await res.json()) as Record<string, unknown>;
  expect(res.status, JSON.stringify(json)).toBe(200);
  return json;
}

const bookingRow = async (id: string) => (await ctx.db.from("bookings").select("status, refund_cents, stripe_payment_intent_id").eq("id", id).single()).data!;

describe.skipIf(!stripeKey)("online booking payments with Stripe (test mode)", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    ctx = testContext({ STRIPE_SECRET_KEY: stripeKey!, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
    stripe = ctx.stripe!;
    expect((await stripe.balance.retrieve()).livemode).toBe(false); // never run against live mode
    const { data: type, error } = await ctx.db
      .from("resource_types")
      .insert({ key: `test_bks_${run}`, name: `Stripe Bay ${run}`, base_rate_cents: 4000, min_minutes: 15, sort: 991 })
      .select("id")
      .single();
    if (error) throw error;
    typeId = type.id;
    const { data: resources, error: rError } = await ctx.db.from("resources").insert([{ resource_type_id: typeId, label: "Bay S", sort: 1 }]).select("id");
    if (rError) throw rError;
    resourceIds.push(...resources.map((r) => r.id));
  }, 60_000);

  afterAll(async () => {
    ctx.clock.real();
    for (const id of checkoutIds) await stripe.checkout.sessions.expire(id).catch(() => undefined);
    await ctx.db.from("bookings").update({ status: "expired" }).in("resource_id", resourceIds).eq("status", "held");
    await ctx.db.from("resources").update({ active: false }).in("id", resourceIds);
    await ctx.db.from("resource_types").update({ active: false }).eq("id", typeId);
  });

  it("holds the slot and opens a card-only AUD Checkout for the exact total", async () => {
    const h = await hold("12:00");
    expect(h.status).toBe("pending_payment");
    expect(h.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const s = await stripe.checkout.sessions.retrieve(h.sessionId);
    expect(s).toMatchObject({ mode: "payment", currency: "aud", amount_total: h.totalCents, payment_method_types: ["card"], customer_email: `sam-${run}@raceground.test` });
    expect(s.metadata).toMatchObject({ booking_id: h.bookingId, booking_ref: h.ref });
    expect(s.adaptive_pricing?.enabled).toBe(false); // always charged in AUD
    expect(s.success_url).toContain(`/booking/${h.ref}?token=`);
    const expiresIn = s.expires_at - Math.floor(Date.now() / 1000);
    expect(expiresIn).toBeGreaterThan(29 * 60);
    expect(expiresIn).toBeLessThanOrEqual(31 * 60);
    const row = (await ctx.db.from("bookings").select("status, hold_expires_at").eq("id", h.bookingId).single()).data!;
    expect(row.status).toBe("held");
    expect(new Date(row.hold_expires_at!).getTime() / 1000).toBeGreaterThan(s.expires_at); // hold outlives Checkout
  });

  it("closes the Checkout and frees the slot when the customer goes back", async () => {
    const h = await hold("13:00");
    const r = await api(`/bookings/${h.ref}/abandon`, { body: { token: h.token } });
    expect(r.json).toEqual({ status: "expired" });
    expect((await stripe.checkout.sessions.retrieve(h.sessionId)).status).toBe("expired");
    const grid = await api(`/public/availability?type=${typeId}&date=${day()}`);
    expect(grid.json.slots.find((x: { time: string }) => x.time === "13:00").availableResources).toBe(1);
  });

  it("confirms a real card payment and refunds all of it through Stripe on a cancel ≥ 24 h ahead", async () => {
    const h = await hold("14:00");
    const pi = await pay(h.totalCents);
    expect(pi.status).toBe("succeeded");
    expect(await deliverCompleted(h.sessionId, pi.id)).toMatchObject({ handled: true });
    expect(await bookingRow(h.bookingId)).toMatchObject({ status: "confirmed", stripe_payment_intent_id: pi.id });

    const view = await api(`/bookings/${h.ref}?token=${h.token}`);
    expect(view.json.booking.cancellation).toMatchObject({ allowed: true, rule: "full", refundCents: h.totalCents });
    const r = await api(`/bookings/${h.ref}/cancel`, { body: { token: h.token, expectedRefundCents: h.totalCents } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    const refunds = await stripe.refunds.list({ payment_intent: pi.id });
    expect(refunds.data).toHaveLength(1);
    expect(refunds.data[0]).toMatchObject({ amount: h.totalCents, metadata: { kind: "booking_cancel", booking_id: h.bookingId } });
    const payment = (await ctx.db.from("payments").select("id").eq("booking_id", h.bookingId).single()).data!;
    const dbRefunds = (await ctx.db.from("refunds").select("amount_cents, stripe_refund_id").eq("payment_id", payment.id)).data!;
    expect(dbRefunds).toEqual([{ amount_cents: h.totalCents, stripe_refund_id: refunds.data[0]!.id }]);
    expect(await bookingRow(h.bookingId)).toMatchObject({ status: "cancelled", refund_cents: h.totalCents });
  });

  it("reuses a refund Stripe already made for this cancel instead of refunding twice", async () => {
    const h = await hold("17:00");
    const pi = await pay(h.totalCents);
    await deliverCompleted(h.sessionId, pi.id);
    // An earlier attempt refunded through Stripe but didn't get to record the cancellation.
    const earlier = await stripe.refunds.create({ payment_intent: pi.id, amount: h.totalCents, metadata: { booking_id: h.bookingId, kind: "booking_cancel" } });
    const r = await api(`/bookings/${h.ref}/cancel`, { body: { token: h.token, expectedRefundCents: h.totalCents } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await stripe.refunds.list({ payment_intent: pi.id })).data.map((x) => x.id)).toEqual([earlier.id]);
    const payment = (await ctx.db.from("payments").select("id").eq("booking_id", h.bookingId).single()).data!;
    expect((await ctx.db.from("refunds").select("stripe_refund_id").eq("payment_id", payment.id)).data).toEqual([{ stripe_refund_id: earlier.id }]);
  });

  it("refunds half through Stripe when cancelled 10 hours before", async () => {
    const h = await hold("15:00");
    const pi = await pay(h.totalCents);
    await deliverCompleted(h.sessionId, pi.id);
    ctx.clock.set(new Date(localToInstant(day(), "15:00", TZ) - 10 * 3_600_000));
    const half = Math.floor(h.totalCents / 2);
    const stale = await api(`/bookings/${h.ref}/cancel`, { body: { token: h.token, expectedRefundCents: h.totalCents } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({ code: "refund_changed", details: { refundCents: half } });
    expect((await stripe.refunds.list({ payment_intent: pi.id })).data).toHaveLength(0);
    const r = await api(`/bookings/${h.ref}/cancel`, { body: { token: h.token, expectedRefundCents: half } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ rule: "half", refundCents: half });
    const refunds = await stripe.refunds.list({ payment_intent: pi.id });
    expect(refunds.data.map((x) => x.amount)).toEqual([half]);
    ctx.clock.real();
  });

  it("refunds a payment that arrives after the hold was released, and tells the customer", async () => {
    const h = await hold("16:00");
    await ctx.db.rpc("booking_release_hold", { p_booking: h.bookingId });
    const pi = await pay(h.totalCents);
    expect(await deliverCompleted(h.sessionId, pi.id)).toMatchObject({ handled: true });
    const refunds = await stripe.refunds.list({ payment_intent: pi.id });
    expect(refunds.data).toHaveLength(1);
    expect(refunds.data[0]).toMatchObject({ amount: h.totalCents, metadata: { kind: "booking_unconfirmed" } });
    expect(await bookingRow(h.bookingId)).toMatchObject({ status: "expired" });
    expect((await ctx.db.from("payments").select("id").eq("booking_id", h.bookingId)).data).toHaveLength(0);
    const audit = (await ctx.db.from("audit_log").select("after").eq("action", "booking.payment_refunded").eq("entity_id", h.bookingId).single()).data!;
    expect(audit.after).toMatchObject({ reason: "hold_expired", stripe_refund_id: refunds.data[0]!.id });
    expect(ctx.email.outbox.some((m) => m.template === "booking_payment_refunded" && m.entityId === `${h.bookingId}:refunded`)).toBe(true);
    // Stripe retrying the same delivery must not refund twice.
    await deliverCompleted(h.sessionId, pi.id);
    expect((await stripe.refunds.list({ payment_intent: pi.id })).data).toHaveLength(1);
  });
});
