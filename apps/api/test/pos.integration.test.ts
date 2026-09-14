/**
 * A full POS day against local Supabase on a fixed clock: Wednesday 16 Jan 2030, Sydney (AEDT, +11).
 * Launch configuration assumed: billiard $30/hr, sim $60/hr, happy hour Mon–Fri 10:00–15:00 10%,
 * Gold 10%, 15-minute minimum, open 10:00–21:00. `pnpm db:reset` restores it.
 *
 * Tests in this file run in order and share state (one till, one day).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashQrToken } from "../src/services/lookup.js";
import {
  call,
  cleanupTestData,
  finishOpenWork,
  makeStaff,
  operatorToken,
  testContext,
  type TestContext,
  type TestStaff,
} from "./helpers.js";

const at = (hhmm: string, day = "2030-01-16") => `${day}T${hhmm}:00+11:00`;

let ctx: TestContext;
let owner: TestStaff;
let cashier: TestStaff;
let cashierOp: string;
let ownerOp: string;
const run = randomUUID().slice(0, 6);
const res: Record<"t1" | "t2" | "t3" | "sim", string> = { t1: "", t2: "", t3: "", sim: "" };
let gold: { id: string; token: string; email: string };
let lapsed: { id: string };
let guestId: string;
let fixedCode: string;
let percentCode: string;
const created = { resources: [] as string[] };
/** Card payments taken on the till, tracked independently of the API to check the shift report. */
let cardTotal = 0;

/** Operator tokens slide on every request; keep the freshest. */
async function pos(path: string, opts: { method?: string; body?: unknown; as?: "cashier" | "owner" } = {}) {
  const asOwner = opts.as === "owner";
  const r = await call(ctx, `/pos${path}`, {
    jwt: cashier.jwt,
    operatorToken: asOwner ? ownerOp : cashierOp,
    ...(opts.method ? { method: opts.method } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  const renewed = r.headers.get("X-Operator-Token");
  if (renewed) {
    if (asOwner) ownerOp = renewed;
    else cashierOp = renewed;
  }
  return r;
}

async function tile(resourceId: string) {
  const floor = await pos("/floor");
  expect(floor.status).toBe(200);
  return floor.json.tiles.find((t: { resourceId: string }) => t.resourceId === resourceId);
}

async function openWalkIn(resourceId: string, time: string) {
  ctx.clock.set(at(time));
  const r = await pos("/sessions", { body: { resourceId } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.session.id as string;
}

async function quote(sessionId: string, time: string, body: Record<string, unknown> = {}) {
  ctx.clock.set(at(time));
  return pos(`/sessions/${sessionId}/quote`, { body });
}

beforeAll(async () => {
  ctx = testContext();
  owner = await makeStaff(ctx, "superadmin", "2468", "pos-owner");
  cashier = await makeStaff(ctx, "cashier", "1357", "pos-cashier");
  await finishOpenWork(ctx, owner.id);
  cashierOp = await operatorToken(ctx, cashier);
  ownerOp = await operatorToken(ctx, cashier, owner);

  const { data: types } = await ctx.db.from("resource_types").select("id, key");
  const typeId = (key: string) => types!.find((t) => t.key === key)!.id;
  const { data: resources, error } = await ctx.db
    .from("resources")
    .insert([
      { resource_type_id: typeId("billiard"), label: `API ${run} T1`, sort: 950 },
      { resource_type_id: typeId("billiard"), label: `API ${run} T2`, sort: 951 },
      { resource_type_id: typeId("billiard"), label: `API ${run} T3`, sort: 952 },
      { resource_type_id: typeId("sim"), label: `API ${run} Sim`, sort: 953 },
    ])
    .select("id, label");
  if (error) throw error;
  const byLabel = (suffix: string) => resources!.find((r) => r.label.endsWith(suffix))!.id;
  res.t1 = byLabel("T1");
  res.t2 = byLabel("T2");
  res.t3 = byLabel("T3");
  res.sim = byLabel("Sim");
  created.resources.push(...resources!.map((r) => r.id));

  const { data: tiers } = await ctx.db.from("membership_tiers").select("id, name");
  const token = randomBytes(32).toString("base64url");
  const email = `gold-${run}@raceground.test`;
  const { data: customers } = await ctx.db
    .from("customers")
    .insert([
      { name: `Gold ${run}`, email },
      { name: `Lapsed ${run}`, email: `lapsed-${run}@raceground.test` },
      { name: `Guest ${run}`, phone: `04${run.replace(/\D/g, "1").padEnd(8, "0").slice(0, 8)}` },
    ])
    .select("id, name");
  const cust = (prefix: string) => customers!.find((c) => c.name.startsWith(prefix))!.id;
  const { data: members } = await ctx.db
    .from("members")
    .insert([
      { customer_id: cust("Gold"), tier_id: tiers!.find((t) => t.name === "Gold")!.id, status: "active", qr_token_hash: hashQrToken(token) },
      { customer_id: cust("Lapsed"), tier_id: tiers!.find((t) => t.name === "Gold")!.id, status: "past_due" },
    ])
    .select("id, customer_id");
  gold = { id: members!.find((m) => m.customer_id === cust("Gold"))!.id, token, email };
  lapsed = { id: members!.find((m) => m.customer_id === cust("Lapsed"))!.id };
  guestId = cust("Guest");
  await ctx.db.from("member_balance_ledger").insert({ member_id: gold.id, delta_minutes: 60, kind: "grant", stripe_invoice_id: `in_test_${run}` });

  const { data: codes } = await ctx.db
    .from("referral_codes")
    .insert([
      { discount_type: "fixed", discount_value: 500, max_uses: 1 },
      { discount_type: "percent", discount_value: 2000, max_uses: 5 },
    ])
    .select("code, discount_type");
  fixedCode = codes!.find((c) => c.discount_type === "fixed")!.code;
  percentCode = codes!.find((c) => c.discount_type === "percent")!.code;
});

afterAll(async () => {
  ctx.clock.real();
  await finishOpenWork(ctx, owner.id);
  await ctx.db.from("resources").update({ active: false }).in("id", created.resources);
  await cleanupTestData(ctx);
});

describe("access", () => {
  it("POS operations need a PIN-verified operator", async () => {
    const r = await call(ctx, "/pos/floor", { jwt: cashier.jwt });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("operator_required");
  });

  it("config returns the venue time zone and launch resource types", async () => {
    const r = await pos("/config");
    expect(r.status).toBe(200);
    expect(r.json.timeZone).toBe("Australia/Sydney");
    expect(r.json.resourceTypes.map((t: { key: string }) => t.key)).toEqual(["billiard", "sim", "vr"]);
    expect(r.json.happyHours[0]).toMatchObject({ start_time: "10:00", end_time: "15:00", discount_bp: 1000 });
    expect(Array.isArray(r.json.rateBands)).toBe(true);
  });
});

describe("till", () => {
  it("starts with no open shift, and money cannot be taken without one", async () => {
    expect((await pos("/shifts/current")).json.shift).toBeNull();
    const sessionId = await openWalkIn(res.sim, "10:00");
    const q = await quote(sessionId, "11:00");
    const r = await pos(`/sessions/${sessionId}/close`, {
      body: { closedAt: q.json.quote.closedAt, tender: { method: "cash", tenderedCents: 10_000 } },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("no_open_shift");
    const v = await pos(`/sessions/${sessionId}/void`, { as: "owner", body: { reason: "set up test" } });
    expect(v.status).toBe(200);
  });

  it("opens once with a $200 float", async () => {
    const r = await pos("/shifts/open", { body: { openingFloatCents: 20_000 } });
    expect(r.status).toBe(201);
    expect(r.json.shift.cash.expectedCents).toBe(20_000);
    const again = await pos("/shifts/open", { as: "owner", body: { openingFloatCents: 0 } });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("shift_already_open");
  });
});

let memberSession: string;
let memberQuoteClosedAt: string;

describe("walk-in with a member", () => {
  it("refuses walk-ins outside opening hours", async () => {
    ctx.clock.set(at("09:30"));
    const r = await pos("/sessions", { body: { resourceId: res.t1 } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("outside_opening_hours");
  });

  it("opens a table and shows it in use on the floor", async () => {
    memberSession = await openWalkIn(res.t1, "14:30");
    const t = await tile(res.t1);
    expect(t).toMatchObject({ state: "in_use", session: { id: memberSession, kind: "walk_in", openedBy: "Test pos-cashier" } });
    const again = await pos("/sessions", { body: { resourceId: res.t1 } });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("resource_in_use");
  });

  it("finds the member by QR scan and by search", async () => {
    const scan = await pos("/members/scan", { body: { code: `rg:m:${gold.token}` } });
    expect(scan.status).toBe(200);
    expect(scan.json.member).toMatchObject({ id: gold.id, tierName: "Gold", discountBp: 1000, balanceMinutes: 60, eligible: true });
    expect((await pos("/members/scan", { body: { code: "hello" } })).status).toBe(422);
    expect((await pos("/members/scan", { body: { code: `rg:m:${randomBytes(32).toString("base64url")}` } })).status).toBe(404);
    expect((await pos("/members/search?q=go")).status).toBe(422);
    const search = await pos(`/members/search?q=gold-${run}`);
    expect(search.json.members.map((m: { id: string }) => m.id)).toEqual([gold.id]);
  });

  it("quotes 14:30–15:30 across the end of happy hour with Gold 10%", async () => {
    const q = await quote(memberSession, "15:30", { memberId: gold.id });
    expect(q.status).toBe(200);
    const quoteBody = q.json.quote;
    expect(quoteBody).toMatchObject({ mode: "walk_in", subtotalCents: 2850, discountCents: 285, totalCents: 2565, gstCents: 233, maxFreeMinutes: 60 });
    expect(quoteBody.explanation).toEqual([
      "14:30–15:00  30 min @ $30.00/hr − Happy Hour 10% = $27.00/hr  $13.50",
      "15:00–15:30  30 min @ $30.00/hr  $15.00",
      "Subtotal  $28.50",
      "Gold member 10%  −$2.85",
      "Total (incl. GST $2.33)  $25.65",
    ]);
    memberQuoteClosedAt = quoteBody.closedAt;
  });

  it("refuses a quote that has gone stale, and a total that changed since the quote", async () => {
    ctx.clock.set(at("15:33"));
    const stale = await pos(`/sessions/${memberSession}/close`, {
      body: { memberId: gold.id, closedAt: memberQuoteClosedAt, tender: { method: "cash", tenderedCents: 3000 } },
    });
    expect(stale.status).toBe(422);
    expect(stale.json.error.code).toBe("quote_expired");

    ctx.clock.set(at("15:31"));
    const changed = await pos(`/sessions/${memberSession}/close`, {
      body: { closedAt: memberQuoteClosedAt, expectedTotalCents: 2565, tender: { method: "cash", tenderedCents: 3000 } },
    });
    expect(changed.status).toBe(409);
    expect(changed.json.error).toMatchObject({ code: "quote_changed", details: { totalCents: 2850 } });
  });

  it("closes for cash within the quote window at the frozen price, with change and a receipt", async () => {
    ctx.clock.set(at("15:31"));
    const r = await pos(`/sessions/${memberSession}/close`, {
      body: { memberId: gold.id, closedAt: memberQuoteClosedAt, expectedTotalCents: 2565, tender: { method: "cash", tenderedCents: 3000 } },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.changeCents).toBe(435);
    expect(r.json.receipt).toMatchObject({
      title: "Receipt",
      businessName: "Raceground",
      totalCents: 2565,
      gstCents: 233,
      subtotalCents: 2850,
      discountCents: 285,
      paymentMethod: "cash",
      tenderedCents: 3000,
      changeCents: 435,
      servedBy: "Test pos-cashier",
      openedAt: "2030-01-16 14:30",
      closedAt: "2030-01-16 15:30",
      voided: false,
    });
    expect(r.json.receipt.receiptNo).toBeGreaterThan(0);
    expect(r.json.receipt.memberNo).toMatch(/^RG-\d{6}$/);

    const reprint = await pos(`/sessions/${memberSession}/receipt`);
    expect(reprint.json.receipt).toEqual(r.json.receipt);
    expect((await tile(res.t1)).state).toBe("free");
  });

  it("refuses to close the same session twice", async () => {
    const r = await pos(`/sessions/${memberSession}/close`, {
      body: { closedAt: memberQuoteClosedAt, tender: { method: "cash", tenderedCents: 3000 } },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("session_not_open");
  });
});

describe("referral codes and member rules", () => {
  let s1: string;

  it("applies a $5 code after happy hour and uses it up", async () => {
    s1 = await openWalkIn(res.t2, "10:00");
    const q = await quote(s1, "11:00", { referralCode: fixedCode.toLowerCase() });
    expect(q.json.quote).toMatchObject({ subtotalCents: 2700, discountCents: 500, totalCents: 2200 });
    const r = await pos(`/sessions/${s1}/close`, {
      body: { referralCode: fixedCode, closedAt: q.json.quote.closedAt, tender: { method: "card_terminal", externalRef: "CBA-001" } },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.receipt.paymentMethod).toBe("card_terminal");
    cardTotal += 2200;

    const lookup = await pos(`/referrals/rg:r:${fixedCode}`);
    expect(lookup.json.referral).toMatchObject({ usesCount: 1, maxUses: 1, usable: false, reason: "used_up" });
  });

  it("refuses a used-up code, member + referral together, and a lapsed member", async () => {
    const s2 = await openWalkIn(res.t2, "11:05");
    const used = await quote(s2, "11:30", { referralCode: fixedCode });
    expect(used.status).toBe(409);
    expect(used.json.error).toMatchObject({ code: "referral_invalid", details: { reason: "used_up" } });

    const both = await quote(s2, "11:30", { memberId: gold.id, referralCode: percentCode });
    expect(both.status).toBe(422);
    expect(both.json.error.code).toBe("member_and_referral");

    const lapsedQuote = await quote(s2, "11:30", { memberId: lapsed.id });
    expect(lapsedQuote.status).toBe(409);
    expect(lapsedQuote.json.error).toMatchObject({ code: "member_inactive", details: { status: "past_due" } });

    expect((await pos(`/sessions/${s2}/void`, { as: "owner", body: { reason: "test cleanup" } })).status).toBe(200);
  });

  it("only one of two simultaneous closes can take the last use of a code", async () => {
    const { data } = await ctx.db.from("referral_codes").insert({ discount_type: "fixed", discount_value: 100, max_uses: 1 }).select("code").single();
    const a = await openWalkIn(res.t2, "12:00");
    const b = await openWalkIn(res.t3, "12:00");
    ctx.clock.set(at("12:30"));
    const [qa, qb] = await Promise.all([quote(a, "12:30", { referralCode: data!.code }), quote(b, "12:30", { referralCode: data!.code })]);
    expect([qa.status, qb.status]).toEqual([200, 200]);
    const closeWith = (id: string, closedAt: string) =>
      pos(`/sessions/${id}/close`, { body: { referralCode: data!.code, closedAt, tender: { method: "card_terminal" } } });
    const results = await Promise.all([closeWith(a, qa.json.quote.closedAt), closeWith(b, qb.json.quote.closedAt)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.json.error.code).toBe("referral_invalid");
    const loserId = results[0]!.status === 409 ? a : b;
    const { data: stillOpen } = await ctx.db.from("sessions").select("status").eq("id", loserId).single();
    expect(stillOpen!.status).toBe("open");
    // Winner: 30 min in happy hour @ $27/hr = $13.50, minus the $1 code.
    cardTotal += 1250;
    expect((await pos(`/sessions/${loserId}/void`, { as: "owner", body: { reason: "test cleanup" } })).status).toBe(200);
  });

  it("two simultaneous closes of the same session: exactly one succeeds", async () => {
    const s = await openWalkIn(res.t2, "13:00");
    const q = await quote(s, "13:30");
    const results = await Promise.all(
      [1, 2].map(() => pos(`/sessions/${s}/close`, { body: { closedAt: q.json.quote.closedAt, tender: { method: "card_terminal" } } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { count } = await ctx.db.from("payments").select("id", { count: "exact", head: true }).eq("session_id", s);
    expect(count).toBe(1);
    cardTotal += 1350; // 30 min in happy hour @ $27/hr
  });
});


describe("free play", () => {
  it("covers a whole sim hour with 60 free minutes, then refuses more than the balance", async () => {
    const s = await openWalkIn(res.sim, "16:00");
    const q = await quote(s, "17:00", { memberId: gold.id, freeMinutes: 60 });
    expect(q.json.quote).toMatchObject({ totalCents: 0, maxFreeMinutes: 60 });
    expect(q.json.quote.pricing).toMatchObject({ freeMinutes: 60, paidMinutes: 0 });
    const r = await pos(`/sessions/${s}/close`, {
      body: { memberId: gold.id, freeMinutes: 60, closedAt: q.json.quote.closedAt, tender: { method: "free" } },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.receipt).toMatchObject({ totalCents: 0, paymentMethod: "free" });

    const scan = await pos("/members/scan", { body: { code: `rg:m:${gold.token}` } });
    expect(scan.json.member.balanceMinutes).toBe(0);

    const s2 = await openWalkIn(res.sim, "17:05");
    const more = await quote(s2, "17:30", { memberId: gold.id, freeMinutes: 10 });
    expect(more.status).toBe(422);
    expect(more.json.error.code).toBe("insufficient_balance");
    expect((await pos(`/sessions/${s2}/void`, { as: "owner", body: { reason: "test cleanup" } })).status).toBe(200);
  });

  it("refuses 'free' as tender when money is owed", async () => {
    const s = await openWalkIn(res.sim, "18:00");
    const q = await quote(s, "18:30");
    const r = await pos(`/sessions/${s}/close`, { body: { closedAt: q.json.quote.closedAt, tender: { method: "free" } } });
    expect(r.status).toBe(422);
    expect((await pos(`/sessions/${s}/void`, { as: "owner", body: { reason: "test cleanup" } })).status).toBe(200);
  });
});

describe("price overrides", () => {
  let s: string;
  let closedAt: string;

  it("a cashier needs a superadmin's PIN to override", async () => {
    s = await openWalkIn(res.t1, "15:40");
    const q = await quote(s, "16:40");
    expect(q.json.quote.totalCents).toBe(3000);
    closedAt = q.json.quote.closedAt;
    const body = (override: Record<string, unknown>) => ({ closedAt, tender: { method: "cash", tenderedCents: 2000 }, override });

    const none = await pos(`/sessions/${s}/close`, { body: body({ totalCents: 2000, reason: "cue broken" }) });
    expect(none.status).toBe(403);
    expect(none.json.error.code).toBe("approval_required");

    const wrongPin = await pos(`/sessions/${s}/close`, {
      body: body({ totalCents: 2000, reason: "cue broken", approver: { staffId: owner.id, pin: "0000" } }),
    });
    expect(wrongPin.status).toBe(401);

    const cashierApprover = await pos(`/sessions/${s}/close`, {
      body: body({ totalCents: 2000, reason: "cue broken", approver: { staffId: cashier.id, pin: cashier.pin } }),
    });
    expect(cashierApprover.status).toBe(403);

    const ok = await pos(`/sessions/${s}/close`, {
      body: body({ totalCents: 2000, reason: "cue broken", approver: { staffId: owner.id, pin: owner.pin } }),
    });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.receipt).toMatchObject({ totalCents: 2000, gstCents: 182, override: { originalCents: 3000, reason: "cue broken" } });

    const { data: o } = await ctx.db.from("price_overrides").select("original_cents, new_cents, requested_by, approved_by").eq("session_id", s).single();
    expect(o).toEqual({ original_cents: 3000, new_cents: 2000, requested_by: cashier.id, approved_by: owner.id });
  });

  it("a superadmin operator approves their own override", async () => {
    const s2 = await openWalkIn(res.t1, "17:00");
    const q = await quote(s2, "17:30");
    const r = await pos(`/sessions/${s2}/close`, {
      as: "owner",
      body: { closedAt: q.json.quote.closedAt, tender: { method: "card_terminal" }, override: { totalCents: 1000, reason: "regular" } },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { data: o } = await ctx.db.from("price_overrides").select("approved_by").eq("session_id", s2).single();
    expect(o!.approved_by).toBe(owner.id);
    cardTotal += 1000; // $15.00 overridden to $10.00
  });
});

describe("voids", () => {
  it("only a superadmin can void, and voiding a cash sale refunds it from the till", async () => {
    const byCashier = await pos(`/sessions/${memberSession}/void`, { body: { reason: "customer complaint" } });
    expect(byCashier.status).toBe(403);
    const r = await pos(`/sessions/${memberSession}/void`, { as: "owner", body: { reason: "customer complaint" } });
    expect(r.status).toBe(200);
    expect(r.json.result).toMatchObject({ refundCents: 2565, refundMethod: "cash" });
    const receipt = await pos(`/sessions/${memberSession}/receipt`);
    expect(receipt.json.receipt.voided).toBe(true);
  });
});

describe("bookings", () => {
  let overstayBooking: string;
  let prepaidBooking: string;
  let noShowBooking: string;

  beforeAll(async () => {
    const { data, error } = await ctx.db
      .from("bookings")
      .insert([
        { resource_id: res.t3, customer_id: guestId, period: `[${at("16:00")},${at("17:00")})`, status: "confirmed", total_cents: 3000, gst_cents: 273, pricing_snapshot: {} },
        { resource_id: res.t3, customer_id: guestId, period: `[${at("18:00")},${at("19:00")})`, status: "confirmed", total_cents: 3000, gst_cents: 273, pricing_snapshot: {} },
        { resource_id: res.t1, customer_id: guestId, period: `[${at("19:00")},${at("20:00")})`, status: "confirmed", total_cents: 3000, gst_cents: 273, pricing_snapshot: {} },
        { resource_id: res.t2, customer_id: guestId, period: `[${at("20:00")},${at("20:30")})`, status: "confirmed", total_cents: 1500, gst_cents: 136, pricing_snapshot: {} },
      ])
      .select("id, period, resource_id");
    if (error) throw error;
    overstayBooking = data.find((b) => b.resource_id === res.t3 && String(b.period).includes("05:00:00"))!.id;
    prepaidBooking = data.find((b) => b.resource_id === res.t3 && String(b.period).includes("07:00:00"))!.id;
    noShowBooking = data.find((b) => b.resource_id === res.t1)!.id;
  });

  it("shows upcoming and awaiting-arrival bookings on the floor and in today's list", async () => {
    ctx.clock.set(at("15:50"));
    const before = await tile(res.t3);
    expect(before).toMatchObject({ state: "free", minutesToNextBooking: 10, nextBooking: { id: overstayBooking } });
    ctx.clock.set(at("16:05"));
    const waiting = await tile(res.t3);
    expect(waiting).toMatchObject({ state: "awaiting_arrival", currentBooking: { id: overstayBooking } });
    expect(waiting.noShowAvailableAt).toBe(new Date(at("16:15")).toISOString());
    const list = await pos(`/bookings/today?q=${encodeURIComponent(`guest ${run}`)}`);
    expect(list.json.bookings.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining([overstayBooking, prepaidBooking, noShowBooking]));
  });

  it("checks in and goes overdue, but playing past the booking is never charged (D48)", async () => {
    ctx.clock.set(at("16:05"));
    const arrive = await pos(`/bookings/${overstayBooking}/arrive`, { body: {} });
    expect(arrive.status).toBe(201);
    const sessionId = arrive.json.session.id;
    expect((await tile(res.t3)).state).toBe("booking");
    ctx.clock.set(at("17:10"));
    expect((await tile(res.t3)).state).toBe("overdue");

    // Even with a member and a referral code offered, a booked session has nothing to charge.
    const q = await quote(sessionId, "17:10", { memberId: gold.id, referralCode: percentCode });
    expect(q.status, JSON.stringify(q.json)).toBe(200);
    expect(q.json.quote).toMatchObject({ mode: "prepaid", totalCents: 0, pricing: null, member: null, referral: null, bookingEndsAt: new Date(at("17:00")).toISOString() });
    const r = await pos(`/sessions/${sessionId}/close`, { body: { closedAt: q.json.quote.closedAt, tender: { method: "free" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { count } = await ctx.db.from("payments").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
    expect(count).toBe(0);
    const { data: code } = await ctx.db.from("referral_codes").select("uses_count").eq("code", percentCode).single();
    expect(code!.uses_count).toBe(0);
    const { data: b } = await ctx.db.from("bookings").select("status").eq("id", overstayBooking).single();
    expect(b!.status).toBe("completed");
  });

  it("a booking that ends on time has nothing to pay and no payment row", async () => {
    ctx.clock.set(at("17:55"));
    const arrive = await pos(`/bookings/${prepaidBooking}/arrive`, { body: {} });
    expect(arrive.status).toBe(201);
    const q = await quote(arrive.json.session.id, "18:50");
    expect(q.json.quote).toMatchObject({ mode: "prepaid", totalCents: 0, pricing: null });
    const r = await pos(`/sessions/${arrive.json.session.id}/close`, { body: { closedAt: q.json.quote.closedAt, tender: { method: "free" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { count } = await ctx.db.from("payments").select("id", { count: "exact", head: true }).eq("session_id", arrive.json.session.id);
    expect(count).toBe(0);
  });

  it("marks a no-show only after the 15-minute hold", async () => {
    ctx.clock.set(at("19:10"));
    const early = await pos(`/bookings/${noShowBooking}/no-show`, { body: {} });
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("no_show_too_early");
    ctx.clock.set(at("19:15"));
    const ok = await pos(`/bookings/${noShowBooking}/no-show`, { body: {} });
    expect(ok.status).toBe(200);
    expect(ok.json.booking.status).toBe("no_show");
    expect((await tile(res.t1)).state).toBe("free");
  });

  it("warns when a walk-in is opened before a booking", async () => {
    ctx.clock.set(at("19:20"));
    const r = await pos("/sessions", { body: { resourceId: res.t2 } });
    expect(r.status).toBe(201);
    expect(r.json.warning).toContain("free for 40 min");
    ctx.clock.set(at("19:52"));
    expect((await tile(res.t2)).bookingWarning).toBe(true);
    expect((await pos(`/sessions/${r.json.session.id}/void`, { as: "owner", body: { reason: "test cleanup" } })).status).toBe(200);
  });
});

describe("closing the till", () => {
  it("records a paid-out and refuses to close while a session is open", async () => {
    const out = await pos("/shifts/current/movements", { body: { kind: "paid_out", amountCents: 500, reason: "cleaning supplies" } });
    expect(out.status).toBe(201);
    const s = await openWalkIn(res.sim, "20:00");
    const refused = await pos("/shifts/current/close", { body: { countedCashCents: 0, terminalCardTotalCents: 0 } });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("sessions_open");
    expect((await pos(`/sessions/${s}/void`, { as: "owner", body: { reason: "test cleanup" } })).status).toBe(200);
  });

  it("closes with exact counts, and the report adds up", async () => {
    // Cash: float 20000 + member sale 2565 + override sale 2000 − void refund 2565 − paid out 500.
    const expectedCash = 20_000 + 2565 + 2000 - 2565 - 500;
    const current = await pos("/shifts/current");
    expect(current.json.shift.cash.expectedCents).toBe(expectedCash);
    expect(current.json.shift.card.posTotalCents).toBe(cardTotal);

    const r = await pos("/shifts/current/close", { body: { countedCashCents: expectedCash, terminalCardTotalCents: cardTotal } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const report = r.json.report;
    expect(report.shift).toMatchObject({ flagged: false, openedBy: "Test pos-cashier", closedBy: "Test pos-cashier" });
    expect(report.cash).toMatchObject({
      openingFloatCents: 20_000,
      salesCents: 4565,
      refundsCents: 2565,
      paidOutCents: 500,
      expectedCents: expectedCash,
      countedCents: expectedCash,
      varianceCents: 0,
    });
    expect(report.card).toMatchObject({ posTotalCents: cardTotal, terminalTotalCents: cardTotal, varianceCents: 0 });
    expect(report.refundsCents).toBe(2565);
    expect(report.discounts.referralCents).toBe(500 + 100);
    expect(report.discounts.overrideCents).toBe(1000 + 500);
    expect(report.freeMinutesUsed).toBe(60);
    expect(report.sessionsVoided).toBe(1);
    expect((await pos("/shifts/current")).json.shift).toBeNull();
  });
});
