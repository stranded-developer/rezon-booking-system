import Stripe from "stripe";
import type { Json, Tables } from "@raceground/db";
import type { AppDeps, StaffIdentity } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { writeAudit } from "../lib/audit.js";
import { auditHeaders } from "../lib/audit-headers.js";
import { handleBookingCheckoutCompleted, handleBookingCheckoutExpired } from "./bookings.js";
import { getMember } from "./lookup.js";
import { currentMemberQr, nextMemberCard } from "../lib/qr.js";
import { requireStripe, stripeCall } from "../lib/stripe.js";

export { requireStripe };

type Tier = Tables<"membership_tiers">;

const compactId = (uuid: string) => uuid.replace(/-/g, "");
export const tierProductId = (tierId: string) => `rg_tier_${compactId(tierId)}`;
export const tierPriceLookupKey = (tierId: string, amountCents: number) => `rg_tier_${compactId(tierId)}_${amountCents}`;

// ── Catalog ──────────────────────────────────────────────────────────────────
/**
 * Ensure a Stripe Product and a monthly AUD, GST-inclusive Price exist for the tier's current price.
 * Idempotent: the product has a fixed id and prices are found by lookup key, so re-running creates nothing new.
 */
export async function syncTierCatalog(deps: AppDeps, tier: Tier, actorStaffId: string | null) {
  const stripe = requireStripe(deps);
  const productId = tierProductId(tier.id);
  const name = `Raceground ${tier.name} membership`;

  const product = await stripeCall(async () => {
    try {
      const existing = await stripe.products.retrieve(productId);
      if (existing.name !== name || !existing.active) return stripe.products.update(productId, { name, active: true });
      return existing;
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
        return stripe.products.create({ id: productId, name, metadata: { tier_id: tier.id } });
      }
      throw err;
    }
  });

  const lookupKey = tierPriceLookupKey(tier.id, tier.monthly_price_cents);
  let created = false;
  const price = await stripeCall(async () => {
    const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
    if (found.data[0]) return found.data[0];
    created = true;
    return stripe.prices.create({
      product: product.id,
      currency: "aud",
      unit_amount: tier.monthly_price_cents,
      recurring: { interval: "month" },
      tax_behavior: "inclusive",
      lookup_key: lookupKey,
      metadata: { tier_id: tier.id },
    });
  });

  if (tier.stripe_product_id !== product.id || tier.stripe_price_id !== price.id) {
    const update = deps.db.from("membership_tiers").update({ stripe_product_id: product.id, stripe_price_id: price.id }).eq("id", tier.id);
    const { error } = await (actorStaffId ? auditHeaders(update, actorStaffId, "Stripe catalog sync") : update);
    if (error) throw mapDbError(error);
  }
  const { error: historyError } = await deps.db
    .from("tier_prices")
    .update({ stripe_price_id: price.id })
    .eq("tier_id", tier.id)
    .eq("amount_cents", tier.monthly_price_cents)
    .is("stripe_price_id", null);
  if (historyError && historyError.code !== "23505") throw mapDbError(historyError);

  return { tierId: tier.id, tierName: tier.name, productId: product.id, priceId: price.id, amountCents: tier.monthly_price_cents, createdPrice: created };
}

export async function syncCatalog(deps: AppDeps, actorStaffId: string | null) {
  const { data, error } = await deps.db.from("membership_tiers").select("*").eq("active", true).order("sort");
  if (error) throw mapDbError(error);
  const results = [];
  for (const tier of data) results.push(await syncTierCatalog(deps, tier, actorStaffId));
  return results;
}

// ── Checkout ─────────────────────────────────────────────────────────────────
export interface CheckoutInput {
  name: string;
  email: string;
  phone?: string | undefined;
  tierId: string;
  /** Where Stripe sends the customer afterwards; defaults to the counter pages. */
  successUrl?: string | undefined;
  cancelUrl?: string | undefined;
}

/** Start a membership: prepare the member, then a Stripe Checkout session (subscription) the customer pays on their phone. */
export async function startMembershipCheckout(deps: AppDeps, operator: StaffIdentity | null, input: CheckoutInput) {
  const stripe = requireStripe(deps);
  const { data: prepared, error } = await deps.db.rpc("membership_checkout_prepare", {
    // null (not undefined) for online sign-ups: an omitted argument makes PostgREST look for a different function.
    p_staff: (operator?.id ?? null) as string,
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone ?? "",
    p_tier: input.tierId,
  });
  if (error) throw mapDbError(error);
  const p = prepared as { memberId: string; memberNo: string; customerId: string; stripeCustomerId: string | null };

  const { data: tier, error: tierError } = await deps.db.from("membership_tiers").select("*").eq("id", input.tierId).single();
  if (tierError) throw mapDbError(tierError);

  let customerId = p.stripeCustomerId;
  if (!customerId) {
    const customer = await stripeCall(() =>
      stripe.customers.create({
        email: input.email,
        name: input.name,
        ...(input.phone ? { phone: input.phone } : {}),
        metadata: { customer_id: p.customerId },
      }),
    );
    customerId = customer.id;
    const { error: linkError } = await deps.db.rpc("membership_set_stripe_customer", { p_customer: p.customerId, p_stripe_customer_id: customerId });
    if (linkError) throw mapDbError(linkError);
  }

  const expiresAt = Math.floor(deps.clock.now().getTime() / 1000) + 31 * 60; // Stripe requires ≥ 30 min
  const session = await stripeCall(() =>
    stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId!,
      line_items: [{ price: tier.stripe_price_id!, quantity: 1 }],
      client_reference_id: p.memberId,
      metadata: { member_id: p.memberId, tier_id: tier.id },
      subscription_data: { metadata: { member_id: p.memberId, tier_id: tier.id } },
      success_url: input.successUrl ?? deps.env.CHECKOUT_SUCCESS_URL,
      cancel_url: input.cancelUrl ?? deps.env.CHECKOUT_CANCEL_URL,
      expires_at: expiresAt,
      // Always charge the AUD price. Adaptive Pricing would show and charge visitors from abroad in their
      // own currency (a Jakarta visitor saw IDR), and the payment would be recorded with the wrong amount.
      adaptive_pricing: { enabled: false },
    }),
  );

  return { memberId: p.memberId, memberNo: p.memberNo, checkoutUrl: session.url!, checkoutSessionId: session.id, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

// ── Webhooks ─────────────────────────────────────────────────────────────────
const subscriptionIdOf = (value: string | Stripe.Subscription | null | undefined) => (typeof value === "string" ? value : (value?.id ?? null));

async function memberForSubscription(deps: AppDeps, sub: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = sub.metadata?.member_id;
  if (fromMetadata) return fromMetadata;
  const { data } = await deps.db.from("members").select("id").eq("stripe_subscription_id", sub.id).maybeSingle();
  return data?.id ?? null;
}

async function memberContact(deps: AppDeps, memberId: string) {
  const { data } = await deps.db.from("members").select("member_no, customers!inner(name, email), membership_tiers!members_tier_id_fkey(name)").eq("id", memberId).single();
  const c = data?.customers as { name: string; email: string | null } | undefined;
  return { name: c?.name ?? "", email: c?.email ?? null, memberNo: data?.member_no ?? "", tierName: (data?.membership_tiers as { name: string } | undefined)?.name ?? "" };
}

/** Re-read the subscription from Stripe (event order doesn't matter) and apply it. */
export async function syncSubscription(deps: AppDeps, subscriptionId: string) {
  const stripe = requireStripe(deps);
  const sub = await stripeCall(() => stripe.subscriptions.retrieve(subscriptionId));
  const memberId = await memberForSubscription(deps, sub);
  if (!memberId) return { memberId: null, status: null };
  const periodEnd = sub.items.data[0]?.current_period_end;
  const { data, error } = await deps.db.rpc("membership_sync_subscription", {
    p_member: memberId,
    p: {
      subscriptionId: sub.id,
      stripeStatus: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      cancelAt: sub.cancel_at,
      periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    } as Json,
  });
  if (error) throw mapDbError(error);
  return { memberId, status: data as string, subscription: sub };
}

export async function handleStripeEvent(deps: AppDeps, event: Stripe.Event) {
  const { error: insertError } = await deps.db.from("stripe_events").insert({ id: event.id, type: event.type, payload: event as unknown as Json });
  if (insertError) {
    if (insertError.code !== "23505") throw mapDbError(insertError);
    const { data: existing } = await deps.db.from("stripe_events").select("processed_at").eq("id", event.id).single();
    if (existing?.processed_at) return { duplicate: true, handled: false };
  }

  let handled = true;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription" && session.subscription) await syncSubscription(deps, subscriptionIdOf(session.subscription)!);
      else if (session.mode === "payment") handled = await handleBookingCheckoutCompleted(deps, session);
      else handled = false;
      break;
    }
    case "checkout.session.expired": {
      const session = event.data.object;
      handled = session.mode === "payment" ? await handleBookingCheckoutExpired(deps, session) : false;
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object;
      const subscriptionId = subscriptionIdOf(invoice.parent?.subscription_details?.subscription);
      if (!subscriptionId) {
        handled = false;
        break;
      }
      if (invoice.currency !== "aud") {
        // Amounts are stored as AUD cents; recording another currency would corrupt revenue and GST.
        // Fail loudly (Stripe retries and the event stays unprocessed) so it gets looked at.
        throw new ApiError(500, "unexpected_currency", `Invoice ${invoice.id} is in ${invoice.currency}, expected aud`);
      }
      const sub = await stripeCall(() => requireStripe(deps).subscriptions.retrieve(subscriptionId));
      const memberId = await memberForSubscription(deps, sub);
      if (!memberId) {
        handled = false;
        break;
      }
      const periodEnd = sub.items.data[0]?.current_period_end;
      const { data, error } = await deps.db.rpc("membership_apply_invoice", {
        p_member: memberId,
        p: {
          invoiceId: invoice.id,
          subscriptionId,
          amountPaidCents: invoice.amount_paid,
          periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        } as Json,
      });
      if (error) throw mapDbError(error);
      const result = data as { applied: boolean; grantedMinutes: number; balanceMinutes: number };
      await syncSubscription(deps, subscriptionId);
      if (result.applied && invoice.billing_reason === "subscription_create") {
        const contact = await memberContact(deps, memberId);
        if (contact.email) {
          await deps.email.send({
            template: "membership_welcome",
            to: contact.email,
            subject: `Welcome to Raceground ${contact.tierName}`,
            text: `Hi ${contact.name},\n\nYour ${contact.tierName} membership (${contact.memberNo}) is active. You have ${result.balanceMinutes} minutes of free play ready to use.\n\nYour member QR is in your account at ${deps.env.BOOKING_SITE_URL}/account (log in or create your account with this email address), or collect a card at the counter.\n\nRaceground`,
            entity: "members",
            entityId: `${memberId}:${invoice.id}`,
          });
        }
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId = subscriptionIdOf(invoice.parent?.subscription_details?.subscription);
      const sub = subscriptionId ? await stripeCall(() => requireStripe(deps).subscriptions.retrieve(subscriptionId)) : null;
      const memberId = sub ? await memberForSubscription(deps, sub) : null;
      if (!memberId || !subscriptionId) {
        handled = false;
        break;
      }
      const { data: status, error } = await deps.db.rpc("membership_payment_failed", { p_member: memberId, p_subscription_id: subscriptionId });
      if (error) throw mapDbError(error);
      if (status === "past_due") {
        const contact = await memberContact(deps, memberId);
        if (contact.email) {
          await deps.email.send({
            template: "membership_payment_failed",
            to: contact.email,
            subject: "Your Raceground membership payment didn't go through",
            text: `Hi ${contact.name},\n\nWe couldn't take your monthly membership payment, so your member discount and free play are paused.\nStripe will try again automatically, or you can update your card. Everything comes back as soon as the payment succeeds.\n\nRaceground`,
            entity: "members",
            entityId: `${memberId}:${invoice.id}`,
          });
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const result = await syncSubscription(deps, event.data.object.id);
      handled = result.memberId !== null;
      if (event.type === "customer.subscription.deleted" && result.status === "ended" && result.memberId) {
        const contact = await memberContact(deps, result.memberId);
        if (contact.email) {
          await deps.email.send({
            template: "membership_ended",
            to: contact.email,
            subject: "Your Raceground membership has ended",
            text: `Hi ${contact.name},\n\nYour membership has ended. Any free-play minutes are kept for 30 days in case you re-join.\n\nRaceground`,
            entity: "members",
            entityId: `${result.memberId}:${event.data.object.id}`,
          });
        }
      }
      break;
    }
    default:
      handled = false;
  }

  const { error: doneError } = await deps.db.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", event.id);
  if (doneError) throw mapDbError(doneError);
  return { duplicate: false, handled };
}

// ── Member billing actions ───────────────────────────────────────────────────
async function subscriptionOf(deps: AppDeps, memberId: string) {
  const { data, error } = await deps.db.from("members").select("id, status, tier_id, pending_tier_id, stripe_subscription_id").eq("id", memberId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Member not found");
  return data;
}

/** Paid members: Stripe bills the new tier's price from the next renewal, and our side switches then too. */
export async function changeMemberTier(deps: AppDeps, actorStaffId: string | null, memberId: string, tierId: string, reason: string | null) {
  const member = await subscriptionOf(deps, memberId);
  if (member.stripe_subscription_id) {
    const stripe = requireStripe(deps);
    const { data: tier, error } = await deps.db.from("membership_tiers").select("id, stripe_price_id, active").eq("id", tierId).maybeSingle();
    if (error) throw mapDbError(error);
    if (!tier?.active || !tier.stripe_price_id) throw new ApiError(409, "tier_unavailable", "That tier isn't available for online billing");
    const sub = await stripeCall(() => stripe.subscriptions.retrieve(member.stripe_subscription_id!));
    const item = sub.items.data[0];
    if (!item) throw new ApiError(502, "stripe_error", "The subscription has no items");
    const previousPrice = item.price.id;
    await stripeCall(() => stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: tier.stripe_price_id! }], proration_behavior: "none" }));
    const { data, error: rpcError } = await deps.db.rpc("membership_change_tier", { p_member: memberId, p_staff: actorStaffId as string, p_tier: tierId, p_reason: reason ?? "" });
    if (rpcError) {
      await stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: previousPrice }], proration_behavior: "none" }).catch(() => undefined);
      throw mapDbError(rpcError);
    }
    return data as { mode: string };
  }
  const { data, error } = await deps.db.rpc("membership_change_tier", { p_member: memberId, p_staff: actorStaffId as string, p_tier: tierId, p_reason: reason ?? "" });
  if (error) throw mapDbError(error);
  return data as { mode: string };
}

export async function setCancelAtPeriodEnd(deps: AppDeps, actorStaffId: string | null, memberId: string, cancel: boolean, reason: string | null) {
  const member = await subscriptionOf(deps, memberId);
  if (!member.stripe_subscription_id) throw new ApiError(409, "not_billed", "This membership isn't billed through Stripe");
  const stripe = requireStripe(deps);
  await stripeCall(() => stripe.subscriptions.update(member.stripe_subscription_id!, { cancel_at_period_end: cancel }));
  const result = await syncSubscription(deps, member.stripe_subscription_id);
  await writeAudit(deps.db, {
    actorStaffId,
    action: cancel ? "member.cancel_at_period_end" : "member.resume",
    entity: "members",
    entityId: memberId,
    after: { status: result.status },
    reason,
  });
  return { status: result.status };
}

/**
 * After a tier's price changes: move every billed member of that tier (or with it pending) to the new Stripe
 * price from their next renewal (no proration) and tell them. Safe to re-run.
 */
export async function migrateTierSubscriptions(deps: AppDeps, tierId: string, actorStaffId: string) {
  const stripe = requireStripe(deps);
  const { data: tier, error } = await deps.db.from("membership_tiers").select("*").eq("id", tierId).single();
  if (error) throw mapDbError(error);
  const synced = await syncTierCatalog(deps, tier, actorStaffId);

  const { data: members, error: membersError } = await deps.db
    .from("members")
    .select("id, tier_id, pending_tier_id, stripe_subscription_id, current_period_end, customers!inner(name, email)")
    .in("status", ["active", "cancelling", "past_due"])
    .not("stripe_subscription_id", "is", null)
    .or(`and(tier_id.eq.${tierId},pending_tier_id.is.null),pending_tier_id.eq.${tierId}`);
  if (membersError) throw mapDbError(membersError);

  let moved = 0;
  for (const m of members) {
    const sub = await stripeCall(() => stripe.subscriptions.retrieve(m.stripe_subscription_id!));
    const item = sub.items.data[0];
    if (!item || item.price.id === synced.priceId) continue;
    await stripeCall(() => stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: synced.priceId }], proration_behavior: "none" }));
    moved += 1;
    const c = m.customers as { name: string; email: string | null };
    if (c.email) {
      const from = m.current_period_end ? new Date(m.current_period_end).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "long", year: "numeric" }) : "your next renewal";
      await deps.email.send({
        template: "membership_price_change",
        to: c.email,
        subject: `Your Raceground ${tier.name} price is changing`,
        text: `Hi ${c.name},\n\nFrom ${from}, your ${tier.name} membership will be $${(tier.monthly_price_cents / 100).toFixed(2)} a month (incl. GST). Your current month is unchanged.\n\nRaceground`,
        entity: "members",
        entityId: `${m.id}:${synced.priceId}`,
      });
    }
  }
  return { priceId: synced.priceId, members: members.length, moved };
}

// ── First card at the counter ────────────────────────────────────────────────
export async function issueFirstCard(deps: AppDeps, operator: StaffIdentity, memberId: string) {
  // The member may already have their QR (online account): print that same QR instead of replacing it.
  const { data: existing } = await deps.db.from("members").select("id, status, qr_version, qr_token_hash").eq("id", memberId).maybeSingle();
  const current = existing && (existing.status === "active" || existing.status === "cancelling") ? currentMemberQr(deps.env.QR_TOKEN_SECRET, existing) : null;
  if (current) return { qr: current, member: await getMember(deps.db, memberId) };
  const card = await nextMemberCard(deps.db, deps.env.QR_TOKEN_SECRET, memberId);
  const { error } = await deps.db.rpc("membership_issue_first_card", { p_member: memberId, p_staff: operator.id, p_token_hash: card.hash });
  if (error) throw mapDbError(error);
  return { qr: card.qr, member: await getMember(deps.db, memberId) };
}
