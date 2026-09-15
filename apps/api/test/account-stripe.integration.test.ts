/**
 * Member self-service with a real Stripe account in TEST mode: online membership sign-up from the account,
 * activation from the genuine subscription + invoice (signed and delivered), Customer Portal, tier change,
 * cancel and resume from the account. Skipped when no sk_test_ key is configured.
 */
import { randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { syncCatalog } from "../src/services/billing.js";
import { call, PASSWORD, signIn, testContext, type TestContext } from "./helpers.js";

const stripeKey = inject("supabase").stripeKey;
const WEBHOOK_SECRET = `whsec_test_${randomBytes(16).toString("hex")}`;
const run = randomUUID().slice(0, 8);

let ctx: TestContext;
let stripe: Stripe;
let userId: string;
let jwt: string;
let subscriptionId: string | null = null;
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
    await ctx.db.auth.admin.deleteUser(userId);
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
});
