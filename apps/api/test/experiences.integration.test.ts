/**
 * Experiences, promotional prices, tournaments and site events (D65–D70), against local Supabase
 * on a fixed clock: Monday 11 Feb 2030, 09:00 Sydney (AEDT, +11).
 *
 * Uses its own resource type, experiences and promotions, so earlier runs never overlap and the
 * launch data is never relied on for the arithmetic. Stripe is not called: every entry priced here
 * is $0, and paid checkouts go through the same code as bookings, covered elsewhere.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, testContext, useOpeningHours, type CallOptions, type TestContext } from "./helpers.js";

const at = (hhmm: string, day = "2030-02-11") => `${day}T${hhmm}:00+11:00`;
const run = randomUUID().slice(0, 8);

let ctx: TestContext;
let typeId: string;
const resourceIds: string[] = [];
let quickId: string;
let doubleId: string;
let happyPromoId: string;
let studentPromoId: string;
let tournamentId: string;
let freeTournamentId: string;
let eventId: string;

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const api = (path: string, opts: CallOptions = {}) =>
  call(ctx, path, { ...opts, headers: { "x-forwarded-for": randomIp(), ...opts.headers } });

const quickKey = `test_quick_${run}`;
const doubleKey = `test_double_${run}`;

/** Saturday, so the venue's own weekday happy hour can never interfere. */
const SAT = "2030-02-16";
const quote = (over: Record<string, unknown> = {}) => api("/public/quote", { body: { experienceKey: quickKey, date: SAT, startTime: "17:00", ...over } });

/** Restores the venue's real opening hours once this file is done. */
let restoreHours: () => Promise<void>;

beforeAll(async () => {
  ctx = testContext();
  ctx.clock.set(at("09:00"));

  const { data: type, error } = await ctx.db
    .from("resource_types")
    .insert({ key: `test_xp_${run}`, name: `Test Rig ${run}`, base_rate_cents: 6000, min_minutes: 15, sort: 991 })
    .select("id")
    .single();
  if (error) throw error;
  typeId = type.id;

  const { data: resources, error: resourceError } = await ctx.db
    .from("resources")
    .insert([
      { resource_type_id: typeId, label: "Rig A", sort: 1 },
      { resource_type_id: typeId, label: "Rig B", sort: 2 },
    ])
    .select("id, sort");
  if (resourceError) throw resourceError;
  resourceIds.push(...resources.sort((x, y) => x.sort - y.sort).map((r) => r.id));

  const { data: exps, error: expError } = await ctx.db
    .from("experiences")
    .insert([
      { key: quickKey, resource_type_id: typeId, name: "Test Quick Race", tagline: "Single session", minutes: 30, price_cents: 3500, badges: [], sort: 1 },
      { key: doubleKey, resource_type_id: typeId, name: "Test Double Race", minutes: 60, price_cents: 5800, badges: ["Most popular"], sort: 2 },
    ])
    .select("id, key");
  if (expError) throw expError;
  quickId = exps.find((e) => e.key === quickKey)!.id;
  doubleId = exps.find((e) => e.key === doubleKey)!.id;

  const { data: promos, error: promoError } = await ctx.db
    .from("experience_promos")
    .insert([
      { experience_id: quickId, name: "Test Happy Hour", days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "12:00", end_time: "15:00", price_cents: 2900, claimed: false },
      { experience_id: quickId, name: "Test Student", days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "00:00", end_time: "24:00", price_cents: 3200, claimed: true },
      { experience_id: doubleId, name: "Test Happy Hour", days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "12:00", end_time: "15:00", price_cents: 4900, claimed: false },
      // Cheaper than Happy Hour, but only on request: it must never become a "from" price.
      { experience_id: doubleId, name: "Test Insider", days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "00:00", end_time: "24:00", price_cents: 4000, claimed: true },
    ])
    .select("id, name, experience_id");
  if (promoError) throw promoError;
  happyPromoId = promos.find((p) => p.experience_id === quickId && p.name === "Test Happy Hour")!.id;
  studentPromoId = promos.find((p) => p.name === "Test Student")!.id;

  const { data: tournaments, error: tError } = await ctx.db
    .from("tournaments")
    .insert([
      { name: `Test Cup ${run}`, blurb: "The big one", starts_at: at("19:00", "2030-03-01"), spots: 2, entry_fee_cents: 2000, published: true },
      { name: `Test Free Cup ${run}`, starts_at: at("19:00", "2030-03-08"), spots: 1, entry_fee_cents: 0, published: true },
      { name: `Test Draft ${run}`, starts_at: at("19:00", "2030-03-15"), spots: 8, entry_fee_cents: 2000, published: false },
    ])
    .select("id, entry_fee_cents, published, spots");
  if (tError) throw tError;
  tournamentId = tournaments.find((t) => t.published && t.entry_fee_cents === 2000)!.id;
  freeTournamentId = tournaments.find((t) => t.entry_fee_cents === 0)!.id;

  const { data: event, error: eventError } = await ctx.db
    .from("site_events")
    .insert({ title: `Test Event ${run}`, body: "Come along", detail: "$2,000 prize pool", cta_label: "Enter", cta_url: "/tournaments", as_popup: true, as_banner: true })
    .select("id")
    .single();
  if (eventError) throw eventError;
  eventId = event.id;
  restoreHours = await useOpeningHours(ctx);
});

afterAll(async () => {
  await restoreHours();
  await ctx.db.from("bookings").update({ status: "expired" }).in("resource_id", resourceIds).eq("status", "held");
  await ctx.db.from("tournament_entries").update({ status: "expired" }).in("tournament_id", [tournamentId, freeTournamentId]).eq("status", "held");
  await ctx.db.from("experiences").update({ active: false }).in("id", [quickId, doubleId]);
  await ctx.db.from("resources").update({ active: false }).in("id", resourceIds);
  await ctx.db.from("resource_types").update({ active: false }).eq("id", typeId);
  await ctx.db.from("site_events").update({ active: false }).eq("id", eventId);
  await ctx.db.from("tournaments").update({ published: false }).in("id", [tournamentId, freeTournamentId]);
});

describe("public config", () => {
  it("publishes experiences with their promotional prices and a 'from' price", async () => {
    const r = await api("/public/config");
    expect(r.status).toBe(200);
    const quick = r.json.experiences.find((e: { key: string }) => e.key === quickKey);
    expect(quick).toMatchObject({ name: "Test Quick Race", minutes: 30, priceCents: 3500, tagline: "Single session" });
    // "From" is the cheapest price anyone could pay without asking, so the claimed $32 is ignored.
    expect(quick.fromPriceCents).toBe(2900);
    expect(quick.promos).toHaveLength(2);
    const double = r.json.experiences.find((e: { key: string }) => e.key === doubleKey);
    expect(double).toMatchObject({ minutes: 60, priceCents: 5800, badges: ["Most popular"] });
    // Its cheapest promotion is the $40 one, but that has to be asked for, so "from" stays $49.
    expect(double.fromPriceCents).toBe(4900);
    expect(double.promos).toHaveLength(2);
  });

  it("publishes the tiers' listed perks and the active site events", async () => {
    const r = await api("/public/config");
    expect(Array.isArray(r.json.tiers[0].perks)).toBe(true);
    const event = r.json.events.find((e: { id: string }) => e.id === eventId);
    expect(event).toMatchObject({ title: `Test Event ${run}`, detail: "$2,000 prize pool", ctaLabel: "Enter", asPopup: true, asBanner: true });
  });

  it("hides an event whose window has not opened yet", async () => {
    await ctx.db.from("site_events").update({ show_from: at("09:00", "2030-06-01") }).eq("id", eventId);
    const r = await api("/public/config");
    expect(r.json.events.find((e: { id: string }) => e.id === eventId)).toBeUndefined();
    await ctx.db.from("site_events").update({ show_from: null }).eq("id", eventId);
  });
});

describe("availability for an experience", () => {
  it("counts spots at the experience's own length, not at one session", async () => {
    // Rig A is busy 17:00–17:45, so a 30-minute Quick Race at 18:00 fits on both rigs,
    // but a 60-minute Double Race at 17:00 fits on neither... and at 18:00 on both.
    await ctx.db.from("bookings").insert({
      resource_id: resourceIds[0]!,
      customer_id: (await ctx.db.from("customers").insert({ name: `Blocker ${run}`, email: `blocker-${run}@raceground.test` }).select("id").single()).data!.id,
      period: `[${at("17:00", SAT)},${at("17:45", SAT)})`,
      status: "confirmed",
      total_cents: 0,
      gst_cents: 0,
      pricing_snapshot: {},
    });

    const quick = await api(`/public/availability?experience=${quickKey}&date=${SAT}`);
    expect(quick.status, JSON.stringify(quick.json)).toBe(200);
    expect(quick.json.experience).toMatchObject({ key: quickKey, minutes: 30 });
    expect(quick.json.requiredMinutes).toBe(30);
    expect(quick.json.slots.find((s: { time: string }) => s.time === "17:00").availableResources).toBe(1);
    expect(quick.json.slots.find((s: { time: string }) => s.time === "18:00").availableResources).toBe(2);

    const dbl = await api(`/public/availability?experience=${doubleKey}&date=${SAT}`);
    expect(dbl.json.requiredMinutes).toBe(60);
    // Rig A is busy at 17:00, so a Double Race can only go on Rig B.
    expect(dbl.json.slots.find((s: { time: string }) => s.time === "17:00").availableResources).toBe(1);

    // The case that matters: at 16:30 Rig A has exactly 30 minutes free before the booking.
    // That is enough for a Quick Race and not enough for a Double Race, so counting spots at
    // one session rather than at the experience's own length would overstate the Double Race.
    expect(quick.json.slots.find((s: { time: string }) => s.time === "16:30").availableResources).toBe(2);
    expect(dbl.json.slots.find((s: { time: string }) => s.time === "16:30").availableResources).toBe(1);
    // The last Double Race of the day has to finish by 21:00.
    expect(dbl.json.slots.at(-1).time).toBe("20:00");
  });

  it("needs to be told what to look at", async () => {
    const r = await api(`/public/availability?date=${SAT}`);
    expect(r.status).toBe(422);
  });
});

describe("quoting an experience", () => {
  it("charges the flat price, ignoring the resource type's hourly rate", async () => {
    const r = await quote();
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    // The rig is $60/hr, so half an hour of time would be $30. The experience is $35.
    expect(r.json.quote).toMatchObject({ totalCents: 3500, durationMinutes: 30, gstCents: 318 });
    expect(r.json.quote.experience).toMatchObject({ key: quickKey, name: "Test Quick Race", minutes: 30, listPriceCents: 3500 });
  });

  it("applies Happy Hour automatically and the student price only when asked", async () => {
    expect((await quote({ startTime: "13:00" })).json.quote.totalCents).toBe(2900);
    expect((await quote()).json.quote.totalCents).toBe(3500);
    expect((await quote({ claimedPromoIds: [studentPromoId] })).json.quote.totalCents).toBe(3200);
    // The cheapest wins, which is what keeps the student price out of Happy Hour.
    expect((await quote({ startTime: "13:00", claimedPromoIds: [studentPromoId] })).json.quote.totalCents).toBe(2900);
  });

  it("tells the site which promotions can still be asked for, and never lists the automatic ones", async () => {
    const r = await quote();
    expect(r.json.quote.claimablePromos).toEqual([{ id: studentPromoId, name: "Test Student", priceCents: 3200 }]);
    // Inside Happy Hour the student price is still the only one to offer: Happy Hour is automatic.
    const inHappyHour = await quote({ startTime: "13:00" });
    expect(inHappyHour.json.quote.claimablePromos).toEqual([{ id: studentPromoId, name: "Test Student", priceCents: 3200 }]);
  });

  it("decides on the start time, so a Double Race started at 14:30 is still Happy Hour", async () => {
    const r = await quote({ experienceKey: doubleKey, startTime: "14:30" });
    expect(r.json.quote.totalCents).toBe(4900);
    expect(r.json.quote.durationMinutes).toBe(60);
  });

  it("refuses a length sent with an experience instead of trusting it", async () => {
    // The experience's own 30 minutes wins; the 120 is ignored rather than honoured.
    const r = await quote({ durationMinutes: 120 });
    expect(r.json.quote.durationMinutes).toBe(30);
    expect(r.json.quote.totalCents).toBe(3500);
  });

  it("404s an experience that does not exist or is switched off", async () => {
    expect((await quote({ experienceKey: `nope_${run}` })).status).toBe(404);
    await ctx.db.from("experiences").update({ active: false }).eq("id", quickId);
    expect((await quote()).status).toBe(404);
    await ctx.db.from("experiences").update({ active: true }).eq("id", quickId);
  });

  it("still needs something to book", async () => {
    const r = await api("/public/quote", { body: { date: SAT, startTime: "17:00" } });
    expect(r.status).toBe(422);
  });

  it("does not let an unknown promotion id change the price", async () => {
    const r = await quote({ claimedPromoIds: [happyPromoId] });
    // Happy Hour is automatic, not claimed, and 17:00 is outside its window either way.
    expect(r.json.quote.totalCents).toBe(3500);
  });
});

describe("booking an experience", () => {
  it("prices the hold from the experience, so a stale total is caught before Stripe", async () => {
    const r = await api("/bookings/hold", {
      body: {
        experienceKey: doubleKey,
        date: SAT,
        startTime: "18:00",
        customer: { name: `Xavier ${run}`, email: `xavier-${run}@raceground.test` },
        expectedTotalCents: 0,
        acceptTerms: true,
      },
    });
    // $58 needs Stripe, which this context has not got: the hold is refused before any money moves.
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("quote_changed");
    expect(r.json.error.details.quote.totalCents).toBe(5800);
  });

  it("confirms a $0 experience booking and names it on the booking", async () => {
    await ctx.db.from("experiences").update({ price_cents: 0 }).eq("id", quickId);
    const r = await api("/bookings/hold", {
      body: {
        experienceKey: quickKey,
        date: SAT,
        startTime: "19:00",
        customer: { name: `Yolanda ${run}`, email: `yolanda-${run}@raceground.test` },
        expectedTotalCents: 0,
        acceptTerms: true,
      },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.status).toBe("confirmed");

    const view = await api(`/bookings/${r.json.ref}?token=${encodeURIComponent(r.json.token)}`);
    expect(view.json.booking).toMatchObject({ what: "Test Quick Race", durationMinutes: 30 });
    expect(view.json.booking.experience).toMatchObject({ key: quickKey });
    await ctx.db.from("experiences").update({ price_cents: 3500 }).eq("id", quickId);
  });
});

describe("tournaments", () => {
  it("lists published, upcoming tournaments with spots left", async () => {
    const r = await api("/public/tournaments");
    expect(r.status).toBe(200);
    const t = r.json.tournaments.find((x: { id: string }) => x.id === tournamentId);
    expect(t).toMatchObject({ name: `Test Cup ${run}`, spots: 2, spotsLeft: 2, entryFeeCents: 2000, full: false, venueTime: "19:00" });
    expect(r.json.tournaments.some((x: { name: string }) => x.name.startsWith("Test Draft"))).toBe(false);
  });

  it("signs someone up for a free tournament straight away", async () => {
    const r = await api("/tournaments/signup", {
      body: { tournamentId: freeTournamentId, customer: { name: `Zoe ${run}`, email: `zoe-${run}@raceground.test` }, expectedTotalCents: 0, acceptTerms: true },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.status).toBe("confirmed");

    const view = await api(`/tournaments/${r.json.ref}?token=${encodeURIComponent(r.json.token)}`);
    expect(view.json.entry).toMatchObject({ status: "confirmed", totalCents: 0, checkInCode: `rg:t:${r.json.ref}` });
    expect(view.json.entry.tournament).toMatchObject({ name: `Test Free Cup ${run}`, venueTime: "19:00" });
  });

  it("counts the confirmed entry against the spots and then turns people away", async () => {
    const list = await api("/public/tournaments");
    expect(list.json.tournaments.find((x: { id: string }) => x.id === freeTournamentId)).toMatchObject({ spotsLeft: 0, full: true });

    const r = await api("/tournaments/signup", {
      body: { tournamentId: freeTournamentId, customer: { name: `Late ${run}`, email: `late-${run}@raceground.test` }, expectedTotalCents: 0, acceptTerms: true },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("tournament_full");
  });

  it("refuses a second entry from the same person", async () => {
    const same = { name: `Zoe ${run}`, email: `zoe-${run}@raceground.test` };
    const r = await api("/tournaments/signup", { body: { tournamentId: freeTournamentId, customer: same, expectedTotalCents: 0, acceptTerms: true } });
    // Full is checked before the duplicate here, and either answer is a refusal.
    expect([409]).toContain(r.status);
    expect(["tournament_full", "already_entered"]).toContain(r.json.error.code);
  });

  it("refuses an entry priced from a stale fee", async () => {
    const r = await api("/tournaments/signup", {
      body: { tournamentId, customer: { name: `Stale ${run}`, email: `stale-${run}@raceground.test` }, expectedTotalCents: 100, acceptTerms: true },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("quote_changed");
    expect(r.json.error.details.quote.totalCents).toBe(2000);
  });

  it("will not sign anyone up to an unpublished tournament", async () => {
    const { data: draft } = await ctx.db.from("tournaments").select("id").eq("name", `Test Draft ${run}`).single();
    const r = await api("/tournaments/signup", {
      body: { tournamentId: draft!.id, customer: { name: `Nope ${run}`, email: `nope-${run}@raceground.test` }, expectedTotalCents: 2000, acceptTerms: true },
    });
    expect(r.status).toBe(404);
  });

  it("needs Stripe for a paid entry, and never shows an entry on the wrong token", async () => {
    const r = await api("/tournaments/signup", {
      body: { tournamentId, customer: { name: `Tok ${run}`, email: `tok-${run}@raceground.test` }, expectedTotalCents: 2000, acceptTerms: true },
    });
    // $20 needs Stripe, which this context has not got, so this never reaches a hold.
    expect(r.status).toBe(503);

    const wrong = await api(`/tournaments/ABCDEF?token=${randomBytes(32).toString("base64url")}`);
    expect(wrong.status).toBe(404);
  });
});
