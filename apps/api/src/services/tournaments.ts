import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { formatCents, roundHalfUp, toLocal } from "@raceground/pricing";
import type { Json } from "@raceground/db";
import type { AppDeps } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { requireStripe, stripeCall } from "../lib/stripe.js";
import type { MemberSummary } from "./lookup.js";
import { loadSettings } from "./venue.js";

/**
 * Tournaments (D68). The shape of this is deliberately the same as a booking: quote, hold with a
 * spot reserved, Stripe Checkout, confirm on the webhook, release on expiry. The rules that matter
 * (spots, duplicates, free entries) live in the database functions, not here.
 */

export const hashEntryToken = (token: string) => createHash("sha256").update(token).digest("hex");

const entryLink = (deps: AppDeps, ref: string, token: string) =>
  `${deps.env.BOOKING_SITE_URL}/tournaments/${ref}?token=${encodeURIComponent(token)}`;

function venueText(instant: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(instant)
    .replace(/,/g, "");
  return { date, time: toLocal(instant.getTime(), timeZone).label.slice(11) };
}

// ── Listing ──────────────────────────────────────────────────────────────────

export interface PublicTournament {
  id: string;
  name: string;
  blurb: string | null;
  startsAt: string;
  venueDate: string;
  venueTime: string;
  spots: number;
  spotsLeft: number;
  entryFeeCents: number;
  full: boolean;
}

/** Published tournaments that have not started yet, soonest first, with spots left. */
export async function listTournaments(deps: AppDeps): Promise<{ timeZone: string; tournaments: PublicTournament[] }> {
  const now = deps.clock.now();
  const settings = await loadSettings(deps.db);
  await deps.db.rpc("expire_stale_tournament_holds", { p_now: now.toISOString() });

  const { data, error } = await deps.db
    .from("tournaments")
    .select("id, name, blurb, starts_at, spots, entry_fee_cents, sort")
    .eq("published", true)
    .gt("starts_at", now.toISOString())
    .order("starts_at");
  if (error) throw mapDbError(error);

  // One query for every live entry, rather than one call per tournament.
  const ids = data.map((t) => t.id);
  const taken = new Map<string, number>();
  if (ids.length > 0) {
    const { data: entries, error: entryError } = await deps.db
      .from("tournament_entries")
      .select("tournament_id, status, hold_expires_at")
      .in("tournament_id", ids)
      .in("status", ["held", "confirmed"]);
    if (entryError) throw mapDbError(entryError);
    for (const e of entries) {
      if (e.status === "held" && !(e.hold_expires_at && new Date(e.hold_expires_at) > now)) continue;
      taken.set(e.tournament_id, (taken.get(e.tournament_id) ?? 0) + 1);
    }
  }

  return {
    timeZone: settings.timezone,
    tournaments: data.map((t) => {
      const startsAt = new Date(t.starts_at);
      const v = venueText(startsAt, settings.timezone);
      const spotsLeft = Math.max(0, t.spots - (taken.get(t.id) ?? 0));
      return {
        id: t.id,
        name: t.name,
        blurb: t.blurb,
        startsAt: startsAt.toISOString(),
        venueDate: v.date,
        venueTime: v.time,
        spots: t.spots,
        spotsLeft,
        entryFeeCents: t.entry_fee_cents,
        full: spotsLeft === 0,
      };
    }),
  };
}

// ── Signing up ───────────────────────────────────────────────────────────────

export interface SignUpRequest {
  tournamentId: string;
  customer?: { name: string; email?: string | undefined; phone?: string | undefined } | undefined;
  expectedTotalCents: number;
}

export type SignUpResult =
  | { status: "confirmed"; entryId: string; ref: string; token: string; freeEntry: boolean }
  | { status: "pending_payment"; entryId: string; ref: string; token: string; checkoutUrl: string; holdExpiresAt: string };

/**
 * What an entry costs this person. A member's percentage applies to the entry fee, the same
 * way it applies to a booking. There is no referral on an entry.
 */
export function quoteEntry(entryFeeCents: number, member: MemberSummary | null) {
  const totalCents = member
    ? Number(roundHalfUp(BigInt(entryFeeCents) * BigInt(10_000 - member.discountBp), 10_000n))
    : entryFeeCents;
  const gstCents = Number(roundHalfUp(BigInt(totalCents), 11n));
  const explanation = [`Entry fee  ${formatCents(entryFeeCents)}`];
  if (member && totalCents !== entryFeeCents) {
    explanation.push(`${member.tierName} member ${member.discountBp / 100}%  ${formatCents(-(entryFeeCents - totalCents))}`);
  }
  explanation.push(`Total (incl. GST ${formatCents(gstCents)})  ${formatCents(totalCents)}`);
  return { entryFeeCents, totalCents, gstCents, explanation };
}

export async function signUp(
  deps: AppDeps,
  req: SignUpRequest,
  member: MemberSummary | null,
  accountContact: { name: string; email: string | null; phone: string | null } | null = null,
): Promise<SignUpResult> {
  const now = deps.clock.now();
  const settings = await loadSettings(deps.db);

  const { data: tournament, error } = await deps.db
    .from("tournaments")
    .select("id, name, starts_at, entry_fee_cents, published")
    .eq("id", req.tournamentId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!tournament || !tournament.published) throw new ApiError(404, "not_found", "That tournament is not open for sign-ups");

  const quote = quoteEntry(tournament.entry_fee_cents, member);
  if (req.expectedTotalCents !== quote.totalCents) {
    throw new ApiError(409, "quote_changed", `Entry is now ${formatCents(quote.totalCents)}. Please check it before paying.`, { quote });
  }
  const guest = member ? null : (req.customer ?? accountContact);
  if (!member && !guest) throw new ApiError(422, "validation_failed", "Your name and an email or phone number are required");
  if (quote.totalCents > 0) requireStripe(deps);

  const token = randomBytes(32).toString("base64url");
  const { data: entry, error: holdError } = await deps.db.rpc("tournament_hold", {
    p: {
      tournamentId: tournament.id,
      now: now.toISOString(),
      memberId: member?.id ?? null,
      customer: guest,
      totalCents: quote.totalCents,
      gstCents: quote.gstCents,
      pricing: { source: "online", ...quote, member: member && { id: member.id, memberNo: member.memberNo, tierName: member.tierName } },
      cancelTokenHash: hashEntryToken(token),
    } as unknown as Json,
  });
  if (holdError) throw mapDbError(holdError);

  // A free entry, or a free tournament, is confirmed by the database itself.
  if (entry.status === "confirmed") {
    await sendEntryConfirmation(deps, entry.id, token);
    return { status: "confirmed", entryId: entry.id, ref: entry.ref, token, freeEntry: entry.free_entry };
  }

  const stripe = requireStripe(deps);
  const v = venueText(new Date(tournament.starts_at), settings.timezone);
  const link = entryLink(deps, entry.ref, token);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripeCall(() =>
      stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "aud",
                unit_amount: quote.totalCents,
                product_data: {
                  name: `${tournament.name} — entry`,
                  description: `${v.date}, ${v.time} (Sydney time) · entry ${entry.ref}`,
                },
              },
            },
          ],
          ...((member?.email ?? guest?.email) ? { customer_email: (member?.email ?? guest?.email)! } : {}),
          client_reference_id: entry.id,
          metadata: { tournament_entry_id: entry.id, tournament_entry_ref: entry.ref, tournament_entry_token: token },
          payment_intent_data: {
            metadata: { tournament_entry_id: entry.id, tournament_entry_ref: entry.ref },
            description: `Raceground tournament entry ${entry.ref}`,
          },
          payment_method_types: ["card"],
          success_url: `${link}&paid=1`,
          cancel_url: `${link}&abandoned=1`,
          expires_at: Math.floor(now.getTime() / 1000) + settings.hold_ttl_minutes * 60 + 60,
          adaptive_pricing: { enabled: false },
        },
        { idempotencyKey: `tournament-checkout-${entry.id}` },
      ),
    );
  } catch (err) {
    await deps.db.rpc("tournament_release_hold", { p_entry: entry.id });
    throw err;
  }
  const { error: attachError } = await deps.db.rpc("tournament_attach_checkout", { p_entry: entry.id, p_checkout_session_id: session.id });
  if (attachError) {
    await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    throw mapDbError(attachError);
  }
  return { status: "pending_payment", entryId: entry.id, ref: entry.ref, token, checkoutUrl: session.url!, holdExpiresAt: entry.hold_expires_at! };
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

const paymentIntentOf = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

/** checkout.session.completed for a tournament entry. False when it isn't one of ours. */
export async function handleEntryCheckoutCompleted(deps: AppDeps, session: Stripe.Checkout.Session): Promise<boolean> {
  const entryId = session.metadata?.tournament_entry_id;
  if (!entryId) return false;
  if (session.payment_status !== "paid") return false;
  if (session.currency !== "aud") {
    throw new ApiError(500, "unexpected_currency", `Checkout ${session.id} is in ${session.currency}, expected aud`);
  }
  const { error } = await deps.db.rpc("tournament_confirm", {
    p_entry: entryId,
    p: {
      paymentIntentId: paymentIntentOf(session),
      checkoutSessionId: session.id,
      amountPaidCents: session.amount_total,
      email: session.customer_details?.email ?? null,
    },
  });
  if (error) {
    const mapped = mapDbError(error);
    // A hold that lapsed before the payment landed is refunded, not forced through.
    if (mapped.code !== "hold_expired" && mapped.code !== "amount_mismatch") throw mapped;
    const intent = paymentIntentOf(session);
    if (intent && deps.stripe) {
      await stripeCall(() => deps.stripe!.refunds.create({ payment_intent: intent }, { idempotencyKey: `tournament-refund-${entryId}` })).catch(() => undefined);
    }
    return true;
  }
  await sendEntryConfirmation(deps, entryId, session.metadata?.tournament_entry_token ?? null);
  return true;
}

export async function handleEntryCheckoutExpired(deps: AppDeps, session: Stripe.Checkout.Session): Promise<boolean> {
  const entryId = session.metadata?.tournament_entry_id;
  if (!entryId) return false;
  const { error } = await deps.db.rpc("tournament_release_hold", { p_entry: entryId });
  if (error) throw mapDbError(error);
  return true;
}

// ── Reading one entry back ───────────────────────────────────────────────────

const ENTRY_SELECT = "*, tournaments!inner(name, blurb, starts_at), customers!inner(name, email, phone)" as const;

interface EntryRow {
  id: string;
  ref: string;
  status: string;
  free_entry: boolean;
  total_cents: number | null;
  gst_cents: number | null;
  hold_expires_at: string | null;
  cancel_token_hash: string | null;
  pricing_snapshot: { explanation?: string[] } | null;
  tournaments: { name: string; blurb: string | null; starts_at: string };
  customers: { name: string; email: string | null; phone: string | null };
}

async function entryByLink(deps: AppDeps, ref: string, token: string): Promise<EntryRow> {
  const { data, error } = await deps.db.from("tournament_entries").select(ENTRY_SELECT).eq("ref", ref.trim().toUpperCase()).maybeSingle();
  if (error) throw mapDbError(error);
  const row = data as unknown as EntryRow | null;
  const given = Buffer.from(hashEntryToken(token), "hex");
  const stored = Buffer.from(row?.cancel_token_hash ?? "", "hex");
  if (!row || stored.length !== given.length || !timingSafeEqual(stored, given)) {
    throw new ApiError(404, "not_found", "Entry not found. Check the link in your email.");
  }
  return row;
}

export async function viewEntry(deps: AppDeps, ref: string, token: string) {
  const e = await entryByLink(deps, ref, token);
  const settings = await loadSettings(deps.db);
  const v = venueText(new Date(e.tournaments.starts_at), settings.timezone);
  return {
    entry: {
      ref: e.ref,
      status: e.status,
      freeEntry: e.free_entry,
      totalCents: e.total_cents,
      gstCents: e.gst_cents,
      explanation: e.pricing_snapshot?.explanation ?? [],
      holdExpiresAt: e.status === "held" ? e.hold_expires_at : null,
      customerName: e.customers.name,
      checkInCode: `rg:t:${e.ref}`,
      tournament: { name: e.tournaments.name, blurb: e.tournaments.blurb, venueDate: v.date, venueTime: v.time, timeZone: settings.timezone },
    },
  };
}

export async function sendEntryConfirmation(deps: AppDeps, entryId: string, token: string | null) {
  const { data, error } = await deps.db.from("tournament_entries").select(ENTRY_SELECT).eq("id", entryId).single();
  if (error) throw mapDbError(error);
  const e = data as unknown as EntryRow;
  if (!e.customers.email) return { sent: false };
  const settings = await loadSettings(deps.db);
  const v = venueText(new Date(e.tournaments.starts_at), settings.timezone);
  const paid = e.free_entry
    ? "Entry: included with your membership"
    : `Paid: ${formatCents(e.total_cents ?? 0)} (incl. GST ${formatCents(e.gst_cents ?? 0)})`;
  const link = token ? `\n\nYour entry: ${entryLink(deps, e.ref, token)}` : "";
  const text = `Hi ${e.customers.name},\n\nYou're in.\n\nEntry code: ${e.ref}\n${e.tournaments.name}\n${v.date}, ${v.time} (Sydney time)\n${paid}\n\nShow your entry code at the counter when you arrive.${link}\n\nRaceground`;
  return deps.email.send({
    template: "tournament_entry_confirmed",
    to: e.customers.email,
    subject: `Raceground: you're entered in ${e.tournaments.name}`,
    text,
    entity: "tournament_entries",
    entityId: `${e.id}:confirmed`,
  });
}
