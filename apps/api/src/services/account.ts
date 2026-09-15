import type { AccountIdentity, AppDeps } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { currentMemberQr, nextMemberCard } from "../lib/qr.js";
import { requireStripe, stripeCall } from "../lib/stripe.js";
import { changeMemberTier, setCancelAtPeriodEnd, startMembershipCheckout } from "./billing.js";
import { getMember, type MemberSummary } from "./lookup.js";

const MEMBER_COLUMNS =
  "id, member_no, status, tier_id, pending_tier_id, current_period_end, ended_at, stripe_subscription_id, qr_version, qr_token_hash, tier:membership_tiers!members_tier_id_fkey(id, name, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes), pending:membership_tiers!members_pending_tier_id_fkey(id, name, monthly_price_cents)" as const;

type TierInfo = { id: string; name: string; discount_bp: number; monthly_price_cents: number; monthly_free_minutes: number; max_balance_minutes: number };
type MemberRow = {
  id: string;
  member_no: string;
  status: string;
  tier_id: string;
  pending_tier_id: string | null;
  current_period_end: string | null;
  ended_at: string | null;
  stripe_subscription_id: string | null;
  qr_version: number;
  qr_token_hash: string | null;
  tier: TierInfo;
  pending: { id: string; name: string; monthly_price_cents: number } | null;
};

async function customerOf(deps: AppDeps, account: AccountIdentity) {
  const { data, error } = await deps.db.from("customers").select("id, name, email, phone, stripe_customer_id").eq("id", account.customerId).single();
  if (error) throw mapDbError(error);
  return data;
}

async function memberRowOf(deps: AppDeps, customerId: string): Promise<MemberRow | null> {
  const { data, error } = await deps.db.from("members").select(MEMBER_COLUMNS).eq("customer_id", customerId).maybeSingle();
  if (error) throw mapDbError(error);
  return data as unknown as MemberRow | null;
}

async function requireMemberRow(deps: AppDeps, account: AccountIdentity): Promise<MemberRow> {
  const member = await memberRowOf(deps, account.customerId);
  if (!member) throw new ApiError(404, "not_a_member", "This account has no membership");
  return member;
}

/** The member behind an account (for member pricing), or null. */
export async function accountMember(deps: AppDeps, account: AccountIdentity | undefined): Promise<MemberSummary | null> {
  if (!account) return null;
  const member = await memberRowOf(deps, account.customerId);
  return member ? getMember(deps.db, member.id) : null;
}

export async function accountContact(deps: AppDeps, account: AccountIdentity) {
  const c = await customerOf(deps, account);
  return { name: c.name, email: c.email, phone: c.phone };
}

/**
 * Account overview. An active member without a card gets one now, so their QR is always on the account page
 * (derived token: the same QR every time until it is reissued).
 */
export async function getAccount(deps: AppDeps, account: AccountIdentity) {
  const customer = await customerOf(deps, account);
  let member = await memberRowOf(deps, customer.id);
  if (member && !member.qr_token_hash && (member.status === "active" || member.status === "cancelling")) {
    const card = await nextMemberCard(deps.db, deps.env.QR_TOKEN_SECRET, member.id);
    const { error } = await deps.db.rpc("admin_reissue_qr", { p_member: member.id, p_staff: null as unknown as string, p_token_hash: card.hash, p_reason: "First card, member account" });
    if (error) throw mapDbError(error);
    member = await memberRowOf(deps, customer.id);
  }
  const balance = member
    ? ((await deps.db.from("member_balances").select("balance_minutes").eq("member_id", member.id).single()).data?.balance_minutes ?? 0)
    : 0;
  return {
    customer: { name: customer.name, email: customer.email, phone: customer.phone },
    member: member && {
      memberNo: member.member_no,
      status: member.status,
      eligible: member.status === "active" || member.status === "cancelling",
      tier: { id: member.tier.id, name: member.tier.name, discountBp: member.tier.discount_bp, monthlyPriceCents: member.tier.monthly_price_cents, monthlyFreeMinutes: member.tier.monthly_free_minutes, maxBalanceMinutes: member.tier.max_balance_minutes },
      pendingTier: member.pending && { id: member.pending.id, name: member.pending.name, monthlyPriceCents: member.pending.monthly_price_cents },
      currentPeriodEnd: member.current_period_end,
      endedAt: member.ended_at,
      billedOnline: member.stripe_subscription_id !== null,
      balanceMinutes: balance,
      qr: member.status === "active" || member.status === "cancelling" ? currentMemberQr(deps.env.QR_TOKEN_SECRET, member) : null,
    },
    canManageBilling: customer.stripe_customer_id !== null,
  };
}

export async function accountLedger(deps: AppDeps, account: AccountIdentity) {
  const member = await requireMemberRow(deps, account);
  const { data, error } = await deps.db
    .from("member_balance_ledger")
    .select("delta_minutes, kind, reason, created_at, bookings(ref)")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw mapDbError(error);
  return data.map((l) => ({
    minutes: l.delta_minutes,
    kind: l.kind,
    reason: l.reason,
    at: l.created_at,
    bookingRef: (l.bookings as { ref: string } | null)?.ref ?? null,
  }));
}

/** A new QR for the member; every older QR (phone screenshot, printed card) stops working. */
export async function reissueAccountQr(deps: AppDeps, account: AccountIdentity) {
  const member = await requireMemberRow(deps, account);
  if (member.status !== "active" && member.status !== "cancelling") throw new ApiError(409, "member_inactive", "Your membership isn't active");
  const card = await nextMemberCard(deps.db, deps.env.QR_TOKEN_SECRET, member.id);
  const { error } = await deps.db.rpc("admin_reissue_qr", { p_member: member.id, p_staff: null as unknown as string, p_token_hash: card.hash, p_reason: "Reissued by the member" });
  if (error) throw mapDbError(error);
  return { qr: card.qr };
}

export async function startAccountMembership(deps: AppDeps, account: AccountIdentity, tierId: string) {
  const c = await customerOf(deps, account);
  if (!c.email) throw new ApiError(422, "validation_failed", "An email is required for a membership");
  return startMembershipCheckout(deps, null, {
    name: c.name,
    email: c.email,
    phone: c.phone ?? undefined,
    tierId,
    successUrl: `${deps.env.BOOKING_SITE_URL}/account?membership=started`,
    cancelUrl: `${deps.env.BOOKING_SITE_URL}/membership?cancelled=1`,
  });
}

const PORTAL_MARKER = "member_portal_v1";

/** Our Customer Portal setup: card, invoices, cancel at period end. Plan changes stay in our app (spec §2). */
async function portalConfigurationId(deps: AppDeps): Promise<string> {
  const stripe = requireStripe(deps);
  const existing = await stripeCall(() => stripe.billingPortal.configurations.list({ active: true, limit: 100 }));
  const ours = existing.data.find((c) => c.metadata?.raceground === PORTAL_MARKER);
  if (ours) return ours.id;
  const created = await stripeCall(() =>
    stripe.billingPortal.configurations.create({
      business_profile: { headline: "Manage your Raceground membership" },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
        subscription_update: { enabled: false },
        customer_update: { enabled: false },
      },
      default_return_url: `${deps.env.BOOKING_SITE_URL}/account`,
      metadata: { raceground: PORTAL_MARKER },
    }),
  );
  return created.id;
}

export async function billingPortal(deps: AppDeps, account: AccountIdentity) {
  const c = await customerOf(deps, account);
  if (!c.stripe_customer_id) throw new ApiError(409, "not_billed", "There's no online billing for this account");
  const configuration = await portalConfigurationId(deps);
  const session = await stripeCall(() =>
    requireStripe(deps).billingPortal.sessions.create({ customer: c.stripe_customer_id!, configuration, return_url: `${deps.env.BOOKING_SITE_URL}/account` }),
  );
  return { url: session.url };
}

async function requireBilledMember(deps: AppDeps, account: AccountIdentity) {
  const member = await requireMemberRow(deps, account);
  // Complimentary memberships are managed by the venue.
  if (!member.stripe_subscription_id) throw new ApiError(409, "not_billed", "Your membership is managed by the venue. Please ask at the counter.");
  return member;
}

export async function changeAccountTier(deps: AppDeps, account: AccountIdentity, tierId: string) {
  const member = await requireBilledMember(deps, account);
  return changeMemberTier(deps, null, member.id, tierId, "Changed by the member");
}

export async function setAccountCancel(deps: AppDeps, account: AccountIdentity, cancel: boolean) {
  const member = await requireBilledMember(deps, account);
  return setCancelAtPeriodEnd(deps, null, member.id, cancel, cancel ? "Cancelled by the member" : "Resumed by the member");
}
