/**
 * Booking-site accounts against local Supabase (no Stripe): login linking, member pricing and free play online,
 * the account QR, account bookings, day-before reminders and back office booking cancellation.
 * Fixed clock: Monday 4 Mar 2030, 09:00 Sydney (AEDT, +11). Own resource type ($40/hr) per run.
 * Launch config assumed: Gold 10%, open 10:00–21:00, happy hour weekdays only.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { findMemberByQr } from "../src/services/lookup.js";
import { call, cleanupTestData, makeStaff, operatorToken, PASSWORD, signIn, testContext, type CallOptions, type TestContext, type TestStaff } from "./helpers.js";

const at = (hhmm: string, day = "2030-03-04") => `${day}T${hhmm}:00+11:00`;
const run = randomUUID().slice(0, 8);
const CRON_SECRET = `cron-${run}-0123456789abcdef0123456789`;
const SAT = "2030-03-09";

let ctx: TestContext;
let owner: TestStaff;
let cashier: TestStaff;
let ownerOp: string;
let cashierOp: string;
let typeId: string;
const resourceIds: string[] = [];
const userIds: string[] = [];
let memberId: string;
let memberEmail: string;
let memberJwt: string;
let fixedCode: string;

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const api = (path: string, opts: CallOptions = {}) => call(ctx, path, { ...opts, headers: { "x-forwarded-for": ip(), ...opts.headers } });
const me = (path: string, jwt: string, body?: unknown) => api(`/me${path}`, { jwt, ...(body !== undefined ? { body } : {}) });
const admin = async (path: string, body?: unknown, op = () => ownerOp, jwt = () => owner.jwt) => {
  const r = await call(ctx, `/admin${path}`, { jwt: jwt(), operatorToken: op(), ...(body !== undefined ? { body } : {}) });
  const renewed = r.headers.get("X-Operator-Token");
  if (renewed && op() === ownerOp) ownerOp = renewed;
  return r;
};
const balance = async () => (await ctx.db.from("member_balances").select("balance_minutes").eq("member_id", memberId).single()).data!.balance_minutes;
const request = (over: Record<string, unknown> = {}) => ({ resourceTypeId: typeId, date: SAT, startTime: "12:00", durationMinutes: 60, ...over });

async function makeUser(email: string, meta: Record<string, string> = {}) {
  const { data, error } = await ctx.db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: meta });
  if (error) throw error;
  userIds.push(data.user.id);
  return { id: data.user.id, jwt: await signIn(ctx, email) };
}

beforeAll(async () => {
  ctx = testContext({ CRON_SECRET });
  ctx.clock.set(at("09:00"));
  owner = await makeStaff(ctx, "superadmin", "2468", "acct-owner");
  cashier = await makeStaff(ctx, "cashier", "1357", "acct-cashier");
  ownerOp = await operatorToken(ctx, owner);
  cashierOp = await operatorToken(ctx, cashier);

  const { data: type, error } = await ctx.db.from("resource_types").insert({ key: `test_acct_${run}`, name: `Account Bay ${run}`, base_rate_cents: 4000, min_minutes: 15, sort: 992 }).select("id").single();
  if (error) throw error;
  typeId = type.id;
  const { data: resources, error: rError } = await ctx.db.from("resources").insert([{ resource_type_id: typeId, label: "Bay M", sort: 1 }, { resource_type_id: typeId, label: "Bay N", sort: 2 }]).select("id, sort");
  if (rError) throw rError;
  resourceIds.push(...resources.sort((a, b) => a.sort - b.sort).map((r) => r.id));

  // A member sold at the counter (no login yet), with 120 minutes of free play.
  memberEmail = `counter-member-${run}@raceground.test`;
  const { data: customer } = await ctx.db.from("customers").insert({ name: "Casey Counter", email: memberEmail, phone: "0400 555 000" }).select("id").single();
  const { data: gold } = await ctx.db.from("membership_tiers").select("id").eq("name", "Gold").single();
  const { data: member, error: mError } = await ctx.db.from("members").insert({ customer_id: customer!.id, tier_id: gold!.id, status: "active" }).select("id").single();
  if (mError) throw mError;
  memberId = member.id;
  await ctx.db.from("member_balance_ledger").insert({ member_id: memberId, delta_minutes: 120, kind: "grant", stripe_invoice_id: `in_acct_${run}` });

  const { data: code } = await ctx.db.from("referral_codes").insert({ discount_type: "fixed", discount_value: 100_000, max_uses: 10 }).select("code").single();
  fixedCode = code!.code;
}, 60_000);

afterAll(async () => {
  ctx.clock.real();
  await ctx.db.from("bookings").update({ status: "expired" }).in("resource_id", resourceIds).eq("status", "held");
  await ctx.db.from("resources").update({ active: false }).in("id", resourceIds);
  await ctx.db.from("resource_types").update({ active: false }).eq("id", typeId);
  await ctx.db.from("referral_codes").update({ active: false }).eq("code", fixedCode);
  for (const id of userIds) await ctx.db.auth.admin.deleteUser(id);
  await cleanupTestData(ctx);
});

describe("signing in", () => {
  it("needs a valid login, and refuses staff logins", async () => {
    expect((await api("/me")).status).toBe(401);
    expect((await api("/me", { jwt: "not-a-token" })).status).toBe(401);
    const staff = await api("/me", { jwt: owner.jwt });
    expect(staff.status).toBe(403);
    expect(staff.json.error.code).toBe("staff_account");
  });

  it("won't link a login whose email isn't confirmed", async () => {
    const email = `unconfirmed-${run}@raceground.test`;
    const user = await makeUser(email);
    const client = new pg.Client({ connectionString: inject("supabase").dbUrl });
    await client.connect();
    try {
      await client.query("update auth.users set email_confirmed_at = null where id = $1", [user.id]);
    } finally {
      await client.end();
    }
    const r = await api("/me", { jwt: user.jwt });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("email_unconfirmed");
    expect((await ctx.db.from("customers").select("id").eq("auth_user_id", user.id)).data).toHaveLength(0);
  });

  it("creates a customer for a brand-new account from the sign-up details", async () => {
    const email = `new-${run}@raceground.test`;
    const user = await makeUser(email, { name: "Nina New", phone: "0400 222 333" });
    const r = await api("/me", { jwt: user.jwt });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ customer: { name: "Nina New", email, phone: "0400 222 333" }, member: null, canManageBilling: false });
    expect((await api("/me/ledger", { jwt: user.jwt })).json.error.code).toBe("not_a_member");
  });

  it("links a counter-sold member when they sign up with the same email in any case", async () => {
    const user = await makeUser(memberEmail.toUpperCase(), { name: "Someone Else" });
    memberJwt = user.jwt;
    const r = await me("", memberJwt);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.customer.name).toBe("Casey Counter");
    expect(r.json.member).toMatchObject({ status: "active", eligible: true, tier: { name: "Gold", discountBp: 1000 }, balanceMinutes: 120, billedOnline: false });
  });
});

describe("member QR on the account", () => {
  let firstQr: string;

  it("gives an active member a QR that stays the same and works at the counter", async () => {
    firstQr = (await me("", memberJwt)).json.member.qr;
    expect(firstQr).toMatch(/^rg:m:[A-Za-z0-9_-]{43}$/);
    expect((await me("", memberJwt)).json.member.qr).toBe(firstQr);
    expect((await findMemberByQr(ctx.db, firstQr)).id).toBe(memberId);
  });

  it("prints that same QR when the cashier prints the member's card", async () => {
    const r = await call(ctx, `/pos/memberships/${memberId}/card`, { jwt: cashier.jwt, operatorToken: cashierOp, body: {} });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.qr).toBe(firstQr);
  });

  it("reissues: the new QR works and the old one stops", async () => {
    const r = await me("/qr/reissue", memberJwt, {});
    expect(r.status).toBe(200);
    expect(r.json.qr).not.toBe(firstQr);
    expect((await findMemberByQr(ctx.db, r.json.qr)).id).toBe(memberId);
    await expect(findMemberByQr(ctx.db, firstQr)).rejects.toMatchObject({ status: 404 });
    expect((await me("", memberJwt)).json.member.qr).toBe(r.json.qr);
    const audit = (await ctx.db.from("audit_log").select("actor_staff_id, reason").eq("action", "member.qr_reissue").eq("entity_id", memberId).order("created_at", { ascending: false }).limit(1).single()).data!;
    expect(audit).toEqual({ actor_staff_id: null, reason: "Reissued by the member" });
  });
});

describe("member pricing and free play online", () => {
  it("quotes with the member discount and free minutes, and refuses a referral code", async () => {
    const plain = await api("/public/quote", { jwt: memberJwt, body: request() });
    expect(plain.json.quote).toMatchObject({ totalCents: 3600, member: { tierName: "Gold" }, maxFreeMinutes: 60 });
    const free = await api("/public/quote", { jwt: memberJwt, body: request({ freeMinutes: 30 }) });
    expect(free.json.quote).toMatchObject({ totalCents: 1800 });
    const guest = await api("/public/quote", { body: request() });
    expect(guest.json.quote).toMatchObject({ totalCents: 4000, member: null });
    const both = await api("/public/quote", { jwt: memberJwt, body: request({ referralCode: fixedCode }) });
    expect(both.status).toBe(422);
    expect(both.json.error.code).toBe("member_and_referral");
    const tooMuch = await api("/public/quote", { jwt: memberJwt, body: request({ freeMinutes: 150, durationMinutes: 180 }) });
    expect(tooMuch.json.error.code).toBe("insufficient_balance");
  });

  let freeRef: string;

  it("books a fully free-play hour without a form or payment, and shows it in the account", async () => {
    const r = await api("/bookings/hold", { jwt: memberJwt, body: { ...request({ freeMinutes: 60 }), expectedTotalCents: 0, acceptTerms: true } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.status).toBe("confirmed");
    freeRef = r.json.ref;
    expect(await balance()).toBe(60);
    const row = (await ctx.db.from("bookings").select("member_id, free_minutes_used").eq("id", r.json.bookingId).single()).data!;
    expect(row).toEqual({ member_id: memberId, free_minutes_used: 60 });
    const list = await me("/bookings", memberJwt);
    expect(list.json.bookings.find((b: { ref: string }) => b.ref === freeRef)).toMatchObject({ status: "confirmed", freeMinutesUsed: 60, venueDate: "Sat 9 Mar 2030" });
    const one = await me(`/bookings/${freeRef}`, memberJwt);
    expect(one.json.booking.cancellation).toMatchObject({ allowed: true, rule: "full", returnMinutes: 60 });
    const ledger = await me("/ledger", memberJwt);
    expect(ledger.json.entries[0]).toMatchObject({ minutes: -60, kind: "use", bookingRef: freeRef });
  });

  it("keeps other accounts out of a member's booking", async () => {
    const stranger = await makeUser(`stranger-${run}@raceground.test`);
    expect((await me(`/bookings/${freeRef}`, stranger.jwt)).status).toBe(404);
    expect((await api(`/me/bookings/${freeRef}/cancel`, { jwt: stranger.jwt, body: { expectedRefundCents: 0 } })).status).toBe(404);
  });

  it("cancels from the account ≥ 24 h ahead and returns the minutes", async () => {
    const r = await api(`/me/bookings/${freeRef}/cancel`, { jwt: memberJwt, body: { expectedRefundCents: 0 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ minutesReturned: 60, refundCents: 0 });
    expect(await balance()).toBe(120);
  });

  it("treats a lapsed member as a guest: no discount, but their account details fill the booking", async () => {
    await ctx.db.from("members").update({ status: "past_due" }).eq("id", memberId);
    try {
      const q = await api("/public/quote", { jwt: memberJwt, body: request({ startTime: "15:00" }) });
      expect(q.json.quote).toMatchObject({ totalCents: 4000, member: null });
      expect(q.json.memberNotice).toMatchObject({ status: "past_due" });
      expect((await me("", memberJwt)).json.member).toMatchObject({ eligible: false, qr: null });
      expect((await me("/qr/reissue", memberJwt, {})).json.error.code).toBe("member_inactive");
      const r = await api("/bookings/hold", { jwt: memberJwt, body: { ...request({ startTime: "15:00", referralCode: fixedCode }), expectedTotalCents: 0, acceptTerms: true } });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      const row = (await ctx.db.from("bookings").select("member_id, customers(email)").eq("id", r.json.bookingId).single()).data!;
      expect(row.member_id).toBeNull();
      expect((row.customers as unknown as { email: string }).email).toBe(memberEmail);
    } finally {
      await ctx.db.from("members").update({ status: "active" }).eq("id", memberId);
    }
  });

  it("sends venue-managed members to the counter for billing changes", async () => {
    const { data: silver } = await ctx.db.from("membership_tiers").select("id").eq("name", "Silver").single();
    expect((await me("/membership/tier", memberJwt, { tierId: silver!.id })).json.error.code).toBe("not_billed");
    expect((await me("/membership/cancel", memberJwt, {})).json.error.code).toBe("not_billed");
    expect((await me("/portal", memberJwt, {})).json.error.code).toBe("not_billed");
  });
});

describe("day-before reminders", () => {
  it("emails tomorrow's confirmed bookings once, and nobody else", async () => {
    const tomorrow = await api("/bookings/hold", { jwt: memberJwt, body: { ...request({ date: "2030-03-05", startTime: "20:00", freeMinutes: 60 }), expectedTotalCents: 0, acceptTerms: true } });
    expect(tomorrow.status, JSON.stringify(tomorrow.json)).toBe(201);
    const later = await api("/bookings/hold", { jwt: memberJwt, body: { ...request({ date: "2030-03-06", startTime: "10:00", freeMinutes: 15, durationMinutes: 15 }), expectedTotalCents: 0, acceptTerms: true } });
    expect(later.status).toBe(201);
    const cancelled = await api("/bookings/hold", { jwt: memberJwt, body: { ...request({ date: "2030-03-05", startTime: "10:00", freeMinutes: 15, durationMinutes: 15 }), expectedTotalCents: 0, acceptTerms: true } });
    expect((await api(`/me/bookings/${cancelled.json.ref}/cancel`, { jwt: memberJwt, body: { expectedRefundCents: 0 } })).status).toBe(200);
    expect((await api("/cron/reminders", { method: "POST" })).status).toBe(401);
    const first = await api("/cron/reminders", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(first.status).toBe(200);
    expect(first.json.date).toBe("2030-03-05");
    const mine = ctx.email.outbox.filter((m) => m.template === "booking_reminder" && m.to === memberEmail);
    expect(mine.map((m) => m.entityId)).toEqual([`${tomorrow.json.bookingId}:reminder`]);
    expect(mine[0]!.text).toContain("Tue 5 Mar 2030, 20:00–21:00");
    await api("/cron/reminders", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(ctx.email.outbox.filter((m) => m.template === "booking_reminder" && m.to === memberEmail)).toHaveLength(1);
    // Clean up for the back office tests: cancel both through the account.
    for (const ref of [tomorrow.json.ref, later.json.ref]) await api(`/me/bookings/${ref}/cancel`, { jwt: memberJwt, body: { expectedRefundCents: 0 } });
  });
});

describe("back office bookings", () => {
  let booking: { bookingId: string; ref: string };

  beforeAll(async () => {
    const r = await api("/bookings/hold", { jwt: memberJwt, body: { ...request({ date: "2030-03-04", startTime: "11:00", freeMinutes: 60 }), expectedTotalCents: 0, acceptTerms: true } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    booking = r.json as typeof booking;
  });

  it("lists a day's bookings with the customer and member number, and can search", async () => {
    const r = await admin(`/bookings?date=2030-03-04`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const row = r.json.bookings.find((b: { ref: string }) => b.ref === booking.ref);
    expect(row).toMatchObject({ status: "confirmed", resource: "Bay M", venueStartTime: "11:00", customer: { name: "Casey Counter" }, payment: { method: "free", amountCents: 0 } });
    expect(row.memberNo).toMatch(/^RG-/);
    expect((await admin(`/bookings?date=2030-03-04&q=casey%20counter`)).json.bookings.some((b: { ref: string }) => b.ref === booking.ref)).toBe(true);
    expect((await admin(`/bookings?date=2030-03-04&q=nobody-${run}`)).json.bookings).toHaveLength(0);
    expect((await admin(`/bookings?date=2030-03-05`)).json.bookings.some((b: { ref: string }) => b.ref === booking.ref)).toBe(false);
  });

  it("is superadmin only", async () => {
    const r = await call(ctx, "/admin/bookings?date=2030-03-04", { jwt: cashier.jwt, operatorToken: cashierOp });
    expect(r.status).toBe(403);
  });

  it("under 2 hours needs a venue-fault cancel or a set refund, with a reason", async () => {
    ctx.clock.set(at("10:00"));
    const quote = await admin(`/bookings/${booking.bookingId}/cancel-quote`);
    expect(quote.json.quote).toMatchObject({ allowed: false, reason: "too_late" });
    const fault = await admin(`/bookings/${booking.bookingId}/cancel-quote?venueFault=true`);
    expect(fault.json.quote).toMatchObject({ allowed: true, rule: "venue", returnMinutes: 60 });
    expect((await admin(`/bookings/${booking.bookingId}/cancel`, { reason: "x" })).status).toBe(422);
    expect((await admin(`/bookings/${booking.bookingId}/cancel`, { reason: "Customer asked" })).json.error.code).toBe("too_late");
    expect((await admin(`/bookings/${booking.bookingId}/cancel`, { reason: "Goodwill", overrideRefundCents: 500 })).json.error.code).toBe("validation_failed");
  });

  it("cancels as the venue's fault: minutes back, customer emailed with the reason, audited", async () => {
    const r = await admin(`/bookings/${booking.bookingId}/cancel`, { reason: "Simulator broken", venueFault: true, expectedRefundCents: 0 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ rule: "venue", minutesReturned: 60, refundCents: 0 });
    expect(await balance()).toBe(120);
    const mail = ctx.email.outbox.find((m) => m.entityId === `${booking.bookingId}:cancelled`);
    expect(mail?.text).toContain("Simulator broken");
    const audit = (await ctx.db.from("audit_log").select("actor_staff_id, reason").eq("action", "booking.cancel").eq("entity_id", booking.bookingId).single()).data!;
    expect(audit).toEqual({ actor_staff_id: owner.id, reason: "Simulator broken" });
    ctx.clock.set(at("09:00"));
  });
});
