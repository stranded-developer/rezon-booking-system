/**
 * Memberships paid for at the counter (D61): money into the till, a period of whole months, the
 * free minutes for them, and no Stripe subscription. Plus the daily expiry that ends them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupTestData, finishOpenWork, makeStaff, operatorToken, testContext, uniqueEmail, type TestContext, type TestStaff } from "./helpers.js";

let ctx: TestContext;
let cashier: TestStaff;
let owner: TestStaff;
let op: string;
let silverId: string;
let goldId: string;
const run = randomUUID().slice(0, 6);
const CRON_SECRET = `counter-${run}-0123456789abcdef0123456789`;

async function pos(path: string, opts: { method?: string; body?: unknown } = {}) {
  const r = await call(ctx, `/pos${path}`, { jwt: cashier.jwt, operatorToken: op, ...(opts.method ? { method: opts.method } : {}), ...(opts.body !== undefined ? { body: opts.body } : {}) });
  const renewed = r.headers.get("X-Operator-Token");
  if (renewed) op = renewed;
  return r;
}

const sell = (body: Record<string, unknown>) => pos("/memberships/counter", { body });

beforeAll(async () => {
  ctx = testContext({ CRON_SECRET });
  cashier = await makeStaff(ctx, "cashier", "1122", "counter-cashier");
  owner = await makeStaff(ctx, "superadmin", "3344", "counter-owner");
  op = await operatorToken(ctx, cashier);
  await finishOpenWork(ctx, owner.id);
  const { data: tiers } = await ctx.db.from("membership_tiers").select("id, name").in("name", ["Silver", "Gold"]);
  silverId = tiers!.find((t) => t.name === "Silver")!.id;
  goldId = tiers!.find((t) => t.name === "Gold")!.id;
});

afterAll(async () => {
  ctx.clock.real();
  await finishOpenWork(ctx, owner.id);
  await cleanupTestData(ctx);
});

describe("selling a membership at the counter", () => {
  it("needs an open till", async () => {
    const r = await sell({ name: `No Till ${run}`, email: uniqueEmail("notill"), tierId: silverId, months: 1, method: "cash" });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("no_shift");
  });

  it("takes the money, starts the membership and grants the free minutes", async () => {
    await call(ctx, "/pos/shifts/open", { jwt: cashier.jwt, operatorToken: op, body: { openingFloatCents: 20000 } });
    op = (await operatorToken(ctx, cashier)) ?? op;

    const email = uniqueEmail("counter-member");
    const r = await sell({ name: `Counter Member ${run}`, email, tierId: silverId, months: 3, method: "cash" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ newMember: true, amountCents: 30000, gstCents: 2727, minutesGranted: 180, tierName: "Silver" });
    expect(r.json.member).toMatchObject({ status: "active", eligible: true, balanceMinutes: 180 });
    expect(r.json.card.qr).toMatch(/^rg:m:/);

    // Three months from today, and nothing billed online.
    const { data: member } = await ctx.db.from("members").select("current_period_end, stripe_subscription_id").eq("id", r.json.memberId).single();
    expect(member!.stripe_subscription_id).toBeNull();
    const months = (new Date(member!.current_period_end!).getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(months).toBeGreaterThan(85);
    expect(months).toBeLessThan(95);

    // The money is on the till, as cash.
    const { data: payment } = await ctx.db.from("payments").select("method, amount_cents, gst_cents, shift_id").eq("member_id", r.json.memberId).single();
    expect(payment).toMatchObject({ method: "cash", amount_cents: 30000, gst_cents: 2727 });
    expect(payment!.shift_id).not.toBeNull();
    const { data: movement } = await ctx.db.from("cash_movements").select("amount_cents, kind").eq("payment_id", (await ctx.db.from("payments").select("id").eq("member_id", r.json.memberId).single()).data!.id).single();
    expect(movement).toMatchObject({ kind: "sale", amount_cents: 30000 });
  });

  it("refuses a length that isn't sold, and a tier that isn't active", async () => {
    const bad = await sell({ name: `Bad ${run}`, email: uniqueEmail("bad"), tierId: silverId, months: 2, method: "cash" });
    expect(bad.status).toBe(422);
    const noTier = await sell({ name: `Bad ${run}`, email: uniqueEmail("bad"), tierId: randomUUID(), months: 1, method: "cash" });
    expect(noTier.status).toBe(422);
  });

  it("renews the same member instead of creating a second one, and can change tier", async () => {
    const email = uniqueEmail("renewer");
    const first = await sell({ name: `Renewer ${run}`, email, tierId: silverId, months: 1, method: "cash" });
    expect(first.status).toBe(201);
    const firstEnd = new Date((await ctx.db.from("members").select("current_period_end").eq("id", first.json.memberId).single()).data!.current_period_end!);

    // Same email, so the same customer and the same membership.
    const second = await sell({ name: `Renewer ${run}`, email, tierId: goldId, months: 1, method: "card_terminal" });
    expect(second.status).toBe(201);
    expect(second.json.memberId).toBe(first.json.memberId);
    expect(second.json.newMember).toBe(false);
    expect(second.json.tierName).toBe("Gold");

    // The second month is added to the time already paid for, not started from today.
    const secondEnd = new Date((await ctx.db.from("members").select("current_period_end").eq("id", first.json.memberId).single()).data!.current_period_end!);
    expect(secondEnd.getTime()).toBeGreaterThan(firstEnd.getTime());

    // A card payment adds nothing to the cash drawer.
    const { data: payments } = await ctx.db.from("payments").select("id, method").eq("member_id", first.json.memberId);
    const cardPayment = payments!.find((p) => p.method === "card_terminal")!;
    const { count } = await ctx.db.from("cash_movements").select("id", { count: "exact", head: true }).eq("payment_id", cardPayment.id);
    expect(count).toBe(0);
  });

  it("refuses to sell over a membership that is billed online", async () => {
    const email = uniqueEmail("online");
    const { data: customer } = await ctx.db.from("customers").insert({ name: `Online ${run}`, email }).select("id").single();
    await ctx.db.from("members").insert({ customer_id: customer!.id, tier_id: silverId, status: "active", stripe_subscription_id: `sub_${run}` });

    const r = await sell({ customerId: customer!.id, tierId: silverId, months: 1, method: "cash" });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("stripe_billed");
  });

  it("cashiers can sell, but not without being signed in", async () => {
    const r = await call(ctx, "/pos/memberships/counter", { body: { name: "No Auth", email: uniqueEmail("noauth"), tierId: silverId, months: 1, method: "cash" } });
    expect(r.status).toBe(401);
  });
});

describe("when a counter membership runs out", () => {
  it("stops giving benefits at once, and the daily job ends it", async () => {
    const email = uniqueEmail("expiring");
    const sold = await sell({ name: `Expiring ${run}`, email, tierId: silverId, months: 1, method: "cash" });
    expect(sold.status).toBe(201);
    const memberId = sold.json.memberId as string;

    // Wind the membership back so its period is over.
    await ctx.db.from("members").update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq("id", memberId);

    // The counter sees it immediately, before any job has run.
    const scanned = await pos(`/memberships/${memberId}`);
    expect(scanned.json.member.eligible).toBe(false);
    expect(scanned.json.member.status).toBe("active");

    // The daily job then ends it properly.
    const cron = await call(ctx, "/cron/forfeit", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(cron.status).toBe(200);
    expect(cron.json.expired).toBeGreaterThanOrEqual(1);

    const { data: after } = await ctx.db.from("members").select("status, ended_at").eq("id", memberId).single();
    expect(after).toMatchObject({ status: "ended" });
    expect(after!.ended_at).not.toBeNull();
  });

  it("leaves a membership billed online for Stripe to end", async () => {
    const email = uniqueEmail("stripe-expiry");
    const { data: customer } = await ctx.db.from("customers").insert({ name: `Stripe ${run}`, email }).select("id").single();
    const { data: member } = await ctx.db
      .from("members")
      .insert({ customer_id: customer!.id, tier_id: silverId, status: "active", stripe_subscription_id: `sub_old_${run}`, current_period_end: new Date(Date.now() - 86_400_000).toISOString() })
      .select("id")
      .single();

    await call(ctx, "/cron/forfeit", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });

    const { data: after } = await ctx.db.from("members").select("status").eq("id", member!.id).single();
    expect(after!.status).toBe("active");

    // And they keep their benefits: a renewal webhook can arrive late, and Stripe decides when a
    // subscription really ends. Refusing them at the counter would turn a paying member away.
    const scanned = await pos(`/memberships/${member!.id}`);
    expect(scanned.json.member.eligible).toBe(true);
  });
});
