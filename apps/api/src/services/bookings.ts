import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import {
  addDaysToDate,
  formatCents,
  isWallTime,
  localToInstant,
  priceExperience,
  priceSession,
  PricingError,
  toLocal,
  type ExperiencePromo,
  type PriceResult,
} from "@raceground/pricing";
import type { Db, Json } from "@raceground/db";
import type { AppDeps } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { writeAudit } from "../lib/audit.js";
import { buildIcs } from "../lib/ics.js";
import { selectAll } from "../lib/select-all.js";
import { requireStripe, stripeCall } from "../lib/stripe.js";
import { experienceHappyHour, sessionHappyHour, type HappyHourPrice } from "./happy-hour.js";
import { getReferral, type MemberSummary, type ReferralSummary } from "./lookup.js";
import { loadExperience, loadPricingContext, loadPromos, loadSettings, parseRange, toExperience, wallTime, type ExperienceContext } from "./venue.js";
import { listTiles } from "./site-tiles.js";
import { listPhotos } from "./venue-photos.js";

const MINUTE_MS = 60_000;
/** Availability scans the day in quarter hours; only starts on the session grid are offered (D90). */
const SLOT_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hashBookingToken = (token: string) => createHash("sha256").update(token).digest("hex");

const bookingLink = (deps: AppDeps, ref: string, token: string) => `${deps.env.BOOKING_SITE_URL}/booking/${ref}?token=${encodeURIComponent(token)}`;

/** "Tue 15 Jan 2030" and "12:00" in venue time. */
function venueText(instant: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(instant)
    .replace(/,/g, "");
  return { date, time: toLocal(instant.getTime(), timeZone).label.slice(11) };
}

async function activeType(deps: AppDeps, idOrKey: string) {
  const query = deps.db.from("resource_types").select("id, key, name, base_rate_cents, min_minutes, active");
  const { data, error } = await (UUID.test(idOrKey) ? query.eq("id", idOrKey) : query.eq("key", idOrKey)).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data || !data.active) throw new ApiError(404, "not_found", "That kind of booking isn't available");
  return data;
}

async function activeResources(deps: AppDeps, typeId: string) {
  const { data, error } = await deps.db.from("resources").select("id, label, sort").eq("resource_type_id", typeId).eq("active", true).order("sort").order("label");
  if (error) throw mapDbError(error);
  return data;
}

// ── Public config ────────────────────────────────────────────────────────────
export async function publicConfig(deps: AppDeps) {
  const { db, clock } = deps;
  const nowIso = clock.now().toISOString();
  const [settings, types, resources, hours, hhs, tiers, bands, photos, experiences, events, games] = await Promise.all([
    loadSettings(db),
    db.from("resource_types").select("id, key, name, base_rate_cents, min_minutes, sort").eq("active", true).order("sort"),
    db.from("resources").select("id, label, resource_type_id, sort").eq("active", true).order("sort").order("label"),
    db.from("opening_hours").select("*").order("day_of_week"),
    db.from("happy_hours").select("*").eq("active", true),
    db.from("membership_tiers").select("id, name, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes, perks, stripe_price_id, sort").eq("active", true).order("sort"),
    db.from("rate_bands").select("*").eq("active", true),
    listPhotos(db),
    db.from("experiences").select("*").eq("active", true).order("sort"),
    db
      .from("site_events")
      .select("*")
      .eq("active", true)
      .or(`show_from.is.null,show_from.lte.${nowIso}`)
      .or(`show_until.is.null,show_until.gte.${nowIso}`)
      .order("sort"),
    loadGames(db),
  ]);
  const [memberPrices, tiles] = await Promise.all([
    db.from("experience_member_prices").select("experience_id, tier_id, price_cents"),
    listTiles(db, { activeOnly: true }),
  ]);
  if (memberPrices.error) throw mapDbError(memberPrices.error);
  for (const r of [types, resources, hours, hhs, tiers, bands, experiences, events]) if (r.error) throw mapDbError(r.error);
  const promos = await loadPromos(db, experiences.data!.map((e) => e.id));
  return {
    businessName: settings.business_name ?? "Racegrounds",
    venue: {
      address: settings.address,
      phone: settings.phone,
      email: settings.contact_email,
      intro: settings.intro,
      instagramUrl: settings.instagram_url,
    },
    photos: photos.map((p) => ({ url: p.url, caption: p.caption })),
    timeZone: settings.timezone,
    today: toLocal(clock.now().getTime(), settings.timezone).date,
    sessionMinutes: settings.session_minutes,
    bookingWindowDays: settings.booking_window_days,
    // D110: the first date that can be booked online, or null for from today.
    bookingsOpenFrom: settings.bookings_open_from,
    onlineCutoffMinutes: settings.online_cutoff_minutes,
    holdMinutes: settings.hold_ttl_minutes,
    noShowHoldMinutes: settings.no_show_hold_minutes,
    arriveEarlyMinutes: settings.arrive_early_minutes,
    // D101: full refund 24 hours or more before; inside that, no online cancelling and no refund.
    refundPolicy: { fullRefundHoursBefore: 24 },
    resourceTypes: types.data!.map((t) => {
      // The cheapest hourly rate anyone could pay, the same idea as an experience's "from" price:
      // a rate band in a happy-hour window is what makes a billiard table $20 rather than $25.
      const bandRates = bands.data!.filter((b) => b.resource_type_id === t.id).map((b) => b.rate_cents);
      return {
        id: t.id,
        key: t.key,
        name: t.name,
        baseRateCents: t.base_rate_cents,
        fromRateCents: Math.min(t.base_rate_cents, ...bandRates),
        minMinutes: t.min_minutes,
        resources: resources.data!.filter((r) => r.resource_type_id === t.id).map((r) => ({ id: r.id, label: r.label })),
      };
    }),
    openingHours: hours.data!.map((h) => ({ dayOfWeek: h.day_of_week, open: wallTime(h.open_time), close: wallTime(h.close_time), closed: h.closed })),
    happyHours: hhs.data!.map((h) => ({
      name: h.name,
      resourceTypeIds: h.resource_type_ids,
      daysOfWeek: h.days_of_week,
      startTime: wallTime(h.start_time),
      endTime: wallTime(h.end_time),
      discountBp: h.discount_bp,
    })),
    rateBands: bands.data!.map((b) => ({
      resourceTypeId: b.resource_type_id,
      daysOfWeek: b.days_of_week,
      startTime: wallTime(b.start_time),
      endTime: wallTime(b.end_time),
      rateCents: b.rate_cents,
    })),
    tiers: tiers.data!.map((t) => ({
      id: t.id,
      name: t.name,
      discountBp: t.discount_bp,
      monthlyPriceCents: t.monthly_price_cents,
      monthlyFreeMinutes: t.monthly_free_minutes,
      maxBalanceMinutes: t.max_balance_minutes,
      perks: t.perks,
      sellable: t.stripe_price_id !== null,
    })),
    experiences: experiences.data!.map((e) => {
      const mine = promos.filter((p) => p.experienceId === e.id);
      return {
        id: e.id,
        key: e.key,
        name: e.name,
        resourceTypeId: e.resource_type_id,
        tagline: e.tagline,
        bullets: e.bullets,
        badges: e.badges,
        // The card's button (D98); null = "Book <name>".
        buttonLabel: e.button_label,
        minutes: e.minutes,
        priceCents: e.price_cents,
        // What the card shows as "from": the cheapest price anyone could pay today.
        fromPriceCents: Math.min(e.price_cents, ...mine.filter((p) => !p.claimed).map((p) => p.priceCents)),
        // Each tier's flat price (D82); a tier missing here pays its percentage off the list price.
        memberPrices: memberPrices.data!.filter((m) => m.experience_id === e.id).map((m) => ({ tierId: m.tier_id, priceCents: m.price_cents })),
        promos: mine.map((p) => ({
          id: p.id,
          name: p.name,
          daysOfWeek: p.daysOfWeek,
          startTime: p.startTime,
          endTime: p.endTime,
          priceCents: p.priceCents,
          claimed: p.claimed,
        })),
      };
    }),
    events: events.data!.map((e) => ({
      id: e.id,
      title: e.title,
      body: e.body,
      detail: e.detail,
      ctaLabel: e.cta_label,
      ctaUrl: e.cta_url,
      asPopup: e.as_popup,
      asBanner: e.as_banner,
    })),
    games,
    // The home page's image tiles (D87), by section and in order.
    tiles: tiles.map((t) => ({ id: t.id, section: t.section, title: t.title, imageUrl: t.imageUrl })),
  };
}

// ── Games, tracks and cars (D80) ─────────────────────────────────────────────
export interface GameOption {
  id: string;
  name: string;
  resourceTypeId: string;
  tracks: { id: string; name: string }[];
  cars: { id: string; name: string }[];
}

/** The active games with their active tracks and cars, in the venue's order. */
async function loadGames(db: Db): Promise<GameOption[]> {
  // Each game can list up to 1000 tracks and cars, so these are read a page at a time.
  const [games, tracks, cars] = await Promise.all([
    db.from("games").select("id, name, resource_type_id").eq("active", true).order("sort").order("name"),
    selectAll((from, to) => db.from("game_tracks").select("id, game_id, name").eq("active", true).order("sort").order("name").order("id").range(from, to)),
    selectAll((from, to) => db.from("game_cars").select("id, game_id, name").eq("active", true).order("sort").order("name").order("id").range(from, to)),
  ]);
  if (games.error) throw mapDbError(games.error);
  return games.data.map((g) => ({
    id: g.id,
    name: g.name,
    resourceTypeId: g.resource_type_id,
    tracks: tracks.filter((t) => t.game_id === g.id).map((t) => ({ id: t.id, name: t.name })),
    cars: cars.filter((c) => c.game_id === g.id).map((c) => ({ id: c.id, name: c.name })),
  }));
}

export interface SimSetupRequest {
  gameId: string;
  trackId?: string | undefined;
  carId?: string | undefined;
}

/**
 * Turn a pick into the names the booking keeps. The ids must belong together — the track and car
 * from that game, the game for what is being booked — so a booking never says "Monaco in ACC".
 */
async function resolveSimSetup(deps: AppDeps, pick: SimSetupRequest, resourceTypeId: string) {
  const games = await loadGames(deps.db);
  const game = games.find((g) => g.id === pick.gameId && g.resourceTypeId === resourceTypeId);
  if (!game) throw new ApiError(422, "validation_failed", "That game isn't available for this booking");
  const track = pick.trackId ? game.tracks.find((t) => t.id === pick.trackId) : undefined;
  if (pick.trackId && !track) throw new ApiError(422, "validation_failed", `That track isn't available in ${game.name}`);
  const car = pick.carId ? game.cars.find((c) => c.id === pick.carId) : undefined;
  if (pick.carId && !car) throw new ApiError(422, "validation_failed", `That car isn't available in ${game.name}`);
  return { game: game.name, ...(track ? { track: track.name } : {}), ...(car ? { car: car.name } : {}) };
}

// ── Availability ─────────────────────────────────────────────────────────────
interface Busy {
  resourceId: string;
  start: number;
  end: number;
}

async function busyPeriods(deps: AppDeps, resourceIds: string[], from: number, to: number, now: Date): Promise<Busy[]> {
  if (resourceIds.length === 0) return [];
  const { data, error } = await deps.db
    .from("bookings")
    .select("resource_id, period, status, hold_expires_at")
    .in("resource_id", resourceIds)
    .in("status", ["held", "confirmed", "arrived"])
    .overlaps("period", `[${new Date(from).toISOString()},${new Date(to).toISOString()})`);
  if (error) throw mapDbError(error);
  return data
    .filter((b) => b.status !== "held" || (b.hold_expires_at !== null && new Date(b.hold_expires_at) > now))
    .map((b) => {
      const { start, end } = parseRange(b.period);
      return { resourceId: b.resource_id, start: start.getTime(), end: end.getTime() };
    });
}

/** Longest bookable length (whole sessions) on a resource from `start`, or 0 if it's taken at `start`. */
function maxMinutesFrom(start: number, closeAt: number, busy: Busy[], sessionMinutes: number): number {
  let limit = closeAt;
  for (const b of busy) {
    if (b.start <= start && b.end > start) return 0;
    if (b.start > start && b.start < limit) limit = b.start;
  }
  return Math.max(0, Math.floor((limit - start) / (sessionMinutes * MINUTE_MS)) * sessionMinutes);
}

/** D90: online bookings start on the session grid of the venue's clock — :00 and :30 for a 30-minute session. */
function onSessionGrid(wallTime: string, sessionMinutes: number): boolean {
  const [h, m] = wallTime.split(":").map(Number);
  return (h! * 60 + m!) % sessionMinutes === 0;
}

/**
 * What is free on one day.
 *
 * With `experienceKey`, the length asked of every resource is the experience's own fixed length,
 * so "3 spots" means three simulators free for the whole Double Race, not for half of it (D65, D70).
 */
export async function availability(deps: AppDeps, typeIdOrKey: string, date: string, experienceKey?: string) {
  const now = deps.clock.now();
  const settings = await loadSettings(deps.db);
  const tz = settings.timezone;
  const exp = experienceKey ? await loadExperience(deps.db, experienceKey) : null;
  const type = await activeType(deps, exp ? exp.experience.resourceTypeId : typeIdOrKey);
  if (exp && exp.experience.resourceTypeId !== type.id) {
    throw new ApiError(404, "not_found", "That experience isn't available here");
  }
  const resources = await activeResources(deps, type.id);
  const today = toLocal(now.getTime(), tz).date;
  const lastDate = addDaysToDate(today, settings.booking_window_days);
  // D110: nothing can be booked before the day bookings open.
  const firstDate = settings.bookings_open_from && settings.bookings_open_from > today ? settings.bookings_open_from : today;
  const dayOfWeek = toLocal(localToInstant(date, "12:00", tz), tz).isoDayOfWeek;
  const { data: hours, error } = await deps.db.from("opening_hours").select("*").eq("day_of_week", dayOfWeek).maybeSingle();
  if (error) throw mapDbError(error);

  // Bookings are sold in sessions; the resource type's own minimum is for walk-ins at the counter.
  // An experience overrides that with its own fixed length.
  const sessionMinutes = settings.session_minutes;
  const requiredMinutes = exp ? exp.experience.minutes : sessionMinutes;
  const base = {
    date,
    timeZone: tz,
    today,
    firstDate,
    lastDate,
    sessionMinutes,
    requiredMinutes,
    experience: exp
      ? { id: exp.experience.id, key: exp.experience.key, name: exp.experience.name, minutes: exp.experience.minutes }
      : null,
    resourceType: { id: type.id, key: type.key, name: type.name, minMinutes: requiredMinutes, baseRateCents: type.base_rate_cents },
    resources: resources.map((r) => ({ id: r.id, label: r.label })),
    open: hours ? wallTime(hours.open_time) : null,
    close: hours ? wallTime(hours.close_time) : null,
    closed: !hours || hours.closed,
    inWindow: date >= firstDate && date <= lastDate,
  };
  if (base.closed || !base.inWindow || resources.length === 0) return { ...base, slots: [] };

  const openAt = localToInstant(date, base.open!, tz);
  const closeAt = localToInstant(date, base.close!, tz);
  const earliest = now.getTime() + settings.online_cutoff_minutes * MINUTE_MS;
  const busy = await busyPeriods(deps, resources.map((r) => r.id), openAt, closeAt, now);
  // D99: each start time says whether it is in happy hour, priced by the engine itself.
  const pricingCtx = exp ? null : await loadPricingContext(deps.db, type.id, tz);
  const happyHourAt = (t: number) => (exp ? experienceHappyHour(exp, t, tz) : sessionHappyHour(pricingCtx!, t, requiredMinutes));

  const slots = [];
  for (let t = openAt; t + requiredMinutes * MINUTE_MS <= closeAt; t += SLOT_MINUTES * MINUTE_MS) {
    if (t < earliest) continue;
    const time = toLocal(t, tz).label.slice(11);
    if (!onSessionGrid(time, sessionMinutes)) continue;
    const resourceMaxMinutes: Record<string, number> = {};
    for (const r of resources) {
      const max = maxMinutesFrom(
        t,
        closeAt,
        busy.filter((b) => b.resourceId === r.id),
        sessionMinutes,
      );
      resourceMaxMinutes[r.id] = max >= requiredMinutes ? max : 0;
    }
    const lengths = Object.values(resourceMaxMinutes);
    slots.push({
      time,
      startsAt: new Date(t).toISOString(),
      availableResources: lengths.filter((m) => m > 0).length,
      maxMinutes: Math.max(0, ...lengths),
      resourceMaxMinutes,
      happyHour: happyHourAt(t),
    });
  }
  return { ...base, slots };
}

// ── Referral and quote ───────────────────────────────────────────────────────
/** Referral status for online use: live holds count as reserved uses. */
export async function checkReferral(deps: AppDeps, code: string, now: Date): Promise<ReferralSummary> {
  const referral = await getReferral(deps.db, code, now);
  if (!referral.usable) return referral;
  const { count, error } = await deps.db
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("referral_code_id", referral.id)
    .eq("status", "held")
    .gt("hold_expires_at", now.toISOString());
  if (error) throw mapDbError(error);
  if (referral.usesCount + (count ?? 0) >= referral.maxUses) return { ...referral, usable: false, reason: "used_up" };
  return referral;
}

export interface BookingRequest {
  /** Ignored when `experienceKey` is given: the experience knows its own resource type. */
  resourceTypeId?: string | undefined;
  /** An experience is a fixed length at a flat price (D65). It replaces `durationMinutes`. */
  experienceKey?: string | undefined;
  date: string;
  startTime: string;
  durationMinutes?: number | undefined;
  referralCode?: string | undefined;
  freeMinutes?: number | undefined;
  /** The customer has asked for a price that has to be claimed, e.g. the student price (D66). */
  claimedPromoIds?: string[] | undefined;
  /** D106: people on a simulator session, each on their own simulator. Default 1. */
  partySize?: number | undefined;
}

export interface BookingQuote {
  resourceTypeId: string;
  resourceTypeName: string;
  experience: { id: string; key: string; name: string; minutes: number; listPriceCents: number } | null;
  /** The promotional prices the customer could still ask for at this start time (D66). */
  claimablePromos: { id: string; name: string; priceCents: number }[];
  /** Set when happy hour set this price: its name, and the price for this booking with and without it (D99). */
  happyHour: HappyHourPrice | null;
  /** People, each on their own simulator (D106). */
  partySize: number;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  pricing: PriceResult;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  explanation: string[];
  referral: { id: string; code: string; type: "percent" | "fixed"; value: number } | null;
  member: { id: string; memberNo: string; tierName: string; discountBp: number; balanceMinutes: number } | null;
  maxFreeMinutes: number;
}

/**
 * Prices a booking with the one engine. `member` is the signed-in, eligible member (6b-2), else null.
 *
 * Two ways in, as the engine has: an **experience** is a fixed length at a flat price (D65);
 * anything else is a length of time at an hourly rate.
 */
export async function quoteBooking(deps: AppDeps, req: BookingRequest, member: MemberSummary | null): Promise<BookingQuote> {
  const now = deps.clock.now();
  const settings = await loadSettings(deps.db);
  const tz = settings.timezone;
  const sessionMinutes = settings.session_minutes;

  const exp: ExperienceContext | null = req.experienceKey ? await loadExperience(deps.db, req.experienceKey) : null;
  if (!exp && !req.resourceTypeId) throw new ApiError(422, "validation_failed", "Choose what you'd like to book");
  const type = await activeType(deps, exp ? exp.experience.resourceTypeId : req.resourceTypeId!);

  if (!isWallTime(req.startTime)) throw new ApiError(422, "validation_failed", "Start time must be HH:MM");
  // An experience sets its own length; everything else is sold in whole sessions (D90).
  const durationMinutes = exp ? exp.experience.minutes : (req.durationMinutes ?? 0);
  if (!exp && (durationMinutes < sessionMinutes || durationMinutes % sessionMinutes !== 0)) {
    throw new ApiError(422, "validation_failed", `Bookings are in ${sessionMinutes}-minute sessions`);
  }
  if (!onSessionGrid(req.startTime, sessionMinutes)) {
    throw new ApiError(422, "invalid_time", `Bookings start on a ${sessionMinutes}-minute mark, e.g. on the hour`);
  }
  const startAt = localToInstant(req.date, req.startTime, tz);
  if (toLocal(startAt, tz).label !== `${req.date} ${req.startTime}`) {
    throw new ApiError(422, "invalid_time", "That time doesn't exist on this day (daylight saving change)");
  }
  const endAt = startAt + durationMinutes * MINUTE_MS;
  // D110: the quote says so before the hold would.
  if (settings.bookings_open_from && req.date < settings.bookings_open_from) {
    throw new ApiError(422, "not_open_yet", `Bookings start on ${venueText(new Date(localToInstant(settings.bookings_open_from, "12:00", tz)), tz).date}`);
  }
  // D106: a group is for simulator sessions (experiences); billiards stays one table per booking.
  const partySize = req.partySize ?? 1;
  if (!Number.isInteger(partySize) || partySize < 1) throw new ApiError(422, "validation_failed", "How many people?");
  if (partySize > 1) {
    if (!exp) throw new ApiError(422, "validation_failed", `A ${type.name} is booked as one, not per person`);
    const places = (await activeResources(deps, type.id)).length;
    if (partySize > places) throw new ApiError(422, "validation_failed", `We have ${places} ${type.name.toLowerCase()}s, so up to ${places} people`);
  }
  if (member && req.referralCode) throw new ApiError(422, "member_and_referral", "A membership and a referral code cannot be used together");
  if (member && !member.eligible) throw new ApiError(409, "member_inactive", "This membership is not active");

  const referral = req.referralCode ? await checkReferral(deps, req.referralCode, now) : null;
  if (referral && !referral.usable) {
    throw new ApiError(409, "referral_invalid", "This referral code can no longer be used", { reason: referral.reason });
  }
  const freeMinutes = req.freeMinutes ?? 0;
  if (freeMinutes > 0 && !member) throw new ApiError(422, "validation_failed", "Free minutes need a member");
  // Free play is spent the way the time is sold: whole sessions (D90). The quote has to check
  // this itself — it never reaches the database, so a wrong amount here would price the booking
  // wrongly and only fail at payment.
  if (freeMinutes > 0 && freeMinutes % sessionMinutes !== 0) {
    throw new ApiError(
      422,
      "validation_failed",
      `Free play on ${exp ? exp.experience.name : "a booking"} is used ${sessionMinutes} minutes at a time`,
    );
  }
  if (member && freeMinutes > member.balanceMinutes) {
    throw new ApiError(422, "insufficient_balance", "Not enough free-play minutes", { balanceMinutes: member.balanceMinutes });
  }

  // D82: the member's tier's own flat price for this experience, if the venue has set one.
  let memberPriceCents: number | undefined;
  if (exp && member) {
    const { data, error } = await deps.db
      .from("experience_member_prices")
      .select("price_cents")
      .eq("experience_id", exp.experience.id)
      .eq("tier_id", member.tierId)
      .maybeSingle();
    if (error) throw mapDbError(error);
    memberPriceCents = data?.price_cents;
  }

  let pricing: PriceResult;
  let pricingCtx: Awaited<ReturnType<typeof loadPricingContext>> | null = null;
  try {
    if (exp) {
      pricing = priceExperience({
        startAt,
        timeZone: tz,
        experience: exp.experience,
        promos: exp.promos,
        claimedPromoIds: req.claimedPromoIds ?? [],
        ...(member ? { member: { tierName: member.tierName, discountBp: member.discountBp }, freeMinutes } : {}),
        ...(memberPriceCents !== undefined ? { memberPriceCents } : {}),
        ...(referral ? { referral: { code: referral.code, type: referral.type, value: referral.value } } : {}),
        partySize,
      });
    } else {
      const ctx = await loadPricingContext(deps.db, type.id, tz);
      pricingCtx = ctx;
      pricing = priceSession({
        startAt,
        endAt,
        timeZone: tz,
        resourceType: ctx.resourceType,
        rateBands: ctx.rateBands,
        happyHours: ctx.happyHours,
        applyMinimum: true,
        ...(member ? { member: { tierName: member.tierName, discountBp: member.discountBp }, freeMinutes } : {}),
        ...(referral ? { referral: { code: referral.code, type: referral.type, value: referral.value } } : {}),
      });
    }
  } catch (err) {
    if (err instanceof PricingError) throw new ApiError(422, "validation_failed", err.message);
    throw err;
  }

  return {
    resourceTypeId: type.id,
    resourceTypeName: type.name,
    experience: exp
      ? {
          id: exp.experience.id,
          key: exp.experience.key,
          name: exp.experience.name,
          minutes: exp.experience.minutes,
          listPriceCents: exp.experience.priceCents,
        }
      : null,
    partySize,
    claimablePromos: exp ? claimableNow(exp.promos, startAt, tz) : [],
    // D99: happy hour, when it set this price. A member's own price, when cheaper, wins instead (D82),
    // and then this booking isn't a happy-hour one.
    happyHour: exp
      ? pricing.experience?.promo && !pricing.experience.promo.member && !exp.promos.find((p) => p.id === pricing.experience!.promo!.id)?.claimed
        ? groupOf(experienceHappyHour(exp, startAt, tz), partySize)
        : null
      : sessionHappyHour(pricingCtx!, startAt, durationMinutes),
    startsAt: new Date(startAt).toISOString(),
    endsAt: new Date(endAt).toISOString(),
    durationMinutes,
    pricing,
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discount?.amountCents ?? 0,
    totalCents: pricing.totalCents,
    gstCents: pricing.gstCents,
    explanation: pricing.explanation,
    referral: referral && { id: referral.id, code: referral.code, type: referral.type, value: referral.value },
    member: member && { id: member.id, memberNo: member.memberNo, tierName: member.tierName, discountBp: member.discountBp, balanceMinutes: member.balanceMinutes },
    maxFreeMinutes: member ? Math.min(member.balanceMinutes, durationMinutes) : 0,
  };
}

/** Happy hour for the whole group: the per-person prices × people (D99, D106). */
function groupOf(happy: HappyHourPrice | null, partySize: number): HappyHourPrice | null {
  return happy && { ...happy, priceCents: happy.priceCents * partySize, normalCents: happy.normalCents * partySize };
}

/** The promotions the customer could tick at this start time, so the site can offer them. */
function claimableNow(promos: ExperiencePromo[], startAt: number, timeZone: string) {
  const local = toLocal(startAt, timeZone);
  const minuteOfDay = local.hour * 60 + local.minute;
  return promos
    .filter((p) => {
      if (!p.claimed || !p.daysOfWeek.includes(local.isoDayOfWeek)) return false;
      const [sh = 0, sm = 0] = p.startTime.split(":").map(Number);
      const [eh = 0, em = 0] = p.endTime.split(":").map(Number);
      return minuteOfDay >= sh * 60 + sm && minuteOfDay < eh * 60 + em;
    })
    .map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }));
}

// ── Hold → pay ───────────────────────────────────────────────────────────────
export interface HoldRequest extends BookingRequest {
  resourceId?: string | undefined;
  simSetup?: SimSetupRequest | undefined;
  customer?: { name: string; email?: string | undefined; phone?: string | undefined } | undefined;
  expectedTotalCents: number;
}

export type HoldResult =
  | { status: "confirmed"; bookingId: string; ref: string; token: string }
  | { status: "pending_payment"; bookingId: string; ref: string; token: string; checkoutUrl: string; holdExpiresAt: string };

/** A signed-in customer's contact details, used when they book without an active membership. */
export interface AccountContact {
  name: string;
  email: string | null;
  phone: string | null;
}

export async function holdBooking(deps: AppDeps, req: HoldRequest, member: MemberSummary | null, accountContact: AccountContact | null = null): Promise<HoldResult> {
  const now = deps.clock.now();
  const quote = await quoteBooking(deps, req, member);
  if (req.expectedTotalCents !== quote.totalCents) {
    throw new ApiError(409, "quote_changed", `The price is now ${formatCents(quote.totalCents)}. Please check it before paying.`, { quote });
  }
  const guest = member ? null : (req.customer ?? accountContact);
  if (!member && !guest) throw new ApiError(422, "validation_failed", "Your name and an email or phone number are required");
  if (quote.totalCents > 0) requireStripe(deps);

  const simSetup = req.simSetup ? await resolveSimSetup(deps, req.simSetup, quote.resourceTypeId) : null;

  const resources = await activeResources(deps, quote.resourceTypeId);
  const candidates = req.resourceId ? resources.filter((r) => r.id === req.resourceId) : resources;
  if (candidates.length === 0) throw new ApiError(404, "not_found", "That table or simulator is not available");

  const token = randomBytes(32).toString("base64url");
  const snapshot = {
    source: "online",
    pricing: quote.pricing,
    explanation: quote.explanation,
    discountCents: quote.referral ? quote.discountCents : 0,
    referral: quote.referral,
    member: quote.member && { id: quote.member.id, memberNo: quote.member.memberNo, tierName: quote.member.tierName },
    experience: quote.experience,
  };

  // D106: a group needs a simulator each. The lead is the one asked for (or the first free); the
  // rest are the next free ones. Only what is free right now is tried, so a group isn't sent to the
  // database with a simulator that is already taken.
  let attempts: { lead: (typeof candidates)[number]; extras: string[] }[] = candidates.map((lead) => ({ lead, extras: [] }));
  if (quote.partySize > 1) {
    const startMs = Date.parse(quote.startsAt);
    const endMs = Date.parse(quote.endsAt);
    const busy = await busyPeriods(deps, resources.map((r) => r.id), startMs, endMs, now);
    const free = resources.filter((r) => !busy.some((b) => b.resourceId === r.id && b.start < endMs && b.end > startMs));
    const lead = req.resourceId ? free.find((r) => r.id === req.resourceId) : free[0];
    if (!lead) throw new ApiError(409, "slot_taken", "That time has just been booked. Please choose another.");
    const extras = free.filter((r) => r.id !== lead.id).slice(0, quote.partySize - 1);
    if (extras.length < quote.partySize - 1) {
      throw new ApiError(409, "not_enough_spots", `Only ${free.length} ${free.length === 1 ? "spot is" : "spots are"} free at that time for ${quote.partySize} people. Please choose another time.`, {
        free: free.length,
      });
    }
    attempts = [{ lead, extras: extras.map((r) => r.id) }];
  }

  let booking: { id: string; ref: string; hold_expires_at: string | null; resource_id: string } | null = null;
  for (const [i, { lead: resource, extras }] of attempts.entries()) {
    const { data, error } = await deps.db.rpc("booking_hold", {
      p: {
        resourceId: resource.id,
        extraResourceIds: extras,
        startsAt: quote.startsAt,
        endsAt: quote.endsAt,
        now: now.toISOString(),
        memberId: member?.id ?? null,
        customer: guest,
        experienceId: quote.experience?.id ?? null,
        referralCodeId: quote.referral?.id ?? null,
        freeMinutes: quote.pricing.freeMinutes,
        pricing: snapshot,
        totalCents: quote.totalCents,
        gstCents: quote.gstCents,
        cancelTokenHash: hashBookingToken(token),
        simSetup,
      } as unknown as Json,
    });
    if (!error) {
      booking = data;
      break;
    }
    const mapped = mapDbError(error);
    if (mapped.code === "slot_taken" && i < attempts.length - 1) continue;
    throw mapped;
  }
  if (!booking) throw new ApiError(409, "slot_taken", "That time has just been booked. Please choose another.");
  const resourceLabel = candidates.find((r) => r.id === booking.resource_id)?.label ?? "";

  if (quote.totalCents === 0) {
    const { error } = await deps.db.rpc("booking_confirm", { p_booking: booking.id, p: { method: "free", amountPaidCents: 0 } });
    if (error) throw mapDbError(error);
    await sendBookingConfirmation(deps, booking.id, token);
    return { status: "confirmed", bookingId: booking.id, ref: booking.ref, token };
  }

  const stripe = requireStripe(deps);
  const settings = await loadSettings(deps.db);
  const start = venueText(new Date(quote.startsAt), settings.timezone);
  const end = venueText(new Date(quote.endsAt), settings.timezone);
  const link = bookingLink(deps, booking.ref, token);
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
                  name: quote.experience
                    ? quote.partySize > 1
                      ? `${quote.experience.name} · ${quote.partySize} people`
                      : `${quote.experience.name} · ${resourceLabel}`
                    : `${quote.resourceTypeName} · ${resourceLabel}`,
                  description: `${start.date}, ${start.time}–${end.time} (Sydney time) · booking ${booking.ref}`,
                },
              },
            },
          ],
          ...((member?.email ?? guest?.email) ? { customer_email: (member?.email ?? guest?.email)! } : {}),
          client_reference_id: booking.id,
          // The link token rides along so the webhook can put it in the confirmation email (only its hash is stored).
          metadata: { booking_id: booking.id, booking_ref: booking.ref, booking_token: token },
          payment_intent_data: { metadata: { booking_id: booking.id, booking_ref: booking.ref }, description: `Racegrounds booking ${booking.ref}` },
          payment_method_types: ["card"],
          success_url: `${link}&paid=1`,
          cancel_url: `${link}&abandoned=1`,
          // Stripe needs ≥ 30 min; the database hold lasts 10 minutes longer than this.
          expires_at: Math.floor(now.getTime() / 1000) + settings.hold_ttl_minutes * 60 + 60,
          adaptive_pricing: { enabled: false },
        },
        { idempotencyKey: `booking-checkout-${booking.id}` },
      ),
    );
  } catch (err) {
    await deps.db.rpc("booking_release_hold", { p_booking: booking.id });
    throw err;
  }
  const { error: attachError } = await deps.db.rpc("booking_attach_checkout", { p_booking: booking.id, p_checkout_session_id: session.id });
  if (attachError) {
    await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    throw mapDbError(attachError);
  }
  return { status: "pending_payment", bookingId: booking.id, ref: booking.ref, token, checkoutUrl: session.url!, holdExpiresAt: booking.hold_expires_at! };
}

// ── Webhooks ─────────────────────────────────────────────────────────────────
const paymentIntentOf = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

/** checkout.session.completed (mode=payment). Returns false when the session isn't one of our bookings. */
export async function handleBookingCheckoutCompleted(deps: AppDeps, session: Stripe.Checkout.Session): Promise<boolean> {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return false;
  if (session.payment_status !== "paid") return false; // card payments are paid on completion; nothing else is enabled
  if (session.currency !== "aud") {
    throw new ApiError(500, "unexpected_currency", `Checkout ${session.id} is in ${session.currency}, expected aud`);
  }
  const paymentIntentId = paymentIntentOf(session);
  const { data, error } = await deps.db.rpc("booking_confirm", {
    p_booking: bookingId,
    p: {
      method: "stripe",
      paymentIntentId,
      checkoutSessionId: session.id,
      amountPaidCents: session.amount_total,
      email: session.customer_details?.email ?? null,
    },
  });
  if (error) {
    const mapped = mapDbError(error);
    if (mapped.code !== "hold_expired" && mapped.code !== "amount_mismatch") throw mapped;
    // Paid for a hold we no longer have (or the wrong amount): give all of it back.
    const refund = await stripeCall(() =>
      requireStripe(deps).refunds.create(
        { payment_intent: paymentIntentId!, metadata: { booking_id: bookingId, kind: "booking_unconfirmed" } },
        { idempotencyKey: `booking-unconfirmed-${bookingId}` },
      ),
    );
    await writeAudit(deps.db, {
      actorStaffId: null,
      action: "booking.payment_refunded",
      entity: "bookings",
      entityId: bookingId,
      after: { reason: mapped.code, stripe_refund_id: refund.id, amount_cents: refund.amount, payment_intent: paymentIntentId },
    });
    const email = session.customer_details?.email;
    if (email) {
      await deps.email.send({
        template: "booking_payment_refunded",
        to: email,
        subject: `Racegrounds booking ${session.metadata?.booking_ref ?? ""}: payment refunded`,
        text: `Hi,\n\nYour payment came through after we had to release the time you picked, so the booking wasn't made and we've refunded the full ${formatCents(refund.amount)} to your card. Refunds usually show within 5–10 business days.\n\nPlease book again at ${deps.env.BOOKING_SITE_URL}.\n\nRaceground`,
        entity: "bookings",
        entityId: `${bookingId}:refunded`,
      });
    }
    return true;
  }
  const result = data as { confirmed: boolean };
  if (result.confirmed) {
    const token = session.metadata?.booking_token;
    await sendBookingConfirmation(deps, bookingId, token ?? null);
  }
  return true;
}

/** checkout.session.expired: free the slot now instead of waiting for the hold to lapse. */
export async function handleBookingCheckoutExpired(deps: AppDeps, session: Stripe.Checkout.Session): Promise<boolean> {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return false;
  const { error } = await deps.db.rpc("booking_release_hold", { p_booking: bookingId });
  if (error) throw mapDbError(error);
  return true;
}

// ── Customer links ───────────────────────────────────────────────────────────
const BOOKING_SELECT =
  "*, resources!inner(label, resource_types!inner(name, key)), customers!inner(name, email, phone), experiences(name, key)" as const;

type BookingRow = {
  id: string;
  ref: string;
  status: string;
  period: unknown;
  hold_expires_at: string | null;
  free_minutes_used: number;
  total_cents: number | null;
  gst_cents: number | null;
  pricing_snapshot: { explanation?: string[] } | null;
  cancel_token_hash: string | null;
  cancelled_at: string | null;
  refund_cents: number | null;
  member_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  resources: { label: string; resource_types: { name: string; key: string } };
  customers: { name: string; email: string | null; phone: string | null };
  experiences: { name: string; key: string } | null;
  sim_setup: SimSetup | null;
  /** D106: people on the booking (the lead's); 1 on a linked booking. */
  party_size: number;
  /** D106: set on a linked booking, the group's lead. */
  group_lead_id: string | null;
};

/** D106: every simulator of a group, the lead's first. Just the one for anything else. */
async function groupLabels(deps: AppDeps, b: BookingRow): Promise<string[]> {
  if (b.party_size <= 1) return [b.resources.label];
  const { data, error } = await deps.db.from("bookings").select("resources!inner(label)").eq("group_lead_id", b.id);
  if (error) throw mapDbError(error);
  const others = (data as unknown as { resources: { label: string } }[]).map((r) => r.resources.label).sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
  return [b.resources.label, ...others];
}

/** "Single Session · Sim 3", or for a group "Single Session · 3 people · Sim 1, Sim 2, Sim 3" (D106). */
function whatAndWhere(b: BookingRow, labels: string[]) {
  const name = b.experiences?.name ?? b.resources.resource_types.name;
  return b.party_size > 1 ? `${name} · ${b.party_size} people · ${labels.join(", ")}` : `${name} · ${labels[0]}`;
}

/** What the customer asked to drive, by name at the time of booking (D80). */
export interface SimSetup {
  game: string;
  track?: string;
  car?: string;
}

/** "Assetto Corsa Competizione · Monza · Ferrari 296 GT3" */
export const simSetupText = (s: SimSetup) => [s.game, s.track, s.car].filter(Boolean).join(" · ");

/** A booking link is valid only with its token; anything else looks like "not found". */
async function bookingByLink(deps: AppDeps, ref: string, token: string): Promise<BookingRow> {
  const normalized = ref.trim().toUpperCase();
  const { data, error } = await deps.db.from("bookings").select(BOOKING_SELECT).eq("ref", normalized).maybeSingle();
  if (error) throw mapDbError(error);
  const row = data as unknown as BookingRow | null;
  const given = Buffer.from(hashBookingToken(token), "hex");
  const stored = Buffer.from(row?.cancel_token_hash ?? "", "hex");
  if (!row || stored.length !== given.length || !timingSafeEqual(stored, given)) {
    throw new ApiError(404, "not_found", "Booking not found. Check the link in your email.");
  }
  return row;
}

async function cancelQuote(deps: AppDeps, bookingId: string, now: Date, venueFault = false) {
  const { data, error } = await deps.db.rpc("booking_cancel_quote", { p_booking: bookingId, p_now: now.toISOString(), p_venue_fault: venueFault });
  if (error) throw mapDbError(error);
  return data as { allowed: boolean; rule?: string; reason?: string; refundCents?: number; paidCents?: number; returnMinutes?: number; hoursBefore: number };
}

export async function viewBooking(deps: AppDeps, ref: string, token: string) {
  return describeBooking(deps, await bookingByLink(deps, ref, token));
}

/** A booking of this customer by its code (member account: no link token needed). */
export async function bookingForCustomer(deps: AppDeps, ref: string, customerId: string): Promise<BookingRow> {
  const { data, error } = await deps.db.from("bookings").select(BOOKING_SELECT).eq("ref", ref.trim().toUpperCase()).eq("customer_id", customerId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Booking not found");
  return data as unknown as BookingRow;
}

export async function bookingById(deps: AppDeps, id: string): Promise<BookingRow> {
  const { data, error } = await deps.db.from("bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Booking not found");
  return data as unknown as BookingRow;
}

export async function describeBooking(deps: AppDeps, b: BookingRow) {
  const now = deps.clock.now();
  const { start, end } = parseRange(b.period);
  const settings = await loadSettings(deps.db);
  const quote = b.status === "confirmed" ? await cancelQuote(deps, b.id, now) : null;
  const s = venueText(start, settings.timezone);
  const labels = await groupLabels(deps, b);
  return {
    ref: b.ref,
    status: b.status,
    // D106: people, each on their own simulator; `resources` names every one of them.
    partySize: b.party_size,
    resources: labels,
    // What the customer bought: the experience if there was one, otherwise the kind of resource.
    what: b.experiences?.name ?? b.resources.resource_types.name,
    experience: b.experiences && { name: b.experiences.name, key: b.experiences.key },
    resourceType: b.resources.resource_types.name,
    resource: labels.join(", "),
    simSetup: b.sim_setup,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    venueDate: s.date,
    venueStartTime: s.time,
    venueEndTime: venueText(end, settings.timezone).time,
    timeZone: settings.timezone,
    durationMinutes: Math.round((end.getTime() - start.getTime()) / MINUTE_MS),
    customerName: b.customers.name,
    totalCents: b.total_cents,
    gstCents: b.gst_cents,
    freeMinutesUsed: b.free_minutes_used,
    explanation: b.pricing_snapshot?.explanation ?? [],
    holdExpiresAt: b.status === "held" ? b.hold_expires_at : null,
    cancelledAt: b.cancelled_at,
    refundCents: b.refund_cents,
    checkInCode: `rg:b:${b.ref}`,
    // The session rules the customer is shown with the booking (D85).
    rules: { arriveEarlyMinutes: settings.arrive_early_minutes, noShowHoldMinutes: settings.no_show_hold_minutes },
    cancellation: quote && {
      allowed: quote.allowed,
      rule: quote.rule ?? null,
      reason: quote.reason ?? null,
      refundCents: quote.refundCents ?? 0,
      paidCents: quote.paidCents ?? 0,
      returnMinutes: quote.returnMinutes ?? 0,
    },
  };
}

/** Customer gave up at Stripe Checkout: close the checkout and free the slot straight away. */
export async function abandonBooking(deps: AppDeps, ref: string, token: string) {
  const b = await bookingByLink(deps, ref, token);
  if (b.status !== "held") return { status: b.status };
  if (b.stripe_checkout_session_id && deps.stripe) {
    try {
      await deps.stripe.checkout.sessions.expire(b.stripe_checkout_session_id);
    } catch (err) {
      if (!(err instanceof Stripe.errors.StripeError)) throw err;
      // Can't expire a completed checkout: the payment is on its way, keep the hold for the webhook.
      const session = await stripeCall(() => deps.stripe!.checkout.sessions.retrieve(b.stripe_checkout_session_id!));
      if (session.status === "complete") return { status: "held" };
    }
  }
  const { data, error } = await deps.db.rpc("booking_release_hold", { p_booking: b.id });
  if (error) throw mapDbError(error);
  return { status: data as string };
}

export interface CancelOptions {
  /** null when the customer cancels (link or account). */
  staffId: string | null;
  reason?: string | undefined;
  /** Staff only: venue's fault → full refund and minutes back at any time. */
  venueFault?: boolean | undefined;
  /** Staff only: refund this amount instead of the policy (any time, up to what was paid). */
  overrideRefundCents?: number | undefined;
  /** With an override: give the free minutes back too. */
  returnMinutes?: boolean | undefined;
  /** The refund the person saw; required for customers, checked for staff when given. */
  expectedRefundCents?: number | undefined;
}

/** Quote → Stripe refund (reusing one already made for this cancel) → cancel in the database → email. */
export async function cancelBooking(deps: AppDeps, b: BookingRow, opts: CancelOptions) {
  const now = deps.clock.now();
  const isStaff = opts.staffId !== null;
  const venueFault = isStaff && opts.venueFault === true;
  const override = isStaff ? opts.overrideRefundCents : undefined;
  const quote = await cancelQuote(deps, b.id, now, venueFault);
  if (quote.reason === "not_cancellable") throw new ApiError(409, "not_cancellable", "This booking can't be cancelled");

  let refundCents: number;
  if (override !== undefined) {
    if (override > (quote.paidCents ?? 0)) throw new ApiError(422, "validation_failed", `The refund can't be more than the ${formatCents(quote.paidCents ?? 0)} paid`);
    refundCents = override;
  } else {
    if (!quote.allowed) {
      throw isStaff
        ? new ApiError(409, "too_late", "Less than 24 hours before the start: cancel as the venue's fault or set the refund amount.")
        : new ApiError(409, "too_late", "Bookings can't be cancelled online less than 24 hours before the start, and no refund applies. Please call the venue.");
    }
    refundCents = quote.refundCents ?? 0;
  }
  if (opts.expectedRefundCents !== undefined && opts.expectedRefundCents !== refundCents) {
    throw new ApiError(409, "refund_changed", `The refund is now ${formatCents(refundCents)}. Please check it again.`, { refundCents, rule: quote.rule });
  }

  let stripeRefundId: string | null = null;
  if (refundCents > 0) {
    const stripe = requireStripe(deps);
    const paymentIntent = b.stripe_payment_intent_id;
    if (!paymentIntent) throw new ApiError(409, "not_refundable", "This booking has no online payment to refund");
    // A retry after a failure below reuses the refund Stripe already made for this cancellation.
    const existing = (await stripeCall(() => stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 }))).data.find(
      (r) => r.metadata?.kind === "booking_cancel" && r.status !== "failed" && r.status !== "canceled",
    );
    if (existing && existing.amount !== refundCents) {
      throw new ApiError(409, "refund_in_progress", "A different refund is already in progress for this booking. Please contact the venue.");
    }
    const refund =
      existing ??
      (await stripeCall(() =>
        stripe.refunds.create(
          { payment_intent: paymentIntent, amount: refundCents, metadata: { booking_id: b.id, kind: "booking_cancel", rule: override !== undefined ? "override" : (quote.rule ?? "") } },
          { idempotencyKey: `booking-cancel-${b.id}-${refundCents}` },
        ),
      ));
    stripeRefundId = refund.id;
  }

  const { data, error } = await deps.db.rpc("booking_cancel", {
    p_booking: b.id,
    p: {
      now: now.toISOString(),
      staffId: opts.staffId,
      reason: opts.reason ?? null,
      venueFault,
      ...(override !== undefined ? { overrideRefundCents: override, returnMinutes: opts.returnMinutes === true } : { refundCents }),
      stripeRefundId,
    },
  });
  if (error) throw mapDbError(error);
  const result = data as { refundCents: number; minutesReturned: number; rule: string };

  if (b.customers.email) {
    const settings = await loadSettings(deps.db);
    const { start, end } = parseRange(b.period);
    const s = venueText(start, settings.timezone);
    const moneyLine =
      result.refundCents > 0
        ? `We've refunded ${formatCents(result.refundCents)} to your card. Refunds usually show within 5–10 business days.`
        : "No refund applies to this cancellation.";
    const minutesLine = result.minutesReturned > 0 ? `\n${result.minutesReturned} minutes of free play are back in your balance.` : "";
    const byVenue = isStaff ? `\nWe're sorry we had to cancel${opts.reason ? `: ${opts.reason}` : "."}` : "";
    await deps.email.send({
      template: "booking_cancelled",
      to: b.customers.email,
      subject: `Racegrounds booking ${b.ref} cancelled`,
      text: `Hi ${b.customers.name},\n\nYour booking ${b.ref} (${b.resources.resource_types.name} · ${b.resources.label}, ${s.date} ${s.time}–${venueText(end, settings.timezone).time}) is cancelled.${byVenue}\n${moneyLine}${minutesLine}\n\nRaceground`,
      entity: "bookings",
      entityId: `${b.id}:cancelled`,
    });
  }
  return result;
}

export async function cancelBookingByCustomer(deps: AppDeps, ref: string, token: string, expectedRefundCents: number) {
  const b = await bookingByLink(deps, ref, token);
  return cancelBooking(deps, b, { staffId: null, expectedRefundCents });
}

// ── Emails ───────────────────────────────────────────────────────────────────
export async function sendBookingConfirmation(deps: AppDeps, bookingId: string, token: string | null) {
  const { data, error } = await deps.db.from("bookings").select(BOOKING_SELECT).eq("id", bookingId).single();
  if (error) throw mapDbError(error);
  const b = data as unknown as BookingRow;
  const settings = await loadSettings(deps.db);
  const { start, end } = parseRange(b.period);
  const s = venueText(start, settings.timezone);
  const endTime = venueText(end, settings.timezone).time;
  const what = whatAndWhere(b, await groupLabels(deps, b));
  const paid = b.total_cents
    ? `Paid: ${formatCents(b.total_cents)} (incl. GST ${formatCents(b.gst_cents ?? 0)})`
    : "Paid: $0.00";
  const free = b.free_minutes_used > 0 ? `\nFree play used: ${b.free_minutes_used} min` : "";
  const setup = b.sim_setup ? `\nYour setup: ${simSetupText(b.sim_setup)}` : "";

  // D105: the venue hears about every confirmed online booking, whether or not the customer gave an email.
  if (settings.booking_alert_email) {
    const contact = [b.customers.email, b.customers.phone].filter(Boolean).join(" · ") || "no contact details";
    await deps.email.send({
      template: "booking_alert",
      to: settings.booking_alert_email,
      subject: `New booking ${b.ref}: ${s.date} ${s.time}, ${what}`,
      text: `New booking confirmed.\n\nBooking code: ${b.ref}\n${what}\n${s.date}, ${s.time}–${endTime} (Sydney time)${setup.replace("Your setup", "Setup")}\n${paid}${free}\n\nCustomer: ${b.customers.name}\n${contact}\n\nIt is in the back office under Bookings.`,
      entity: "bookings",
      entityId: `${b.id}:alert`,
    });
  }

  if (!b.customers.email) return { sent: false };
  const link = token ? `\n\nView or cancel your booking: ${bookingLink(deps, b.ref, token)}` : "";
  const text = `Hi ${b.customers.name},\n\nYour booking is confirmed.\n\nBooking code: ${b.ref}\n${what}\n${s.date}, ${s.time}–${endTime} (Sydney time)${setup}\n${paid}${free}\n\nPlease arrive ${settings.arrive_early_minutes} minutes before your session and show your booking code at the counter. Your session starts and ends at the booked time: arriving late does not extend it. We hold your spot for ${settings.no_show_hold_minutes} minutes after the start time.\n\nCancellations: full refund up to 24 hours before the start. Within 24 hours a booking can't be cancelled and no refund applies.${link}\n\nRaceground`;
  const ics = buildIcs({
    uid: `${b.id}@raceground`,
    start,
    end,
    stamp: deps.clock.now(),
    summary: `Racegrounds: ${what}`,
    description: `Booking ${b.ref}. Show this code at the counter.`,
    location: settings.business_name ?? "Racegrounds",
    ...(token ? { url: bookingLink(deps, b.ref, token) } : {}),
  });
  return deps.email.send({
    template: "booking_confirmed",
    to: b.customers.email,
    subject: `Racegrounds booking ${b.ref} confirmed: ${s.date} ${s.time}`,
    text,
    entity: "bookings",
    entityId: `${b.id}:confirmed`,
    attachments: [{ filename: `raceground-${b.ref}.ics`, contentType: "text/calendar; charset=utf-8; method=PUBLISH", content: ics }],
  });
}

// ── Lists ────────────────────────────────────────────────────────────────────
function summarize(b: BookingRow, timeZone: string) {
  const { start, end } = parseRange(b.period);
  const s = venueText(start, timeZone);
  return {
    id: b.id,
    ref: b.ref,
    status: b.status,
    // What the customer bought: the experience if there was one, otherwise the kind of resource.
    what: b.experiences?.name ?? b.resources.resource_types.name,
    experience: b.experiences && { name: b.experiences.name, key: b.experiences.key },
    resourceType: b.resources.resource_types.name,
    resource: b.resources.label,
    partySize: b.party_size,
    simSetup: b.sim_setup,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    venueDate: s.date,
    venueStartTime: s.time,
    venueEndTime: venueText(end, timeZone).time,
    totalCents: b.total_cents,
    freeMinutesUsed: b.free_minutes_used,
    refundCents: b.refund_cents,
  };
}

/** The customer's bookings, newest first. Unpaid holds that lapsed are left out. */
export async function customerBookings(deps: AppDeps, customerId: string) {
  const settings = await loadSettings(deps.db);
  const { data, error } = await deps.db
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("customer_id", customerId)
    .neq("status", "expired")
    // D106: a group shows once, as its lead.
    .is("group_lead_id", null)
    .order("period", { ascending: false })
    .limit(100);
  if (error) throw mapDbError(error);
  return (data as unknown as BookingRow[]).map((b) => summarize(b, settings.timezone));
}

/** Back office: every booking starting on a venue date, optionally filtered by code, name, email or phone. */
export async function bookingsForDay(deps: AppDeps, date: string, q?: string) {
  const settings = await loadSettings(deps.db);
  const tz = settings.timezone;
  const from = localToInstant(date, "00:00", tz);
  const to = localToInstant(addDaysToDate(date, 1), "00:00", tz);
  const { data, error } = await deps.db
    .from("bookings")
    .select(`${BOOKING_SELECT}, members(member_no), payments(method, amount_cents)`)
    .overlaps("period", `[${new Date(from).toISOString()},${new Date(to).toISOString()})`)
    .order("period");
  if (error) throw mapDbError(error);
  const needle = q?.trim().toLowerCase();
  return (data as unknown as (BookingRow & { members: { member_no: string } | null; payments: { method: string; amount_cents: number }[] })[])
    .filter((b) => {
      const start = parseRange(b.period).start.getTime();
      return start >= from && start < to;
    })
    .filter((b) => !needle || [b.ref, b.customers.name, b.customers.email ?? "", b.customers.phone ?? ""].some((v) => v.toLowerCase().includes(needle)))
    .map((b, _, all) => ({
      ...summarize(b, tz),
      // D106: a linked booking names its group's lead, which is where it is changed.
      groupLeadRef: b.group_lead_id ? (all.find((x) => x.id === b.group_lead_id)?.ref ?? null) : null,
      customer: b.customers,
      memberNo: b.members?.member_no ?? null,
      payment: b.payments[0] ? { method: b.payments[0].method, amountCents: b.payments[0].amount_cents } : null,
      holdExpiresAt: b.status === "held" ? b.hold_expires_at : null,
      cancelledAt: b.cancelled_at,
    }));
}

// ── Reminders ────────────────────────────────────────────────────────────────
/**
 * Once a day (owner decision D54): remind everyone with a confirmed booking tomorrow (venue date).
 * Safe to run more than once: each booking gets at most one reminder (email_log).
 */
export async function sendDayBeforeReminders(deps: AppDeps) {
  const settings = await loadSettings(deps.db);
  const tz = settings.timezone;
  const tomorrow = addDaysToDate(toLocal(deps.clock.now().getTime(), tz).date, 1);
  const from = localToInstant(tomorrow, "00:00", tz);
  const to = localToInstant(addDaysToDate(tomorrow, 1), "00:00", tz);
  const { data, error } = await deps.db
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("status", "confirmed")
    // D106: one reminder per group, from its lead.
    .is("group_lead_id", null)
    .overlaps("period", `[${new Date(from).toISOString()},${new Date(to).toISOString()})`);
  if (error) throw mapDbError(error);
  let sent = 0;
  let skipped = 0;
  for (const b of data as unknown as BookingRow[]) {
    const { start, end } = parseRange(b.period);
    if (start.getTime() < from || start.getTime() >= to) continue;
    if (!b.customers.email) {
      skipped += 1;
      continue;
    }
    const s = venueText(start, tz);
    const result = await deps.email.send({
      template: "booking_reminder",
      to: b.customers.email,
      subject: `See you tomorrow at Racegrounds: ${s.time}`,
      text: `Hi ${b.customers.name},\n\nA reminder of your booking tomorrow.\n\nBooking code: ${b.ref}\n${whatAndWhere(b, await groupLabels(deps, b))}\n${s.date}, ${s.time}–${venueText(end, tz).time} (Sydney time)\n\nPlease arrive ${settings.arrive_early_minutes} minutes before your session and show your booking code at the counter. Your session runs on the booked time: arriving late does not extend it. We hold your spot for ${settings.no_show_hold_minutes} minutes after the start time.\nCan't make it? Cancel with the link in your confirmation email: full refund up to 24 hours before the start. Within 24 hours no refund applies.\n\nRaceground`,
      entity: "bookings",
      entityId: `${b.id}:reminder`,
    });
    if (result.sent) sent += 1;
    else skipped += 1;
  }
  return { date: tomorrow, sent, skipped };
}
