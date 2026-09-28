/**
 * Back office API for experiences, promotional prices, tournaments and site events (D65–D69).
 *
 * Every write is checked for its audit row, because these are prices: an experience's price, a
 * promotional price and a tournament's entry fee all have to be traceable to who changed them.
 * Everything this file creates it also deactivates, so it passes on a used database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupTestData, finishOpenWork, makeStaff, operatorToken, testContext, type TestContext, type TestStaff } from "./helpers.js";

let ctx: TestContext;
let owner: TestStaff;
let cashier: TestStaff;
let ownerOp: string;
let cashierOp: string;
const run = randomUUID().slice(0, 6);

let simTypeId: string;
let experienceId: string;
let promoId: string;
let tournamentId: string;
let eventId: string;
let shiftOpened = false;
let counterTournamentId: string;

async function admin(path: string, opts: { method?: string; body?: unknown; as?: "owner" | "cashier" } = {}) {
  const asCashier = opts.as === "cashier";
  const r = await call(ctx, `/admin${path}`, {
    jwt: owner.jwt,
    operatorToken: asCashier ? cashierOp : ownerOp,
    ...(opts.method ? { method: opts.method } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  const renewed = r.headers.get("X-Operator-Token");
  if (renewed) {
    if (asCashier) cashierOp = renewed;
    else ownerOp = renewed;
  }
  return r;
}

async function lastAudit(entity: string, entityId: string) {
  const { data } = await ctx.db.from("audit_log").select("*").eq("entity", entity).eq("entity_id", entityId).order("id", { ascending: false }).limit(1).maybeSingle();
  return data;
}

beforeAll(async () => {
  ctx = testContext();
  owner = await makeStaff(ctx, "superadmin", "9753", "xp-owner");
  cashier = await makeStaff(ctx, "cashier", "8642", "xp-cashier");
  ownerOp = await operatorToken(ctx, owner);
  // The device is the owner's POS session; the cashier is the operator signed in on it.
  // A token minted for a different device is a foreign token, and the API refuses it as 401.
  cashierOp = await operatorToken(ctx, owner, cashier);
  await finishOpenWork(ctx, owner.id);

  const { data: type, error } = await ctx.db
    .from("resource_types")
    .insert({ key: `test_adm_${run}`, name: `Admin Rig ${run}`, base_rate_cents: 6000, min_minutes: 15, sort: 992 })
    .select("id")
    .single();
  if (error) throw error;
  simTypeId = type.id;
});

afterAll(async () => {
  if (shiftOpened) await finishOpenWork(ctx, owner.id);
  if (experienceId) await ctx.db.from("experiences").update({ active: false }).eq("id", experienceId);
  for (const id of [tournamentId, counterTournamentId].filter(Boolean)) {
    await ctx.db.from("tournaments").update({ published: false }).eq("id", id);
  }
  if (eventId) await ctx.db.from("site_events").update({ active: false }).eq("id", eventId);
  await ctx.db.from("resource_types").update({ active: false }).eq("id", simTypeId);
  await cleanupTestData(ctx);
});

describe("experiences", () => {
  it("creates one, and records who did it and why", async () => {
    const r = await admin("/experiences", {
      body: {
        key: `adm_quick_${run}`,
        resourceTypeId: simTypeId,
        name: `Admin Quick ${run}`,
        tagline: "Single session",
        bullets: ["One 30-minute session", "Race solo or against friends"],
        badges: ["Most popular"],
        minutes: 30,
        priceCents: 3500,
        reason: "Launch price list",
      },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    experienceId = r.json.experience.id;
    expect(r.json.experience).toMatchObject({ minutes: 30, price_cents: 3500, badges: ["Most popular"], active: true });

    const audit = await lastAudit("experiences", experienceId);
    expect(audit).toMatchObject({ action: "experiences.insert", actor_staff_id: owner.id, reason: "Launch price list" });
  });

  it("refuses a length that is not a whole number of sessions", async () => {
    const r = await admin("/experiences", {
      body: { key: `adm_bad_${run}`, resourceTypeId: simTypeId, name: "Bad", minutes: 40, priceCents: 1000 },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.message).toMatch(/30-minute sessions/);
  });

  it("refuses a bad short code and a negative price", async () => {
    expect((await admin("/experiences", { body: { key: "Not Valid", resourceTypeId: simTypeId, name: "x", minutes: 30, priceCents: 100 } })).status).toBe(422);
    expect((await admin("/experiences", { body: { key: `adm_neg_${run}`, resourceTypeId: simTypeId, name: "x", minutes: 30, priceCents: -1 } })).status).toBe(422);
  });

  it("changes the price, and the audit row shows what it was before", async () => {
    const r = await admin(`/experiences/${experienceId}`, { method: "PATCH", body: { priceCents: 3900, reason: "Spring review" } });
    expect(r.status).toBe(200);
    expect(r.json.experience.price_cents).toBe(3900);

    const audit = await lastAudit("experiences", experienceId);
    expect(audit).toMatchObject({ action: "experiences.update", actor_staff_id: owner.id, reason: "Spring review" });
    expect((audit!.before as { price_cents: number }).price_cents).toBe(3500);
    expect((audit!.after as { price_cents: number }).price_cents).toBe(3900);
  });

  it("refuses an edit that would leave a length off the session grid", async () => {
    const r = await admin(`/experiences/${experienceId}`, { method: "PATCH", body: { minutes: 50 } });
    expect(r.status).toBe(422);
  });

  it("is only for superadmins, on every one of these areas", async () => {
    for (const path of ["/experiences", "/experience-promos", "/tournaments", "/site-events"]) {
      expect((await admin(path, { as: "cashier" })).status, path).toBe(403);
    }
  });
});

describe("promotional prices", () => {
  it("adds one, and says whether it applies by itself", async () => {
    const r = await admin("/experience-promos", {
      body: {
        experienceId,
        name: "Happy Hour",
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        startTime: "12:00",
        endTime: "15:00",
        priceCents: 2900,
        reason: "Launch",
      },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    promoId = r.json.promo.id;
    expect(r.json.promo).toMatchObject({ price_cents: 2900, claimed: false });
    expect(await lastAudit("experience_promos", promoId)).toMatchObject({ action: "experience_promos.insert", actor_staff_id: owner.id });
  });

  it("allows a second price over the same hours: the cheapest wins (D66)", async () => {
    const r = await admin("/experience-promos", {
      body: { experienceId, name: "Student", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "00:00", endTime: "24:00", priceCents: 3200, claimed: true },
    });
    // Rate bands and percentage happy hours reject an overlap; here an overlap is the rule itself.
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.promo.claimed).toBe(true);
  });

  it("refuses a window that ends before it starts, and one with no days", async () => {
    expect(
      (await admin("/experience-promos", { body: { experienceId, name: "Backwards", daysOfWeek: [1], startTime: "15:00", endTime: "12:00", priceCents: 100 } })).status,
    ).toBe(422);
    expect((await admin("/experience-promos", { body: { experienceId, name: "Nodays", daysOfWeek: [], startTime: "12:00", endTime: "15:00", priceCents: 100 } })).status).toBe(422);
  });

  it("shows the experience with its prices, and the times as HH:MM", async () => {
    const r = await admin("/experiences");
    const exp = r.json.experiences.find((e: { id: string }) => e.id === experienceId);
    expect(exp.promos).toHaveLength(2);
    expect(exp.promos.find((p: { name: string }) => p.name === "Happy Hour")).toMatchObject({ start_time: "12:00", end_time: "15:00" });
  });

  it("deletes one, and records the deletion", async () => {
    const r = await admin(`/experience-promos/${promoId}?reason=No+longer+running`, { method: "DELETE" });
    expect(r.status).toBe(200);
    expect(await lastAudit("experience_promos", promoId)).toMatchObject({ action: "experience_promos.delete", reason: "No longer running" });
    expect((await admin(`/experience-promos/${promoId}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("tournaments", () => {
  it("creates one as a draft, invisible to the public until published", async () => {
    const startsAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const r = await admin("/tournaments", {
      body: { name: `Admin Cup ${run}`, blurb: "Eight drivers, one trophy.", startsAt, spots: 8, entryFeeCents: 2500, reason: "October calendar" },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    tournamentId = r.json.tournament.id;
    expect(r.json.tournament).toMatchObject({ spots: 8, entry_fee_cents: 2500, published: false });
    expect(await lastAudit("tournaments", tournamentId)).toMatchObject({ action: "tournaments.insert", reason: "October calendar" });

    const publicList = await call(ctx, "/public/tournaments");
    expect(publicList.json.tournaments.some((t: { id: string }) => t.id === tournamentId)).toBe(false);
  });

  it("shows up publicly once published, with all its spots free", async () => {
    const r = await admin(`/tournaments/${tournamentId}`, { method: "PATCH", body: { published: true } });
    expect(r.status).toBe(200);
    const publicList = await call(ctx, "/public/tournaments");
    expect(publicList.json.tournaments.find((t: { id: string }) => t.id === tournamentId)).toMatchObject({ spots: 8, spotsLeft: 8, full: false });
  });

  it("lists it in the back office with how many are signed up", async () => {
    const r = await admin("/tournaments");
    expect(r.json.tournaments.find((t: { id: string }) => t.id === tournamentId)).toMatchObject({ entries: 0, spots_left: 8 });
  });

  it("will not cut the spots below the people already signed up", async () => {
    const { data: customer } = await ctx.db.from("customers").insert({ name: `Adm Entrant ${run}`, email: `adm-entrant-${run}@raceground.test` }).select("id").single();
    await ctx.db.from("tournament_entries").insert({
      tournament_id: tournamentId,
      customer_id: customer!.id,
      status: "confirmed",
      total_cents: 2500,
      gst_cents: 227,
    });

    const r = await admin(`/tournaments/${tournamentId}`, { method: "PATCH", body: { spots: 0 } });
    // 0 is refused by validation before the count is even consulted.
    expect(r.status).toBe(422);

    const one = await admin(`/tournaments/${tournamentId}`, { method: "PATCH", body: { spots: 1 } });
    expect(one.status).toBe(200); // exactly the number signed up is fine

    const { data: second } = await ctx.db.from("customers").insert({ name: `Adm Two ${run}`, email: `adm-two-${run}@raceground.test` }).select("id").single();
    await ctx.db.from("tournament_entries").insert({ tournament_id: tournamentId, customer_id: second!.id, status: "confirmed", total_cents: 2500, gst_cents: 227 });

    const tooFew = await admin(`/tournaments/${tournamentId}`, { method: "PATCH", body: { spots: 1 } });
    expect(tooFew.status).toBe(409);
    expect(tooFew.json.error.code).toBe("spots_below_entries");
    expect(tooFew.json.error.message).toMatch(/2 people are already signed up/);
  });

  it("adds someone at the counter, taking the fee on the open till (D75)", async () => {
    // Its own tournament with room in it: the one above was deliberately shrunk to its entries.
    const startsAt = new Date(Date.now() + 25 * 86_400_000).toISOString();
    const made = await admin("/tournaments", { body: { name: `Counter Cup ${run}`, startsAt, spots: 5, entryFeeCents: 2500, published: true } });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    counterTournamentId = made.json.tournament.id;

    // A till has to be open before money can be taken, the same as any other counter sale.
    const noTill = await call(ctx, "/pos/tournaments/counter-entry", {
      jwt: owner.jwt,
      operatorToken: ownerOp,
      body: { tournamentId: counterTournamentId, name: `Walkup ${run}`, email: `walkup-${run}@raceground.test`, method: "cash" },
    });
    expect(noTill.status).toBe(409);
    expect(noTill.json.error.code).toBe("no_shift");

    const opened = await call(ctx, "/pos/shifts/open", { jwt: owner.jwt, operatorToken: ownerOp, body: { openingFloatCents: 10000 } });
    expect([200, 201]).toContain(opened.status);
    ownerOp = opened.headers.get("X-Operator-Token") ?? ownerOp;
    shiftOpened = true;

    const paid = await call(ctx, "/pos/tournaments/counter-entry", {
      jwt: owner.jwt,
      operatorToken: ownerOp,
      body: { tournamentId: counterTournamentId, name: `Walkup ${run}`, email: `walkup-${run}@raceground.test`, method: "cash" },
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(201);
    ownerOp = paid.headers.get("X-Operator-Token") ?? ownerOp;
    // The amount comes from the tournament's own fee, never from the request.
    expect(paid.json.amountCents).toBe(2500);
    expect(paid.json.ref).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

    const { data: movement } = await ctx.db
      .from("cash_movements")
      .select("kind, amount_cents")
      .eq("payment_id", (await ctx.db.from("payments").select("id").eq("tournament_entry_id", paid.json.entryId).single()).data!.id)
      .single();
    expect(movement).toMatchObject({ kind: "sale", amount_cents: 2500 });
    expect(await lastAudit("tournament_entries", paid.json.entryId)).toMatchObject({ action: "tournament.counter_entry", actor_staff_id: owner.id });
  });

  it("adds someone with no charge, without needing a till", async () => {
    const free = await call(ctx, "/pos/tournaments/counter-entry", {
      jwt: owner.jwt,
      operatorToken: ownerOp,
      body: { tournamentId: counterTournamentId, name: `Comp ${run}`, email: `comp-${run}@raceground.test`, method: "free", reason: "Prize winner" },
    });
    expect(free.status, JSON.stringify(free.json)).toBe(201);
    ownerOp = free.headers.get("X-Operator-Token") ?? ownerOp;
    expect(free.json.amountCents).toBe(0);
    expect(await lastAudit("tournament_entries", free.json.entryId)).toMatchObject({ reason: "Prize winner" });

    // The same person cannot be added twice.
    const again = await call(ctx, "/pos/tournaments/counter-entry", {
      jwt: owner.jwt,
      operatorToken: ownerOp,
      body: { tournamentId: counterTournamentId, name: `Comp ${run}`, email: `comp-${run}@raceground.test`, method: "free" },
    });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("already_entered");
  });

  it("lists who is in, with their contact details", async () => {
    const r = await admin(`/tournaments/${tournamentId}/entries`);
    expect(r.status).toBe(200);
    expect(r.json.entries.length).toBeGreaterThanOrEqual(2);
    expect(r.json.entries[0].customers.email).toMatch(/@raceground.test$/);
  });
});

describe("site events", () => {
  it("creates one and shows it publicly straight away", async () => {
    const r = await admin("/site-events", {
      body: { title: `Admin Event ${run}`, detail: "$2,000 cash prize pool", body: "Come along.", ctaLabel: "Enter now", ctaUrl: "/tournaments", reason: "October promo" },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    eventId = r.json.event.id;
    expect(await lastAudit("site_events", eventId)).toMatchObject({ action: "site_events.insert", reason: "October promo" });

    const config = await call(ctx, "/public/config");
    expect(config.json.events.find((e: { id: string }) => e.id === eventId)).toMatchObject({ detail: "$2,000 cash prize pool", ctaLabel: "Enter now", asPopup: true });
  });

  it("refuses a button with a label and no link", async () => {
    const r = await admin("/site-events", { body: { title: "Half a button", ctaLabel: "Go" } });
    expect(r.status).toBe(422);
  });

  it("hides it when it is turned off", async () => {
    await admin(`/site-events/${eventId}`, { method: "PATCH", body: { active: false, reason: "Finished" } });
    const config = await call(ctx, "/public/config");
    expect(config.json.events.find((e: { id: string }) => e.id === eventId)).toBeUndefined();
    await admin(`/site-events/${eventId}`, { method: "PATCH", body: { active: true } });
  });

  it("hides it outside its window", async () => {
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString();
    await admin(`/site-events/${eventId}`, { method: "PATCH", body: { showFrom: future } });
    const config = await call(ctx, "/public/config");
    expect(config.json.events.find((e: { id: string }) => e.id === eventId)).toBeUndefined();
    await admin(`/site-events/${eventId}`, { method: "PATCH", body: { showFrom: null } });
    const again = await call(ctx, "/public/config");
    expect(again.json.events.find((e: { id: string }) => e.id === eventId)).toBeDefined();
  });
});
