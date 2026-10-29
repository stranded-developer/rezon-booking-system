/**
 * Member self-service with a real Stripe account in TEST mode: online membership sign-up from the account,
 * activation from the genuine subscription + invoice (signed and delivered), Customer Portal, tier change,
 * cancel and resume from the account. Skipped when no sk_test_ key is configured.
 */
import { randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { syncCatalog, termEnd } from "../src/services/billing.js";
import { call, PASSWORD, signIn, testContext, type TestContext } from "./helpers.js";

const stripeKey = inject("supabase").stripeKey;
const WEBHOOK_SECRET = `whsec_test_${randomBytes(16).toString("hex")}`;
const run = randomUUID().slice(0, 8);

let ctx: TestContext;
let stripe: Stripe;
let userId: string;
let jwt: string;
let subscriptionId: string | null = null;
let termSubscriptionId: string | null = null;
let termUserId: string | null = null;
const tiers: Record<string, { id: string; stripe_price_id: string }> = {};

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const me = (path: string, body?: unknown) => call(ctx, `/me${path}`, { jwt, headers: { "x-forwarded-for": ip() }, ...(body !== undefined ? { body } : {}) });

async function deliver(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_test_${randomUUID()}`, object: "event", type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await ctx.app.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: payload });
  const json = (await res.json()) as Record<string, unknown>;
  expect(res.status, JSON.stringify(json)).toBe(200);
  return json;
}

describe.skipIf(!stripeKey)("member self-service with Stripe (test mode)", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    ctx = testContext({ STRIPE_SECRET_KEY: stripeKey!, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
    stripe = ctx.stripe!;
    expect((await stripe.balance.retrieve()).livemode).toBe(false);
    await syncCatalog(ctx, null);
    const { data } = await ctx.db.from("membership_tiers").select("id, name, stripe_price_id").in("name", ["Silver", "Gold"]);
    for (const t of data!) tiers[t.name] = { id: t.id, stripe_price_id: t.stripe_price_id! };
    const email = `online-member-${run}@raceground.test`;
    const { data: user, error } = await ctx.db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name: "Olive Online" } });
    if (error) throw error;
    userId = user.user.id;
    jwt = await signIn(ctx, email);
  }, 60_000);

  afterAll(async () => {
    if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId).catch(() => undefined);
    if (termSubscriptionId) await stripe.subscriptions.cancel(termSubscriptionId).catch(() => undefined);
    await ctx.db.auth.admin.deleteUser(userId);
    if (termUserId) await ctx.db.auth.admin.deleteUser(termUserId);
  });

  it("starts a Silver membership from the account and returns to the account page", async () => {
    const r = await me("/membership/checkout", { tierId: tiers.Silver!.id });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const session = (await stripe.checkout.sessions.list({ limit: 5 })).data.find((s) => s.url === r.json.checkoutUrl)!;
    expect(session).toMatchObject({ mode: "subscription", success_url: "http://localhost:3000/account?membership=started" });
    expect(session.adaptive_pricing?.enabled).toBe(false);
    await stripe.checkout.sessions.expire(session.id);
    const account = await me("");
    expect(account.json.member).toMatchObject({ status: "pending", eligible: false, tier: { name: "Silver" }, qr: null });
    expect(account.json.canManageBilling).toBe(true);
  });

  it("activates from the real subscription and first invoice, with free play and a QR", async () => {
    const { data: customer } = await ctx.db.from("customers").select("stripe_customer_id, members(id)").eq("auth_user_id", userId).single();
    const memberId = (customer!.members as unknown as { id: string }).id;
    const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer!.stripe_customer_id! });
    const sub = await stripe.subscriptions.create({
      customer: customer!.stripe_customer_id!,
      items: [{ price: tiers.Silver!.stripe_price_id }],
      default_payment_method: pm.id,
      metadata: { member_id: memberId, tier_id: tiers.Silver!.id },
    });
    subscriptionId = sub.id;
    const invoice = await stripe.invoices.retrieve(sub.latest_invoice as string);
    expect(invoice.status).toBe("paid");
    await deliver("invoice.paid", invoice);
    const account = await me("");
    expect(account.json.member).toMatchObject({ status: "active", eligible: true, billedOnline: true, balanceMinutes: 60 });
    expect(account.json.member.qr).toMatch(/^rg:m:/);
    expect(ctx.email.outbox.find((m) => m.template === "membership_welcome")?.text).toContain("http://localhost:3000/account");
  });

  it("opens the Stripe billing page with our portal settings, created once", async () => {
    // Start from none (test mode), so this run checks what the API creates, not what an earlier run left.
    const marked = async () => (await stripe.billingPortal.configurations.list({ active: true, limit: 100 })).data.filter((c) => c.metadata?.raceground === "member_portal_v1");
    // (Unmarked rather than deactivated: Stripe refuses to deactivate the account's default configuration.)
    for (const c of await marked()) await stripe.billingPortal.configurations.update(c.id, { metadata: { raceground: "" } });
    const first = await me("/portal", {});
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    await me("/portal", {});
    const ours = await marked();
    expect(ours).toHaveLength(1);
    expect(ours[0]!.features).toMatchObject({
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: false },
      payment_method_update: { enabled: true },
    });
  });

  it("changes to Gold from the next renewal, and cancels and resumes at period end", async () => {
    const tier = await me("/membership/tier", { tierId: tiers.Gold!.id });
    expect(tier.status, JSON.stringify(tier.json)).toBe(200);
    expect(tier.json.mode).toBe("next_renewal");
    const sub = await stripe.subscriptions.retrieve(subscriptionId!);
    expect(sub.items.data[0]!.price.id).toBe(tiers.Gold!.stripe_price_id);
    expect((await me("")).json.member).toMatchObject({ tier: { name: "Silver" }, pendingTier: { name: "Gold" } });

    const cancel = await me("/membership/cancel", {});
    expect(cancel.json.status).toBe("cancelling");
    expect((await stripe.subscriptions.retrieve(subscriptionId!)).cancel_at_period_end).toBe(true);
    const resume = await me("/membership/resume", {});
    expect(resume.json.status).toBe("active");
    expect((await stripe.subscriptions.retrieve(subscriptionId!)).cancel_at_period_end).toBe(false);
  });

  it("a 12-month plan (D114): set to stop after 12 payments, and the member can't cancel it", async () => {
    const email = `term-member-${run}@raceground.test`;
    const { data: user, error } = await ctx.db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name: "Terry Term" } });
    if (error) throw error;
    termUserId = user.user.id;
    const termJwt = await signIn(ctx, email);
    const meTerm = (path: string, body?: unknown) => call(ctx, `/me${path}`, { jwt: termJwt, headers: { "x-forwarded-for": ip() }, ...(body !== undefined ? { body } : {}) });

    const started = await meTerm("/membership/checkout", { tierId: tiers.Silver!.id, plan: "twelve_months" });
    expect(started.status, JSON.stringify(started.json)).toBe(201);
    const session = (await stripe.checkout.sessions.list({ limit: 5 })).data.find((s) => s.url === started.json.checkoutUrl)!;
    await stripe.checkout.sessions.expire(session.id);

    const { data: customer } = await ctx.db.from("customers").select("stripe_customer_id, members(id)").eq("auth_user_id", termUserId).single();
    const memberId = (customer!.members as unknown as { id: string }).id;
    const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer!.stripe_customer_id! });
    // What Checkout creates for the 12-month plan: the term in the subscription's metadata.
    const sub = await stripe.subscriptions.create({
      customer: customer!.stripe_customer_id!,
      items: [{ price: tiers.Silver!.stripe_price_id }],
      default_payment_method: pm.id,
      metadata: { member_id: memberId, tier_id: tiers.Silver!.id, term_months: "12" },
    });
    termSubscriptionId = sub.id;
    await deliver("invoice.paid", await stripe.invoices.retrieve(sub.latest_invoice as string));

    const after = await stripe.subscriptions.retrieve(sub.id);
    expect(after.cancel_at).toBe(termEnd(after.billing_cycle_anchor, 12));
    expect(after.cancel_at_period_end).toBe(false);
    const account = await meTerm("");
    expect(account.json.member).toMatchObject({ status: "active", eligible: true, termEndsAt: new Date(after.cancel_at! * 1000).toISOString().replace(".000Z", "+00:00") });

    const cancel = await meTerm("/membership/cancel", {});
    expect(cancel.status).toBe(409);
    expect(cancel.json.error.code).toBe("fixed_term");
    expect((await stripe.subscriptions.retrieve(sub.id)).cancel_at).toBe(after.cancel_at);

    // Its portal has no cancel button; the rolling members' portal keeps theirs.
    const marked = async () => (await stripe.billingPortal.configurations.list({ active: true, limit: 100 })).data.filter((c) => c.metadata?.raceground === "member_portal_fixed_term_v1");
    for (const c of await marked()) await stripe.billingPortal.configurations.update(c.id, { metadata: { raceground: "" } });
    const portal = await meTerm("/portal", {});
    expect(portal.status, JSON.stringify(portal.json)).toBe(200);
    const ours = await marked();
    expect(ours).toHaveLength(1);
    expect(ours[0]!.features).toMatchObject({ subscription_cancel: { enabled: false }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } });
  });
});
