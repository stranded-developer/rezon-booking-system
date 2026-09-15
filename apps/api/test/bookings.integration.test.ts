/**
 * Public booking API against local Supabase on a fixed clock: Monday 11 Feb 2030, 09:00 Sydney (AEDT, +11).
 * Uses its own resource type ($40/hr, 15-minute minimum) so earlier runs never overlap.
 * Launch config assumed: open 10:00–21:00 every day, happy hour Mon–Fri 10:00–15:00 10% (all types).
 * Stripe is not called here: paid checkouts are covered by bookings-stripe.integration.test.ts.
 */
import { randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashBookingToken } from "../src/services/bookings.js";
import { call, testContext, type CallOptions, type TestContext } from "./helpers.js";

const at = (hhmm: string, day = "2030-02-11") => `${day}T${hhmm}:00+11:00`;
const run = randomUUID().slice(0, 8);
const WEBHOOK_SECRET = `whsec_test_${randomBytes(16).toString("hex")}`;
const CRON_SECRET = randomBytes(24).toString("hex");
const signer = new Stripe("sk_test_offline_signer_only");
/** Per run: guests are matched by phone, so a fixed number would reuse an earlier run's customer. */
const WES_PHONE = `04${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

let ctx: TestContext;
let noStripe: TestContext;
let typeId: string;
const resourceIds: string[] = [];
let fixedCode: string;
let tinyCode: string;

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const api = (path: string, opts: CallOptions = {}, c: TestContext = ctx) =>
  call(c, path, { ...opts, headers: { "x-forwarded-for": randomIp(), ...opts.headers } });

const holdBody = (over: Record<string, unknown> = {}) => ({
  resourceTypeId: typeId,
  date: "2030-02-16", // Saturday: no happy hour
  startTime: "12:00",
  durationMinutes: 60,
  customer: { name: "Bea Booker", email: `bea-${run}@raceground.test` },
  expectedTotalCents: 4000,
  acceptTerms: true,
  ...over,
});

async function deliver(event: object) {
  const payload = JSON.stringify(event);
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await ctx.app.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: payload });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** A paid-looking hold made straight in the database (no Stripe), for webhook tests. */
async function directHold(startTime: string, totalCents = 4000, gstCents = 364) {
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await ctx.db.rpc("booking_hold", {
    p: {
      resourceId: resourceIds[1],
      startsAt: at(startTime, "2030-02-17"),
      endsAt: at(`${String(Number(startTime.slice(0, 2)) + 1).padStart(2, "0")}:00`, "2030-02-17"),
      now: ctx.clock.now().toISOString(),
      customer: { name: "Webhook Wes", phone: WES_PHONE },
      pricing: { explanation: ["test"] },
      totalCents,
      gstCents,
      cancelTokenHash: hashBookingToken(token),
    },
  });
  if (error) throw error;
  return { id: data.id, ref: data.ref, token };
}

const checkoutEvent = (type: string, booking: { id: string; ref: string; token: string }, over: Record<string, unknown> = {}) => ({
  id: `evt_test_${randomUUID()}`,
  object: "event",
  type,
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  data: {
    object: {
      id: `cs_test_${randomUUID().replace(/-/g, "")}`,
      object: "checkout.session",
      mode: "payment",
      status: type === "checkout.session.expired" ? "expired" : "complete",
      payment_status: type === "checkout.session.expired" ? "unpaid" : "paid",
      currency: "aud",
      amount_total: 4000,
      payment_intent: `pi_test_${randomUUID().replace(/-/g, "")}`,
      customer_details: { email: `wes-${run}@raceground.test` },
      metadata: { booking_id: booking.id, booking_ref: booking.ref, booking_token: booking.token },
      ...over,
    },
  },
});

beforeAll(async () => {
  ctx = testContext({ STRIPE_SECRET_KEY: "sk_test_offline_never_called", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, CRON_SECRET });
  noStripe = testContext();
  ctx.clock.set(at("09:00"));
  noStripe.clock.set(at("09:00"));
  const { data: type, error } = await ctx.db
    .from("resource_types")
    .insert({ key: `test_bk_${run}`, name: `Test Bay ${run}`, base_rate_cents: 4000, min_minutes: 15, sort: 990 })
    .select("id")
    .single();
  if (error) throw error;
  typeId = type.id;
  const { data: resources, error: resourceError } = await ctx.db
    .from("resources")
    .insert([
      { resource_type_id: typeId, label: "Bay A", sort: 1 },
      { resource_type_id: typeId, label: "Bay B", sort: 2 },
    ])
    .select("id, sort");
  if (resourceError) throw resourceError;
  resourceIds.push(...resources.sort((x, y) => x.sort - y.sort).map((r) => r.id));
  const { data: codes, error: codeError } = await ctx.db
    .from("referral_codes")
    .insert([
      { discount_type: "fixed", discount_value: 10_000, max_uses: 3 },
      { discount_type: "percent", discount_value: 1000, max_uses: 1 },
    ])
    .select("code, discount_type");
  if (codeError) throw codeError;
  fixedCode = codes!.find((c) => c.discount_type === "fixed")!.code;
  tinyCode = codes!.find((c) => c.discount_type === "percent")!.code;
});

afterAll(async () => {
  await ctx.db.from("bookings").update({ status: "expired" }).in("resource_id", resourceIds).eq("status", "held");
  await ctx.db.from("resources").update({ active: false }).in("id", resourceIds);
  await ctx.db.from("resource_types").update({ active: false }).eq("id", typeId);
  await ctx.db.from("referral_codes").update({ active: false }).in("code", [fixedCode, tinyCode]);
});

describe("config and availability", () => {
  it("publishes venue config with the test type, its resources and the venue date", async () => {
    const r = await api("/public/config");
    expect(r.status).toBe(200);
    expect(r.json.today).toBe("2030-02-11");
    expect(r.json.timeZone).toBe("Australia/Sydney");
    expect(r.json.bookingWindowDays).toBe(7);
    const type = r.json.resourceTypes.find((t: { id: string }) => t.id === typeId);
    expect(type).toMatchObject({ baseRateCents: 4000, minMinutes: 15, resources: [{ label: "Bay A" }, { label: "Bay B" }] });
    expect(JSON.stringify(r.json)).not.toMatch(/stripe_price_id|pin_hash/);
  });

  it("offers 15-minute starts from the cutoff to close, with lengths up to close", async () => {
    ctx.clock.set(at("10:10"));
    const r = await api(`/public/availability?type=${typeId}&date=2030-02-11`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ open: "10:00", close: "21:00", closed: false, inWindow: true });
    // now 10:10 + 30 min cutoff → first start 10:45; last start 20:45 (15-minute minimum)
    expect(r.json.slots[0]).toMatchObject({ time: "10:45", availableResources: 2, maxMinutes: 615 });
    expect(r.json.slots.at(-1)).toMatchObject({ time: "20:45", maxMinutes: 15 });
    expect(r.json.slots).toHaveLength(41);
    ctx.clock.set(at("09:00"));
  });

  it("accepts the type key too, and shows nothing outside the 7-day window", async () => {
    const key = await api(`/public/availability?type=test_bk_${run}&date=2030-02-18`);
    expect(key.json.inWindow).toBe(true);
    expect(key.json.slots.length).toBeGreaterThan(0);
    const late = await api(`/public/availability?type=${typeId}&date=2030-02-19`);
    expect(late.json).toMatchObject({ inWindow: false, slots: [] });
    const past = await api(`/public/availability?type=${typeId}&date=2030-02-10`);
    expect(past.json).toMatchObject({ inWindow: false, slots: [] });
  });

  it("rejects unknown types and bad dates", async () => {
    expect((await api(`/public/availability?type=nope_${run}&date=2030-02-11`)).status).toBe(404);
    expect((await api(`/public/availability?type=${typeId}&date=11-02-2030`)).status).toBe(422);
  });
});

describe("quotes and referral codes", () => {
  it("prices a Saturday hour at the base rate and a weekday hour with happy hour", async () => {
    const sat = await api("/public/quote", { body: { resourceTypeId: typeId, date: "2030-02-16", startTime: "12:00", durationMinutes: 60 } });
    expect(sat.status, JSON.stringify(sat.json)).toBe(200);
    expect(sat.json.quote).toMatchObject({ totalCents: 4000, gstCents: 364, discountCents: 0, startsAt: "2030-02-16T01:00:00.000Z" });
    const mon = await api("/public/quote", { body: { resourceTypeId: typeId, date: "2030-02-11", startTime: "12:00", durationMinutes: 60 } });
    expect(mon.json.quote.totalCents).toBe(3600);
  });

  it("applies a referral code and refuses odd durations", async () => {
    const r = await api("/public/quote", { body: { resourceTypeId: typeId, date: "2030-02-16", startTime: "12:00", durationMinutes: 60, referralCode: tinyCode.toLowerCase() } });
    expect(r.json.quote).toMatchObject({ totalCents: 3600, referral: { code: tinyCode } });
    const odd = await api("/public/quote", { body: { resourceTypeId: typeId, date: "2030-02-16", startTime: "12:00", durationMinutes: 50 } });
    expect(odd.status).toBe(422);
  });

  it("checks referral codes without saying why a made-up one failed beyond not found", async () => {
    expect((await api("/public/referral/check", { body: { code: tinyCode } })).json).toMatchObject({ valid: true, type: "percent", value: 1000 });
    expect((await api("/public/referral/check", { body: { code: "ZZZZZZ" } })).json).toEqual({ valid: false, reason: "not_found" });
  });

  it("counts a live online hold against the code's last use", async () => {
    const { data: code } = await ctx.db.from("referral_codes").select("id").eq("code", tinyCode).single();
    const { data: held, error } = await ctx.db.rpc("booking_hold", {
      p: {
        resourceId: resourceIds[0],
        startsAt: at("18:00", "2030-02-12"),
        endsAt: at("19:00", "2030-02-12"),
        now: ctx.clock.now().toISOString(),
        customer: { name: "Rhea Referral", email: `rhea-${run}@raceground.test` },
        referralCodeId: code!.id,
        pricing: {},
        totalCents: 3600,
        gstCents: 327,
        cancelTokenHash: "b".repeat(64),
      },
    });
    if (error) throw error;
    expect((await api("/public/referral/check", { body: { code: tinyCode } })).json).toMatchObject({ valid: false, reason: "used_up" });
    const q = await api("/public/quote", { body: { resourceTypeId: typeId, date: "2030-02-16", startTime: "12:00", durationMinutes: 60, referralCode: tinyCode } });
    expect(q.status).toBe(409);
    expect(q.json.error.code).toBe("referral_invalid");
    await ctx.db.rpc("booking_release_hold", { p_booking: held.id });
    expect((await api("/public/referral/check", { body: { code: tinyCode } })).json.valid).toBe(true);
  });

  it("rate limits referral checks per client", async () => {
    const ip = randomIp();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await call(ctx, "/public/referral/check", { body: { code: "ZZZZZZ" }, headers: { "x-forwarded-for": ip } })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    const blocked = await call(ctx, "/public/referral/check", { body: { code: "ZZZZZZ" }, headers: { "x-forwarded-for": ip } });
    expect(statuses[10]).toBe(429);
    expect(blocked.json.error.code).toBe("rate_limited");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await api("/public/referral/check", { body: { code: "ZZZZZZ" } })).status).toBe(200);
  });
});

describe("holds", () => {
  it("refuses a paid hold when online payments aren't configured, leaving nothing held", async () => {
    const r = await api("/bookings/hold", { body: holdBody({ startTime: "15:00" }) }, noStripe);
    expect(r.status).toBe(503);
    const { count } = await ctx.db.from("bookings").select("id", { count: "exact", head: true }).in("resource_id", resourceIds).eq("status", "held");
    expect(count).toBe(0);
  });

  it("asks the customer to re-check when the price changed", async () => {
    const r = await api("/bookings/hold", { body: holdBody({ expectedTotalCents: 3000 }) });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatchObject({ code: "quote_changed", details: { quote: { totalCents: 4000 } } });
  });

  it("validates the form: terms, contact details", async () => {
    expect((await api("/bookings/hold", { body: holdBody({ acceptTerms: false }) })).status).toBe(422);
    expect((await api("/bookings/hold", { body: holdBody({ customer: { name: "No Contact" } }) })).status).toBe(422);
  });

  let freeBooking: { ref: string; token: string; bookingId: string };

  it("confirms a $0 booking straight away and emails the confirmation with a calendar invite", async () => {
    const r = await api("/bookings/hold", { body: holdBody({ referralCode: fixedCode, expectedTotalCents: 0 }) });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json).toMatchObject({ status: "confirmed" });
    freeBooking = r.json as typeof freeBooking;
    const row = (await ctx.db.from("bookings").select("status, resource_id, total_cents").eq("id", freeBooking.bookingId).single()).data!;
    expect(row).toEqual({ status: "confirmed", resource_id: resourceIds[0], total_cents: 0 });
    const mail = ctx.email.outbox.find((m) => m.template === "booking_confirmed" && m.entityId === `${freeBooking.bookingId}:confirmed`);
    expect(mail?.to).toBe(`bea-${run}@raceground.test`);
    expect(mail?.text).toContain(freeBooking.ref);
    expect(mail?.text).toContain(`/booking/${freeBooking.ref}?token=`);
    expect(mail?.text).toContain("Sat 16 Feb 2030, 12:00–13:00");
    const ics = mail?.attachments?.[0];
    expect(ics?.filename).toBe(`raceground-${freeBooking.ref}.ics`);
    expect(ics?.content).toContain("DTSTART:20300216T010000Z");
    expect(ics?.content).toContain("DTEND:20300216T020000Z");
    expect(ics?.content.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it("puts the next customer for the same time on the next free resource, then says it's taken", async () => {
    const second = await api("/bookings/hold", { body: holdBody({ referralCode: fixedCode, expectedTotalCents: 0 }) });
    expect(second.status, JSON.stringify(second.json)).toBe(201);
    expect((await ctx.db.from("bookings").select("resource_id").eq("id", second.json.bookingId).single()).data!.resource_id).toBe(resourceIds[1]);
    const third = await api("/bookings/hold", { body: holdBody({ startTime: "12:30", durationMinutes: 30, referralCode: fixedCode, expectedTotalCents: 0 }) });
    expect(third.status).toBe(409);
    expect(third.json.error.code).toBe("slot_taken");
    const grid = await api(`/public/availability?type=${typeId}&date=2030-02-16`);
    const noon = grid.json.slots.find((s: { time: string }) => s.time === "11:00");
    expect(noon).toMatchObject({ availableResources: 2, maxMinutes: 60 });
    expect(grid.json.slots.find((s: { time: string }) => s.time === "12:00").availableResources).toBe(0);
  });

  it("shows the booking only with its token", async () => {
    const ok = await api(`/bookings/${freeBooking.ref.toLowerCase()}?token=${freeBooking.token}`);
    expect(ok.status).toBe(200);
    expect(ok.json.booking).toMatchObject({
      ref: freeBooking.ref,
      status: "confirmed",
      resource: "Bay A",
      venueDate: "Sat 16 Feb 2030",
      venueStartTime: "12:00",
      checkInCode: `rg:b:${freeBooking.ref}`,
      cancellation: { allowed: true, rule: "full", refundCents: 0 },
    });
    expect(JSON.stringify(ok.json)).not.toMatch(/cancel_token_hash|email/);
    const wrong = await api(`/bookings/${freeBooking.ref}?token=${randomBytes(32).toString("base64url")}`);
    expect(wrong.status).toBe(404);
  });

  it("refuses a customer cancel within 2 hours, then cancels ≥ 24 h ahead with an email", async () => {
    ctx.clock.set(at("10:30", "2030-02-16"));
    const late = await api(`/bookings/${freeBooking.ref}/cancel`, { body: { token: freeBooking.token, expectedRefundCents: 0 } });
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe("too_late");
    ctx.clock.set(at("09:00"));
    const r = await api(`/bookings/${freeBooking.ref}/cancel`, { body: { token: freeBooking.token, expectedRefundCents: 0 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ refundCents: 0, rule: "full" });
    expect(ctx.email.outbox.some((m) => m.template === "booking_cancelled" && m.entityId === `${freeBooking.bookingId}:cancelled`)).toBe(true);
    const again = await api(`/bookings/${freeBooking.ref}/cancel`, { body: { token: freeBooking.token, expectedRefundCents: 0 } });
    expect(again.json.error.code).toBe("not_cancellable");
  });
});

describe("Stripe webhooks for bookings", () => {
  it("confirms a paid hold once, records the payment and emails a link", async () => {
    const booking = await directHold("12:00");
    const event = checkoutEvent("checkout.session.completed", booking);
    const first = await deliver(event);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json).toMatchObject({ handled: true, duplicate: false });
    const row = (await ctx.db.from("bookings").select("status, stripe_payment_intent_id, customers(email)").eq("id", booking.id).single()).data!;
    expect(row.status).toBe("confirmed");
    expect(row.stripe_payment_intent_id).toBe(event.data.object.payment_intent);
    expect((row.customers as unknown as { email: string }).email).toBe(`wes-${run}@raceground.test`);
    const payments = (await ctx.db.from("payments").select("method, amount_cents").eq("booking_id", booking.id)).data!;
    expect(payments).toEqual([{ method: "stripe", amount_cents: 4000 }]);
    const mail = ctx.email.outbox.find((m) => m.entityId === `${booking.id}:confirmed`);
    expect(mail?.text).toContain(`token=${encodeURIComponent(booking.token)}`);
    expect((await deliver(event)).json).toMatchObject({ duplicate: true });
    const redelivered = await deliver({ ...event, id: `evt_test_${randomUUID()}` });
    expect(redelivered.status).toBe(200);
    expect((await ctx.db.from("payments").select("id").eq("booking_id", booking.id)).data).toHaveLength(1);
  });

  it("refuses to record a booking payment in another currency", async () => {
    const booking = await directHold("14:00");
    const r = await deliver(checkoutEvent("checkout.session.completed", booking, { currency: "idr" }));
    expect(r.status).toBe(500);
    expect((await ctx.db.from("bookings").select("status").eq("id", booking.id).single()).data!.status).toBe("held");
  });

  it("releases the slot when Stripe Checkout expires", async () => {
    const booking = await directHold("16:00");
    const r = await deliver(checkoutEvent("checkout.session.expired", booking));
    expect(r.json).toMatchObject({ handled: true });
    expect((await ctx.db.from("bookings").select("status").eq("id", booking.id).single()).data!.status).toBe("expired");
  });

  it("waits for the money: an unpaid completed checkout doesn't confirm", async () => {
    const booking = await directHold("19:00");
    const r = await deliver(checkoutEvent("checkout.session.completed", booking, { payment_status: "unpaid" }));
    expect(r.json).toMatchObject({ handled: false });
    expect((await ctx.db.from("bookings").select("status").eq("id", booking.id).single()).data!.status).toBe("held");
    await ctx.db.rpc("booking_release_hold", { p_booking: booking.id });
  });

  it("ignores checkouts that aren't bookings", async () => {
    const r = await deliver(checkoutEvent("checkout.session.completed", { id: "", ref: "", token: "" }, { metadata: {} }));
    expect(r.json).toMatchObject({ handled: false });
  });
});

describe("availability with holds", () => {
  it("a hold blocks its time until it expires, even before the cleanup job runs", async () => {
    const booking = await directHold("20:00");
    const slotAt = async () =>
      (await api(`/public/availability?type=${typeId}&date=2030-02-17`)).json.slots.find((s: { time: string }) => s.time === "20:00").resourceMaxMinutes[resourceIds[1]!];
    expect(await slotAt()).toBe(0);
    ctx.clock.set(at("09:41"));
    expect(await slotAt()).toBe(60);
    ctx.clock.set(at("09:00"));
    await ctx.db.rpc("booking_release_hold", { p_booking: booking.id });
  });
});

describe("hold cleanup job", () => {
  it("needs the cron secret and expires stale holds", async () => {
    const booking = await directHold("18:00");
    expect((await api("/cron/holds", { method: "POST" })).status).toBe(401);
    ctx.clock.set(at("09:41"));
    const r = await api("/cron/holds", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(r.status).toBe(200);
    expect(r.json.expired).toBeGreaterThanOrEqual(1);
    expect((await ctx.db.from("bookings").select("status").eq("id", booking.id).single()).data!.status).toBe("expired");
    ctx.clock.set(at("09:00"));
  });
});
