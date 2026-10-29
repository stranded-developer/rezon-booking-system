import { formatCents, priceExperience, PricingError, type PriceResult } from "@raceground/pricing";
import type { Json } from "@raceground/db";
import type { AppDeps, StaffIdentity } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { buildReceipt, type Tender } from "./charge.js";
import { getMember, getReferral, type MemberSummary, type ReferralSummary } from "./lookup.js";
import { gstOf, loadExperience, loadPromos, loadSettings } from "./venue.js";

/**
 * Walk-in packages (D115): an experience sold at the counter — a fixed length at a flat price, paid
 * before the table starts. Priced exactly as online (priceExperience): promotions such as Happy Hour,
 * the member's flat price or percentage, free play pro rata, or a referral code.
 */

export interface PackageOptions {
  resourceId: string;
  experienceId: string;
  memberId?: string | undefined;
  referralCode?: string | undefined;
  freeMinutes?: number | undefined;
  claimedPromoIds?: string[] | undefined;
}

export interface PackageQuote {
  resourceId: string;
  resourceLabel: string;
  experienceId: string;
  name: string;
  minutes: number;
  startsAt: string;
  endsAt: string;
  pricing: PriceResult;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  explanation: string[];
  member: MemberSummary | null;
  referral: ReferralSummary | null;
  /** Free play is used in whole sessions on a package, as online (D90). */
  freeStepMinutes: number;
  maxFreeMinutes: number;
  /** Prices the customer has to ask for, such as a student price. */
  claimablePromos: { id: string; name: string; priceCents: number }[];
}

/** The packages each kind of table can be sold at the counter, with their list prices. */
export async function counterPackages(deps: AppDeps) {
  const { data, error } = await deps.db
    .from("experiences")
    .select("id, resource_type_id, name, minutes, price_cents")
    .eq("active", true)
    .eq("at_counter", true)
    .order("minutes")
    .order("sort");
  if (error) throw mapDbError(error);
  return data.map((e) => ({ id: e.id, resourceTypeId: e.resource_type_id, name: e.name, minutes: e.minutes, priceCents: e.price_cents }));
}

export async function quotePackage(deps: AppDeps, opts: PackageOptions): Promise<PackageQuote> {
  const { db, clock } = deps;
  const now = clock.now();
  const [settings, exp, resourceRes] = await Promise.all([
    loadSettings(db),
    loadExperience(db, opts.experienceId, "counter"),
    db.from("resources").select("id, label, resource_type_id, active").eq("id", opts.resourceId).maybeSingle(),
  ]);
  if (resourceRes.error) throw mapDbError(resourceRes.error);
  const resource = resourceRes.data;
  if (!resource?.active) throw new ApiError(404, "not_found", "That table isn't available");
  if (resource.resource_type_id !== exp.experience.resourceTypeId) {
    throw new ApiError(422, "package_unavailable", "That package is for a different kind of table");
  }

  if (opts.memberId && opts.referralCode) {
    throw new ApiError(422, "member_and_referral", "A membership and a referral code cannot be used together");
  }
  const member = opts.memberId ? await getMember(db, opts.memberId) : null;
  if (member && !member.eligible) {
    throw new ApiError(409, "member_inactive", `This membership is ${member.status.replace("_", " ")}`, { status: member.status });
  }
  const referral = opts.referralCode ? await getReferral(db, opts.referralCode, now) : null;
  if (referral && !referral.usable) {
    throw new ApiError(409, "referral_invalid", "This referral code can no longer be used", { reason: referral.reason });
  }
  const step = settings.session_minutes;
  const freeMinutes = opts.freeMinutes ?? 0;
  if (freeMinutes > 0 && !member) throw new ApiError(422, "validation_failed", "Free minutes need a member");
  if (freeMinutes % step !== 0) throw new ApiError(422, "validation_failed", `Free play on a package is used ${step} minutes at a time`);
  if (member && freeMinutes > member.balanceMinutes) {
    throw new ApiError(422, "insufficient_balance", "Not enough free-play minutes", { balanceMinutes: member.balanceMinutes });
  }

  // D82: the member's tier's own flat price for this package, if the venue has set one.
  let memberPriceCents: number | undefined;
  if (member) {
    const { data, error } = await db
      .from("experience_member_prices")
      .select("price_cents")
      .eq("experience_id", exp.experience.id)
      .eq("tier_id", member.tierId)
      .maybeSingle();
    if (error) throw mapDbError(error);
    memberPriceCents = data?.price_cents;
  }

  let pricing: PriceResult;
  try {
    pricing = priceExperience({
      startAt: now.getTime(),
      timeZone: settings.timezone,
      experience: exp.experience,
      promos: exp.promos,
      claimedPromoIds: opts.claimedPromoIds ?? [],
      ...(member ? { member: { tierName: member.tierName, discountBp: member.discountBp }, freeMinutes } : {}),
      ...(memberPriceCents !== undefined ? { memberPriceCents } : {}),
      ...(referral ? { referral: { code: referral.code, type: referral.type, value: referral.value } } : {}),
    });
  } catch (err) {
    if (err instanceof PricingError) throw new ApiError(422, "validation_failed", err.message);
    throw err;
  }

  const maxFree = member ? Math.min(member.balanceMinutes, exp.experience.minutes) : 0;
  return {
    resourceId: resource.id,
    resourceLabel: resource.label,
    experienceId: exp.experience.id,
    name: exp.experience.name,
    minutes: exp.experience.minutes,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + exp.experience.minutes * 60_000).toISOString(),
    pricing,
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discount?.amountCents ?? 0,
    totalCents: pricing.totalCents,
    gstCents: pricing.gstCents,
    explanation: pricing.explanation,
    member,
    referral,
    freeStepMinutes: step,
    maxFreeMinutes: maxFree - (maxFree % step),
    claimablePromos: (await loadPromos(db, [exp.experience.id])).filter((p) => p.claimed).map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents })),
  };
}

export interface OpenPackageRequest extends PackageOptions {
  /** The total the till showed; refused if the price has changed since (e.g. Happy Hour just ended). */
  expectedTotalCents: number;
  tender: Tender;
}

/** Take the money and start the table, in one transaction. */
export async function openPackage(deps: AppDeps, operator: StaffIdentity, req: OpenPackageRequest) {
  const quote = await quotePackage(deps, req);
  if (req.expectedTotalCents !== quote.totalCents) {
    throw new ApiError(409, "quote_changed", "The price has changed. Check the new amount before taking payment.", { totalCents: quote.totalCents });
  }
  const totalCents = quote.totalCents;
  if (totalCents > 0 && req.tender.method === "free") throw new ApiError(422, "validation_failed", `Take ${formatCents(totalCents)} by cash or card`);
  const method = totalCents === 0 ? "free" : req.tender.method;
  const tenderedCents = req.tender.method === "cash" && totalCents > 0 ? req.tender.tenderedCents : null;

  const snapshot = {
    mode: "package",
    package: { id: quote.experienceId, name: quote.name, minutes: quote.minutes, endsAt: quote.endsAt },
    pricing: quote.pricing,
    explanation: quote.explanation,
    member: quote.member && { id: quote.member.id, memberNo: quote.member.memberNo, tierName: quote.member.tierName },
    referral: quote.referral && { id: quote.referral.id, code: quote.referral.code, type: quote.referral.type, value: quote.referral.value },
    override: null,
    tender: { method, tenderedCents },
  };

  const { data, error } = await deps.db.rpc("pos_open_package", {
    p_staff: operator.id,
    p: {
      resourceId: quote.resourceId,
      experienceId: quote.experienceId,
      now: quote.startsAt,
      memberId: quote.member?.id ?? null,
      referralCodeId: quote.referral?.id ?? null,
      freeMinutes: quote.pricing.freeMinutes,
      pricing: snapshot,
      totalCents,
      gstCents: gstOf(totalCents),
      discountCents: quote.referral ? quote.discountCents : 0,
      method,
      tenderedCents,
      externalRef: req.tender.method === "card_terminal" ? (req.tender.externalRef ?? null) : null,
    } as unknown as Json,
  });
  if (error) throw mapDbError(error);
  const result = data as { sessionId: string; endsAt: string; changeCents: number; receiptNo: number | null };
  return { sessionId: result.sessionId, endsAt: new Date(result.endsAt).toISOString(), changeCents: result.changeCents, receipt: await buildReceipt(deps, result.sessionId) };
}
