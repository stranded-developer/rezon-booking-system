/**
 * Walk-in packages at the counter (D115), on a fixed clock: Wednesday 23 Jan 2030, Sydney (AEDT, +11).
 *
 * Like pos.integration, this file brings its own table type, packages, promotions and member price,
 * so the owner can change every real price without a number here moving. Tests run in order and
 * share one till.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupTestData, finishOpenWork, makeStaff, operatorToken, testContext, useOpeningHours, type TestContext, type TestStaff } from "./helpers.js";

const at = (hhmm: string) => `2030-01-23T${hhmm}:00+11:00`;
const run = randomUUID().slice(0, 6);

let ctx: TestContext;
let owner: TestStaff;
let cashier: TestStaff;
let cashierOp: string;
let ownerOp: string;
let restoreHours: () => Promise<void>;
const res = { t1: "", t2: "", t3: "", sim: "" };
const pkg = { m30: "", m60: "", m120: "", sim60: "", online: "" };
let studentPromo: string;
let gold: string;
let fixedCode: string;
const created = { types: [] as string[], resources: [] as string[], experiences: [] as string[] };

async function pos(path: string, opts: { body?: unknown; as?: "owner" } = {}) {
  const asOwner = opts.as === "owner";
  const r = await call(ctx, `/pos${path}`, { jwt: cashier.jwt, operatorToken: asOwner ? ownerOp : cashierOp, ...(opts.body !== undefined ? { body: opts.body } : {}) });
  const renewed = r.headers.get("X-Operator-Token");
  if (renewed) {
    if (asOwner) ownerOp = renewed;
    else cashierOp = renewed;
  }
  return r;
}

const quote = (time: string, body: Record<string, unknown>) => {
  ctx.clock.set(at(time));
  return pos("/packages/quote", { body });
};

async function tile(resourceId: string) {
  const floor = await pos("/floor");
  return floor.json.tiles.find((t: { resourceId: string }) => t.resourceId === resourceId);
}

beforeAll(async () => {
  ctx = testContext();
  owner = await makeStaff(ctx, "superadmin", "2468", "pkg-owner");
  cashier = await makeStaff(ctx, "cashier", "1357", "pkg-cashier");
  await finishOpenWork(ctx, owner.id);
  cashierOp = await operatorToken(ctx, cashier);
  ownerOp = await operatorToken(ctx, cashier, owner);

  const { data: types, error } = await ctx.db
    .from("resource_types")
    .insert([
      { key: `test_pkg_tbl_${run}`, name: `Pkg Table ${run}`, base_rate_cents: 3000, min_minutes: 15, sort: 960 },
      { key: `test_pkg_sim_${run}`, name: `Pkg Sim ${run}`, base_rate_cents: 6000, min_minutes: 15, sort: 961 },
    ])
    .select("id, key");
  if (error) throw error;
  const tbl = types.find((t) => t.key.includes("tbl"))!.id;
  const sim = types.find((t) => t.key.includes("sim"))!.id;
  created.types.push(tbl, sim);

  const { data: resources } = await ctx.db
    .from("resources")
    .insert([
      { resource_type_id: tbl, label: `Pkg ${run} T1`, sort: 960 },
      { resource_type_id: tbl, label: `Pkg ${run} T2`, sort: 961 },
      { resource_type_id: tbl, label: `Pkg ${run} T3`, sort: 962 },
      { resource_type_id: sim, label: `Pkg ${run} Sim`, sort: 963 },
    ])
    .select("id, label");
  const byLabel = (s: string) => resources!.find((r) => r.label.endsWith(s))!.id;
  Object.assign(res, { t1: byLabel("T1"), t2: byLabel("T2"), t3: byLabel("T3"), sim: byLabel("Sim") });
  created.resources.push(...resources!.map((r) => r.id));

  // The owner's example (D115): 1 hour $30, 2 hours $55. Counter only.
  const { data: exps } = await ctx.db
    .from("experiences")
    .insert([
      { key: `pkg_${run}_30`, resource_type_id: tbl, name: "30 minutes", minutes: 30, price_cents: 15_00, online: false, at_counter: true },
      { key: `pkg_${run}_60`, resource_type_id: tbl, name: "1 hour", minutes: 60, price_cents: 30_00, online: false, at_counter: true },
      { key: `pkg_${run}_120`, resource_type_id: tbl, name: "2 hours", minutes: 120, price_cents: 55_00, online: false, at_counter: true },
      { key: `pkg_${run}_sim60`, resource_type_id: sim, name: "Sim hour", minutes: 60, price_cents: 58_00, online: true, at_counter: true },
      { key: `pkg_${run}_online`, resource_type_id: sim, name: "Online only", minutes: 30, price_cents: 35_00, online: true, at_counter: false },
    ])
    .select("id, key");
  const exp = (suffix: string) => exps!.find((e) => e.key === `pkg_${run}_${suffix}`)!.id;
  Object.assign(pkg, { m30: exp("30"), m60: exp("60"), m120: exp("120"), sim60: exp("sim60"), online: exp("online") });
  created.experiences.push(...exps!.map((e) => e.id));

  const { data: promos } = await ctx.db
    .from("experience_promos")
    .insert([
      { experience_id: pkg.m60, name: "Happy Hour", days_of_week: [1, 2, 3, 4, 5], start_time: "12:00", end_time: "15:00", price_cents: 25_00, claimed: false },
      { experience_id: pkg.m60, name: "Student", days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "10:00", end_time: "21:00", price_cents: 27_00, claimed: true },
    ])
    .select("id, name");
  studentPromo = promos!.find((p) => p.name === "Student")!.id;

  const { data: tiers } = await ctx.db.from("membership_tiers").select("id, name");
  const goldTier = tiers!.find((t) => t.name === "Gold")!.id;
  await ctx.db.from("experience_member_prices").insert({ experience_id: pkg.m60, tier_id: goldTier, price_cents: 24_00 });
  const { data: customer } = await ctx.db.from("customers").insert({ name: `Pkg Gold ${run}`, email: `pkg-gold-${run}@raceground.test` }).select("id").single();
  const { data: member } = await ctx.db.from("members").insert({ customer_id: customer!.id, tier_id: goldTier, status: "active" }).select("id").single();
  gold = member!.id;
  await ctx.db.from("member_balance_ledger").insert({ member_id: gold, delta_minutes: 60, kind: "grant", stripe_invoice_id: `in_pkg_${run}` });
  const { data: code } = await ctx.db.from("referral_codes").insert({ discount_type: "fixed", discount_value: 500, max_uses: 1 }).select("code").single();
  fixedCode = code!.code;
  await ctx.db.from("bookings").insert({
    resource_id: res.t2,
    customer_id: customer!.id,
    period: `[${at("17:00")},${at("18:00")})`,
    status: "confirmed",
    total_cents: 3000,
    gst_cents: 273,
    pricing_snapshot: {},
  });
  restoreHours = await useOpeningHours(ctx);
});

afterAll(async () => {
  await restoreHours?.();
  ctx.clock.real();
  await finishOpenWork(ctx, owner.id);
  await ctx.db.from("experiences").update({ active: false }).in("id", created.experiences);
  await ctx.db.from("resources").update({ active: false }).in("id", created.resources);
  await ctx.db.from("resource_types").update({ active: false }).in("id", created.types);
  await cleanupTestData(ctx);
});

describe("which packages are sold where", () => {
  it("the till lists counter packages by kind of table; the website lists online ones only", async () => {
    const config = await pos("/config");
    expect(config.status).toBe(200);
    const ids = config.json.packages.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([pkg.m30, pkg.m60, pkg.m120, pkg.sim60]));
    expect(ids).not.toContain(pkg.online);
    expect(config.json.packages.find((p: { id: string }) => p.id === pkg.m120)).toMatchObject({ name: "2 hours", minutes: 120, priceCents: 55_00, resourceTypeId: created.types[0] });

    const site = await call(ctx, "/public/config");
    const keys = site.json.experiences.map((e: { key: string }) => e.key);
    expect(keys).toContain(`pkg_${run}_sim60`);
    expect(keys).not.toContain(`pkg_${run}_60`);
    const booked = await call(ctx, "/public/quote", { body: { experienceKey: `pkg_${run}_60`, date: "2030-01-24", startTime: "16:00" } });
    expect(booked.status).toBe(404);
    const counterOnlyOnline = await quote("16:00", { resourceId: res.sim, experienceId: pkg.online });
    expect(counterOnlyOnline.status).toBe(404);
  });
});

describe("pricing a package", () => {
  it("is the package's flat price, ending its length from now", async () => {
    const q = await quote("16:00", { resourceId: res.t1, experienceId: pkg.m120 });
    expect(q.status, JSON.stringify(q.json)).toBe(200);
    expect(q.json.quote).toMatchObject({ name: "2 hours", minutes: 120, totalCents: 55_00, gstCents: 500, endsAt: new Date(at("18:00")).toISOString() });
  });

  it("takes the promotions, member price, free play and referral exactly as online", async () => {
    expect((await quote("13:00", { resourceId: res.t1, experienceId: pkg.m60 })).json.quote.totalCents).toBe(25_00);
    const plain = await quote("16:00", { resourceId: res.t1, experienceId: pkg.m60 });
    expect(plain.json.quote.totalCents).toBe(30_00);
    expect(plain.json.quote.claimablePromos).toEqual([{ id: studentPromo, name: "Student", priceCents: 27_00 }]);
    expect((await quote("16:00", { resourceId: res.t1, experienceId: pkg.m60, claimedPromoIds: [studentPromo] })).json.quote.totalCents).toBe(27_00);
    const member = await quote("16:00", { resourceId: res.t1, experienceId: pkg.m60, memberId: gold });
    expect(member.json.quote).toMatchObject({ totalCents: 24_00, maxFreeMinutes: 60, freeStepMinutes: 30 });
    expect((await quote("16:00", { resourceId: res.t1, experienceId: pkg.m60, memberId: gold, freeMinutes: 30 })).json.quote.totalCents).toBe(12_00);
    expect((await quote("16:00", { resourceId: res.t1, experienceId: pkg.m60, referralCode: fixedCode })).json.quote.totalCents).toBe(25_00);
  });

  it("refuses free play in part-sessions, a package for another kind of table, and member + referral", async () => {
    expect((await quote("16:00", { resourceId: res.t1, experienceId: pkg.m60, memberId: gold, freeMinutes: 15 })).status).toBe(422);
    expect((await quote("16:00", { resourceId: res.t1, experienceId: pkg.sim60 })).json.error.code).toBe("package_unavailable");
    expect((await quote("16:00", { resourceId: res.t1, experienceId: pkg.m60, memberId: gold, referralCode: fixedCode })).json.error.code).toBe("member_and_referral");
  });
});

describe("selling a package", () => {
  let cashSession: string;
  let memberSession: string;

  it("needs an open till to take money", async () => {
    ctx.clock.set(at("16:00"));
    const r = await pos("/packages", { body: { resourceId: res.t1, experienceId: pkg.m60, expectedTotalCents: 30_00, tender: { method: "card_terminal" } } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("no_open_shift");
    expect((await tile(res.t1)).state).toBe("free");
    expect((await pos("/shifts/open", { body: { openingFloatCents: 10_000 } })).status).toBe(201);
  });

  it("refuses a price that changed since the till showed it", async () => {
    ctx.clock.set(at("15:00"));
    const r = await pos("/packages", { body: { resourceId: res.t1, experienceId: pkg.m60, expectedTotalCents: 25_00, tender: { method: "card_terminal" } } });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: { code: "quote_changed", details: { totalCents: 30_00 } } });
  });

  it("takes cash, starts the table with its end time, and gives a receipt straight away", async () => {
    ctx.clock.set(at("16:00"));
    const r = await pos("/packages", { body: { resourceId: res.t1, experienceId: pkg.m60, expectedTotalCents: 30_00, tender: { method: "cash", tenderedCents: 50_00 } } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json).toMatchObject({ changeCents: 20_00, endsAt: new Date(at("17:00")).toISOString() });
    expect(r.json.receipt).toMatchObject({ totalCents: 30_00, gstCents: 273, paymentMethod: "cash", tenderedCents: 50_00, changeCents: 20_00, voided: false });
    expect(r.json.receipt.receiptNo).toEqual(expect.any(Number));
    cashSession = r.json.sessionId;

    expect(await tile(res.t1)).toMatchObject({ state: "in_use", session: { kind: "walk_in", packageName: "1 hour", bookingEndsAt: new Date(at("17:00")).toISOString() } });
    const { data: payments } = await ctx.db.from("payments").select("method, amount_cents, shift_id").eq("session_id", cashSession);
    expect(payments).toEqual([{ method: "cash", amount_cents: 30_00, shift_id: expect.any(String) }]);
    const { data: cash } = await ctx.db.from("cash_movements").select("kind, amount_cents").eq("payment_id", (await ctx.db.from("payments").select("id").eq("session_id", cashSession).single()).data!.id);
    expect(cash).toEqual([{ kind: "sale", amount_cents: 30_00 }]);
  });

  it("refuses a table already in use, a package that runs into a booking or past closing", async () => {
    ctx.clock.set(at("16:10"));
    const busy = await pos("/packages", { body: { resourceId: res.t1, experienceId: pkg.m30, expectedTotalCents: 15_00, tender: { method: "card_terminal" } } });
    expect(busy.json.error.code).toBe("resource_in_use");
    ctx.clock.set(at("16:30"));
    const clash = await pos("/packages", { body: { resourceId: res.t2, experienceId: pkg.m60, expectedTotalCents: 30_00, tender: { method: "card_terminal" } } });
    expect(clash.json.error.code).toBe("package_clashes_booking");
    expect((await tile(res.t2)).state).toBe("free");
    ctx.clock.set(at("19:30"));
    const late = await pos("/packages", { body: { resourceId: res.t3, experienceId: pkg.m120, expectedTotalCents: 55_00, tender: { method: "card_terminal" } } });
    expect(late.json.error.code).toBe("package_too_long");
    ctx.clock.set(at("16:30"));
    const fits = await pos("/packages", { body: { resourceId: res.t2, experienceId: pkg.m30, expectedTotalCents: 15_00, tender: { method: "card_terminal", externalRef: "T-1" } } });
    expect(fits.status, JSON.stringify(fits.json)).toBe(201);
    expect(fits.json.endsAt).toBe(new Date(at("17:00")).toISOString());
  });

  it("a member pays their price less free play, which comes off their balance", async () => {
    ctx.clock.set(at("16:00"));
    const r = await pos("/packages", { body: { resourceId: res.t3, experienceId: pkg.m60, memberId: gold, freeMinutes: 30, expectedTotalCents: 12_00, tender: { method: "card_terminal" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    memberSession = r.json.sessionId;
    expect(r.json.receipt).toMatchObject({ totalCents: 12_00, memberNo: expect.any(String) });
    const { data: ledger } = await ctx.db.from("member_balance_ledger").select("delta_minutes, kind").eq("session_id", memberSession);
    expect(ledger).toEqual([{ delta_minutes: -30, kind: "use" }]);
  });

  it("goes overdue at its end, and closing it takes nothing more, however late (like a booking)", async () => {
    ctx.clock.set(at("17:10"));
    expect(await tile(res.t1)).toMatchObject({ state: "overdue" });
    const q = await pos(`/sessions/${cashSession}/quote`, { body: {} });
    expect(q.json.quote).toMatchObject({ mode: "prepaid", totalCents: 0, explanation: ["Package paid at the start, nothing more to pay"], bookingEndsAt: new Date(at("17:00")).toISOString() });
    const closed = await pos(`/sessions/${cashSession}/close`, { body: { closedAt: q.json.quote.closedAt, expectedTotalCents: 0, tender: { method: "free" } } });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json.receipt).toMatchObject({ totalCents: 30_00, paymentMethod: "cash" });
    const { data: s } = await ctx.db.from("sessions").select("status, total_cents, gst_cents").eq("id", cashSession).single();
    expect(s).toEqual({ status: "closed", total_cents: 30_00, gst_cents: 273 });
    const { count } = await ctx.db.from("payments").select("id", { count: "exact", head: true }).eq("session_id", cashSession);
    expect(count).toBe(1);
  });

  it("voiding an open package refunds it and gives the free play back", async () => {
    ctx.clock.set(at("16:20"));
    const r = await pos(`/sessions/${memberSession}/void`, { as: "owner", body: { reason: "sold on the wrong table" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.result).toMatchObject({ refundCents: 12_00, refundMethod: "card_terminal", minutesReturned: 30 });
    const { data: balance } = await ctx.db.from("member_balances").select("balance_minutes").eq("member_id", gold).single();
    expect(balance!.balance_minutes).toBe(60);
    expect((await pos(`/sessions/${memberSession}/receipt`)).json.receipt.voided).toBe(true);
  });

  it("the shift report counts what was taken for packages", async () => {
    ctx.clock.set(at("17:15"));
    const open = await ctx.db.from("sessions").select("id").eq("status", "open").in("resource_id", created.resources);
    for (const s of open.data ?? []) {
      const q = await pos(`/sessions/${s.id}/quote`, { body: {} });
      await pos(`/sessions/${s.id}/close`, { body: { closedAt: q.json.quote.closedAt, expectedTotalCents: 0, tender: { method: "free" } } });
    }
    const shift = (await pos("/shifts/current")).json.shift;
    expect(shift.cash.salesCents).toBe(30_00);
    expect(shift.card.posTotalCents).toBe(15_00 + 12_00 - 12_00);
    expect(shift.grossCents).toBe(30_00 + 15_00 + 12_00);
    expect(shift.refundsCents).toBe(12_00);
    const closed = await pos("/shifts/current/close", { body: { countedCashCents: shift.cash.expectedCents, terminalCardTotalCents: shift.card.posTotalCents } });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json.report.shift.flagged).toBe(false);
  });
});
