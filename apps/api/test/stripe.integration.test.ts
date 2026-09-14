/**
 * Membership billing against a real Stripe account in TEST mode (key from apps/api/.env.local).
 * A Stripe test clock drives renewals, failure and cancellation; the genuine events Stripe
 * generates are signed with a test webhook secret and delivered to the API.
 * Skipped when no sk_test_ key is configured.
 */
import { randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { call, cleanupTestData, makeStaff, operatorToken, testContext, type TestContext, type TestStaff } from "./helpers.js";

const stripeKey = inject("supabase").stripeKey;
const WEBHOOK_SECRET = `whsec_test_${randomBytes(16).toString("hex")}`;
const run = randomUUID().slice(0, 8);

let ctx: TestContext;
let stripe: Stripe;
let owner: TestStaff;
let ownerOp: string;
let clockId: string | null = null;
const delivered = new Set<string>();

async function deliver(event: Stripe.Event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await ctx.app.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: payload });
  const json = (await res.json()) as Record<string, unknown>;
  expect(res.status, JSON.stringify(json)).toBe(200);
  delivered.add(event.id);
  return json;
}

/** Wait until Stripe has generated the wanted event for our subscription, then deliver every new event for it in order. */
async function deliverUntil(subscriptionId: string, customerId: string, since: number, wanted: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = await stripe.events.list({ created: { gte: since - 5 }, limit: 100 });
    const ours = events.data
      .filter((e) => {
        const o = e.data.object as unknown as Record<string, unknown>;
        const sub = (o.parent as { subscription_details?: { subscription?: string } } | undefined)?.subscription_details?.subscription;
        return o.id === subscriptionId || sub === subscriptionId || o.subscription === subscriptionId || (o.object === "customer" && o.id === customerId);
      })
      .sort((a, b) => a.created - b.created);
    if (ours.some((e) => e.type === wanted && !delivered.has(e.id))) {
      const results = [];
      for (const e of ours) if (!delivered.has(e.id)) results.push({ type: e.type, result: await deliver(e) });
      return results;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${wanted}`);
}

async function advanceClock(to: number) {
  await stripe.testHelpers.testClocks.advance(clockId!, { frozen_time: to });
  for (let i = 0; i < 90; i++) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId!);
    if (clock.status === "ready") return;
    if (clock.status === "internal_failure") throw new Error("Test clock failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Test clock did not become ready");
}

const admin = (path: string, body?: unknown) =>
  call(ctx, `/admin${path}`, { jwt: owner.jwt, operatorToken: ownerOp, ...(body !== undefined ? { body } : {}) });
const member = async (id: string) => (await ctx.db.from("members").select("*").eq("id", id).single()).data!;
const balance = async (id: string) => (await ctx.db.from("member_balances").select("balance_minutes").eq("member_id", id).single()).data!.balance_minutes;

describe.skipIf(!stripeKey)("membership billing with Stripe (test mode)", { timeout: 300_000 }, () => {
  beforeAll(async () => {
    ctx = testContext({ STRIPE_SECRET_KEY: stripeKey!, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, CRON_SECRET: randomBytes(24).toString("hex") });
    stripe = ctx.stripe!;
    expect((await stripe.balance.retrieve()).livemode).toBe(false); // never run against live mode
    owner = await makeStaff(ctx, "superadmin", "2468", "billing-owner");
    ownerOp = await operatorToken(ctx, owner);
  }, 60_000);

  afterAll(async () => {
    if (clockId) await stripe.testHelpers.testClocks.del(clockId).catch(() => undefined);
    await cleanupTestData(ctx);
  });

  it("syncs a monthly AUD, GST-inclusive price for every tier, idempotently", async () => {
    const first = await admin("/billing/sync-catalog", {});
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const second = await admin("/billing/sync-catalog", {});
    expect(second.json.tiers.map((t: { priceId: string }) => t.priceId)).toEqual(first.json.tiers.map((t: { priceId: string }) => t.priceId));
    expect(second.json.tiers.every((t: { createdPrice: boolean }) => !t.createdPrice)).toBe(true);

    for (const t of first.json.tiers as { tierId: string; priceId: string; amountCents: number; productId: string }[]) {
      const price = await stripe.prices.retrieve(t.priceId);
      expect(price).toMatchObject({ currency: "aud", unit_amount: t.amountCents, tax_behavior: "inclusive", product: t.productId, active: true });
      expect(price.recurring?.interval).toBe("month");
      const { data: tier } = await ctx.db.from("membership_tiers").select("stripe_price_id").eq("id", t.tierId).single();
      expect(tier!.stripe_price_id).toBe(t.priceId);
    }
  });

  it("starts a counter checkout: pending member and a Stripe subscription checkout for their email", async () => {
    const { data: gold } = await ctx.db.from("membership_tiers").select("id, stripe_price_id").eq("name", "Gold").single();
    const email = `counter-${run}@raceground.test`;
    const r = await call(ctx, "/pos/memberships/checkout", { jwt: owner.jwt, operatorToken: ownerOp, body: { name: `Counter ${run}`, email, tierId: gold!.id } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect((await member(r.json.memberId)).status).toBe("pending");

    const session = await stripe.checkout.sessions.retrieve(r.json.checkoutSessionId, { expand: ["line_items", "customer"] });
    expect(session).toMatchObject({ mode: "subscription", client_reference_id: r.json.memberId, status: "open", currency: "aud" });
    expect(session.line_items!.data[0]!.price!.id).toBe(gold!.stripe_price_id);
    expect((session.customer as Stripe.Customer).email).toBe(email);

    const again = await call(ctx, "/pos/memberships/checkout", { jwt: owner.jwt, operatorToken: ownerOp, body: { name: `Counter ${run}`, email: email.toUpperCase(), tierId: gold!.id } });
    expect(again.status).toBe(201);
    expect(again.json.memberId).toBe(r.json.memberId);
    await stripe.checkout.sessions.expire(r.json.checkoutSessionId);
    await stripe.checkout.sessions.expire(again.json.checkoutSessionId);
  });

  it("rejects webhooks with a bad signature", async () => {
    const fakeId = `evt_fake_${run}`;
    const body = JSON.stringify({ id: fakeId, object: "event", type: "invoice.paid" });
    const res = await ctx.app.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "t=1,v1=deadbeef" }, body });
    expect(res.status).toBe(400);
    const { count } = await ctx.db.from("stripe_events").select("id", { count: "exact", head: true }).eq("id", fakeId);
    expect(count).toBe(0);
  });

  it("runs a membership from first payment through upgrade, failed payment, recovery, cancellation and forfeit", async () => {
    const { data: tiers } = await ctx.db.from("membership_tiers").select("id, name, stripe_price_id, monthly_price_cents").in("name", ["Silver", "Diamond"]);
    const silver = tiers!.find((t) => t.name === "Silver")!;
    const diamond = tiers!.find((t) => t.name === "Diamond")!;

    // Customer on a test clock with a good card.
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: `rg-${run}` });
    clockId = clock.id;
    const email = `lifecycle-${run}@raceground.test`;
    const prep = await ctx.db.rpc("membership_checkout_prepare", { p_staff: owner.id, p_name: `Lifecycle ${run}`, p_email: email, p_phone: "", p_tier: silver.id });
    expect(prep.error).toBeNull();
    const { memberId, customerId } = prep.data as { memberId: string; customerId: string };
    const customer = await stripe.customers.create({ email, name: `Lifecycle ${run}`, test_clock: clock.id, metadata: { customer_id: customerId } });
    await ctx.db.rpc("membership_set_stripe_customer", { p_customer: customerId, p_stripe_customer_id: customer.id });
    const visa = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: visa.id } });

    // 1. First payment → active, 60 minutes, welcome email.
    const t1 = Math.floor(Date.now() / 1000);
    const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: silver.stripe_price_id! }], metadata: { member_id: memberId, tier_id: silver.id } });
    expect(sub.status).toBe("active");
    await deliverUntil(sub.id, customer.id, t1, "invoice.paid");
    let m = await member(memberId);
    expect(m).toMatchObject({ status: "active", stripe_subscription_id: sub.id, tier_id: silver.id });
    expect(await balance(memberId)).toBe(60);
    const { data: firstPayment } = await ctx.db.from("payments").select("amount_cents, gst_cents, method").eq("member_id", memberId);
    expect(firstPayment).toEqual([{ amount_cents: silver.monthly_price_cents, gst_cents: Math.floor((silver.monthly_price_cents * 2 + 11) / 22), method: "stripe" }]);
    expect(ctx.email.outbox.some((e) => e.template === "membership_welcome" && e.to === email)).toBe(true);

    // 2. The same event again changes nothing.
    const paidEvents = await stripe.events.list({ type: "invoice.paid", created: { gte: t1 - 5 }, limit: 20 });
    const firstPaid = paidEvents.data.find((e) => (e.data.object as Stripe.Invoice).parent?.subscription_details?.subscription === sub.id)!;
    const dup = await deliver(firstPaid);
    expect(dup.duplicate).toBe(true);
    expect(await balance(memberId)).toBe(60);

    // 3. Upgrade to Diamond: Stripe bills Diamond from renewal; our tier switches then.
    const up = await admin(`/members/${memberId}/tier`, { tierId: diamond.id, reason: "Upgrade" });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    expect(up.json.mode).toBe("next_renewal");
    expect((await stripe.subscriptions.retrieve(sub.id)).items.data[0]!.price.id).toBe(diamond.stripe_price_id);
    expect((await member(memberId)).tier_id).toBe(silver.id);

    // 4. Renewal a month later → Diamond, +60 minutes, charged the Diamond price.
    const periodEnd = sub.items.data[0]!.current_period_end;
    const t2 = Math.floor(Date.now() / 1000);
    await advanceClock(periodEnd + 2 * 3600);
    await deliverUntil(sub.id, customer.id, t2, "invoice.paid");
    m = await member(memberId);
    expect(m).toMatchObject({ status: "active", tier_id: diamond.id, pending_tier_id: null });
    expect(await balance(memberId)).toBe(120);
    const { data: payments } = await ctx.db.from("payments").select("amount_cents").eq("member_id", memberId).order("created_at");
    expect(payments!.map((p) => p.amount_cents)).toEqual([silver.monthly_price_cents, diamond.monthly_price_cents]);

    // 5. Next renewal fails → past due immediately, email.
    const failing = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: failing.id } });
    await stripe.subscriptions.update(sub.id, { default_payment_method: failing.id });
    const renewed = await stripe.subscriptions.retrieve(sub.id);
    const t3 = Math.floor(Date.now() / 1000);
    await advanceClock(renewed.items.data[0]!.current_period_end + 2 * 3600);
    await deliverUntil(sub.id, customer.id, t3, "invoice.payment_failed");
    expect((await member(memberId)).status).toBe("past_due");
    expect(ctx.email.outbox.some((e) => e.template === "membership_payment_failed" && e.to === email)).toBe(true);
    const quoteBlocked = await call(ctx, "/pos/members/search?q=" + encodeURIComponent(`Lifecycle ${run}`), { jwt: owner.jwt, operatorToken: ownerOp });
    expect(quoteBlocked.json.members[0]).toMatchObject({ eligible: false, status: "past_due" });

    // 6. The customer fixes their card and the invoice is paid → active again.
    await stripe.subscriptions.update(sub.id, { default_payment_method: visa.id });
    const openInvoices = await stripe.invoices.list({ subscription: sub.id, status: "open", limit: 1 });
    const t4 = Math.floor(Date.now() / 1000);
    await stripe.invoices.pay(openInvoices.data[0]!.id!, { payment_method: visa.id });
    await deliverUntil(sub.id, customer.id, t4, "invoice.paid");
    expect((await member(memberId)).status).toBe("active");
    expect(await balance(memberId)).toBe(180);

    // 7. Cancel at period end → benefits continue (cancelling), then end.
    const cancel = await admin(`/members/${memberId}/cancel`, { reason: "Moving away" });
    expect(cancel.status, JSON.stringify(cancel.json)).toBe(200);
    expect(cancel.json.status).toBe("cancelling");
    const search = await call(ctx, "/pos/members/search?q=" + encodeURIComponent(`Lifecycle ${run}`), { jwt: owner.jwt, operatorToken: ownerOp });
    expect(search.json.members[0]).toMatchObject({ eligible: true, status: "cancelling" });

    const current = await stripe.subscriptions.retrieve(sub.id);
    const t5 = Math.floor(Date.now() / 1000);
    await advanceClock(current.items.data[0]!.current_period_end + 2 * 3600);
    await deliverUntil(sub.id, customer.id, t5, "customer.subscription.deleted");
    m = await member(memberId);
    expect(m.status).toBe("ended");
    expect(m.ended_at).not.toBeNull();
    expect(ctx.email.outbox.some((e) => e.template === "membership_ended" && e.to === email)).toBe(true);
    expect(await balance(memberId)).toBe(180);

    // 8. Daily job: nothing within 30 days, forfeited after.
    const unauth = await ctx.app.request("/cron/forfeit", { method: "POST" });
    expect(unauth.status).toBe(401);
    const cron = () => ctx.app.request("/cron/forfeit", { method: "POST", headers: { Authorization: `Bearer ${ctx.env.CRON_SECRET}` } });
    await cron();
    expect(await balance(memberId)).toBe(180);
    await ctx.db.from("members").update({ ended_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }).eq("id", memberId);
    const forfeit = await cron();
    expect(((await forfeit.json()) as { forfeited: number }).forfeited).toBeGreaterThanOrEqual(1);
    expect(await balance(memberId)).toBe(0);

    // Audit trail of the lifecycle.
    const { data: audit } = await ctx.db.from("audit_log").select("action").eq("entity_id", memberId).order("id");
    const actions = audit!.map((a) => a.action);
    for (const a of ["member.checkout_started", "member.invoice_paid", "member.tier_change", "member.cancel_at_period_end", "member.balance_forfeit"]) expect(actions).toContain(a);
  });
});
