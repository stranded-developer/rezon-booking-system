/**
 * Pick your game, track and car (D80), against local Supabase on a fixed clock: Monday 11 Feb 2030,
 * 09:00 Sydney (AEDT, +11).
 *
 * Uses its own resource type, experience and games, so the venue's own list is never relied on.
 * The experience is $0, so a booking confirms without Stripe.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupTestData, makeStaff, operatorToken, testContext, useOpeningHours, type CallOptions, type TestContext, type TestStaff } from "./helpers.js";

const run = randomUUID().slice(0, 8);
const SAT = "2030-02-16";

let ctx: TestContext;
let owner: TestStaff;
let ownerOp: string;
let typeId: string;
let otherTypeId: string;
const resourceIds: string[] = [];
let experienceId: string;
const expKey = `test_games_${run}`;

let accId: string;
let f1Id: string;
let offId: string;
let otherTypeGameId: string;
const ids: Record<string, string> = {};

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const api = (path: string, opts: CallOptions = {}) => call(ctx, path, { ...opts, headers: { "x-forwarded-for": randomIp(), ...opts.headers } });

async function admin(path: string, opts: { method?: string; body?: unknown } = {}) {
  const r = await call(ctx, `/admin${path}`, {
    jwt: owner.jwt,
    operatorToken: ownerOp,
    ...(opts.method ? { method: opts.method } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  const renewed = r.headers.get("X-Operator-Token");
  if (renewed) ownerOp = renewed;
  return r;
}

let startHour = 10;
/** Each booking at its own hour, so they never compete for the one rig. */
const hold = (simSetup?: Record<string, string>) =>
  api("/bookings/hold", {
    body: {
      experienceKey: expKey,
      date: SAT,
      startTime: `${String(startHour++).padStart(2, "0")}:00`,
      resourceId: resourceIds[0],
      customer: { name: `Gina ${run}`, email: `gina-${run}@raceground.test` },
      ...(simSetup ? { simSetup } : {}),
      expectedTotalCents: 0,
      acceptTerms: true,
    },
  });

let restoreHours: () => Promise<void>;

beforeAll(async () => {
  ctx = testContext();
  ctx.clock.set("2030-02-11T09:00:00+11:00");
  owner = await makeStaff(ctx, "superadmin", "7319", "games-owner");
  ownerOp = await operatorToken(ctx, owner);

  const { data: types, error } = await ctx.db
    .from("resource_types")
    .insert([
      { key: `test_gm_${run}`, name: `Game Rig ${run}`, base_rate_cents: 6000, min_minutes: 15, sort: 993 },
      { key: `test_gt_${run}`, name: `Game Table ${run}`, base_rate_cents: 2500, min_minutes: 15, sort: 994 },
    ])
    .select("id, key");
  if (error) throw error;
  typeId = types.find((t) => t.key === `test_gm_${run}`)!.id;
  otherTypeId = types.find((t) => t.key === `test_gt_${run}`)!.id;

  const { data: resources, error: resourceError } = await ctx.db.from("resources").insert({ resource_type_id: typeId, label: "Rig G", sort: 1 }).select("id");
  if (resourceError) throw resourceError;
  resourceIds.push(resources[0]!.id);

  const { data: exp, error: expError } = await ctx.db
    .from("experiences")
    .insert({ key: expKey, resource_type_id: typeId, name: "Test Game Race", minutes: 30, price_cents: 0, sort: 1 })
    .select("id")
    .single();
  if (expError) throw expError;
  experienceId = exp.id;

  const { data: games, error: gameError } = await ctx.db
    .from("games")
    .insert([
      // Every row names every column: in a multi-row insert a missing column is null, not its default.
      { resource_type_id: typeId, name: `ACC ${run}`, sort: 1, active: true },
      { resource_type_id: typeId, name: `F1 ${run}`, sort: 2, active: true },
      { resource_type_id: typeId, name: `Retired ${run}`, sort: 3, active: false },
      { resource_type_id: otherTypeId, name: `Pool Game ${run}`, sort: 1, active: true },
    ])
    .select("id, name");
  if (gameError) throw gameError;
  accId = games.find((g) => g.name === `ACC ${run}`)!.id;
  f1Id = games.find((g) => g.name === `F1 ${run}`)!.id;
  offId = games.find((g) => g.name === `Retired ${run}`)!.id;
  otherTypeGameId = games.find((g) => g.name === `Pool Game ${run}`)!.id;

  const { data: tracks, error: trackError } = await ctx.db
    .from("game_tracks")
    .insert([
      { game_id: accId, name: "Monza", sort: 1, active: true },
      { game_id: accId, name: "Mount Panorama", sort: 2, active: true },
      { game_id: accId, name: "Closed Track", sort: 3, active: false },
      { game_id: f1Id, name: "Monaco", sort: 1, active: true },
    ])
    .select("id, name");
  if (trackError) throw trackError;
  for (const t of tracks) ids[`track:${t.name}`] = t.id;

  const { data: cars, error: carError } = await ctx.db
    .from("game_cars")
    .insert([
      { game_id: accId, name: "Ferrari 296 GT3", sort: 1 },
      { game_id: f1Id, name: "McLaren", sort: 1 },
    ])
    .select("id, name");
  if (carError) throw carError;
  for (const c of cars) ids[`car:${c.name}`] = c.id;

  restoreHours = await useOpeningHours(ctx);
});

afterAll(async () => {
  await restoreHours?.();
  await ctx.db.from("games").update({ active: false }).in("id", [accId, f1Id, otherTypeGameId]);
  await ctx.db.from("experiences").update({ active: false }).eq("id", experienceId);
  await ctx.db.from("resources").update({ active: false }).in("id", resourceIds);
  await ctx.db.from("resource_types").update({ active: false }).in("id", [typeId, otherTypeId]);
  await cleanupTestData(ctx);
});

describe("the public config", () => {
  it("lists active games with their active tracks and cars, in the venue's order", async () => {
    const r = await api("/public/config");
    expect(r.status).toBe(200);
    const mine = r.json.games.filter((g: { resourceTypeId: string }) => g.resourceTypeId === typeId);
    expect(mine.map((g: { name: string }) => g.name)).toEqual([`ACC ${run}`, `F1 ${run}`]);
    expect(mine[0].tracks.map((t: { name: string }) => t.name)).toEqual(["Monza", "Mount Panorama"]);
    expect(mine[0].cars.map((c: { name: string }) => c.name)).toEqual(["Ferrari 296 GT3"]);
    // A game is offered for what it belongs to: the table's game is listed against the table.
    const other = r.json.games.find((g: { id: string }) => g.id === otherTypeGameId);
    expect(other.resourceTypeId).toBe(otherTypeId);
  });
});

describe("booking with a pick", () => {
  it("keeps the names chosen, and shows them on the booking", async () => {
    const r = await hold({ gameId: accId, trackId: ids["track:Mount Panorama"]!, carId: ids["car:Ferrari 296 GT3"]! });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const view = await api(`/bookings/${r.json.ref}?token=${encodeURIComponent(r.json.token)}`);
    expect(view.json.booking.simSetup).toEqual({ game: `ACC ${run}`, track: "Mount Panorama", car: "Ferrari 296 GT3" });

    // Names, not ids: renaming the car afterwards does not rewrite what was booked.
    await ctx.db.from("game_cars").update({ name: "Ferrari 296 GT3 Evo" }).eq("id", ids["car:Ferrari 296 GT3"]!);
    const again = await api(`/bookings/${r.json.ref}?token=${encodeURIComponent(r.json.token)}`);
    expect(again.json.booking.simSetup.car).toBe("Ferrari 296 GT3");
    await ctx.db.from("game_cars").update({ name: "Ferrari 296 GT3" }).eq("id", ids["car:Ferrari 296 GT3"]!);
  });

  it("takes a game on its own", async () => {
    const r = await hold({ gameId: f1Id });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { data } = await ctx.db.from("bookings").select("sim_setup").eq("ref", r.json.ref).single();
    expect(data!.sim_setup).toEqual({ game: `F1 ${run}` });
  });

  it("stores nothing when nothing was picked", async () => {
    const r = await hold();
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { data } = await ctx.db.from("bookings").select("sim_setup").eq("ref", r.json.ref).single();
    expect(data!.sim_setup).toBeNull();
  });

  it("refuses a track or car from a different game", async () => {
    const track = await hold({ gameId: accId, trackId: ids["track:Monaco"]! });
    expect(track.status).toBe(422);
    expect(track.json.error.message).toContain("track");
    const car = await hold({ gameId: accId, carId: ids["car:McLaren"]! });
    expect(car.status).toBe(422);
    expect(car.json.error.message).toContain("car");
  });

  it("refuses a switched-off game or track, and a game for something else", async () => {
    expect((await hold({ gameId: offId })).status).toBe(422);
    expect((await hold({ gameId: accId, trackId: ids["track:Closed Track"]! })).status).toBe(422);
    expect((await hold({ gameId: otherTypeGameId })).status).toBe(422);
  });

  it("never lets a refused pick leave a booking behind", async () => {
    const before = await ctx.db.from("bookings").select("id", { count: "exact", head: true }).eq("resource_id", resourceIds[0]!);
    await hold({ gameId: accId, trackId: ids["track:Monaco"]! });
    const after = await ctx.db.from("bookings").select("id", { count: "exact", head: true }).eq("resource_id", resourceIds[0]!);
    expect(after.count).toBe(before.count);
  });
});

describe("the back office list", () => {
  it("replaces a game's tracks and cars with the list sent, in order, and audits it", async () => {
    const r = await admin(`/games/${accId}`, {
      method: "PATCH",
      body: { tracks: ["Spa-Francorchamps", "Monza", "monza"], cars: ["BMW M4 GT3", "Ferrari 296 GT3"], reason: "New season" },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    const list = await admin("/games");
    const acc = list.json.games.find((g: { id: string }) => g.id === accId);
    // Mount Panorama was left out, so it's gone; "monza" repeats "Monza", so it's kept once.
    expect(acc.tracks).toEqual(["Spa-Francorchamps", "Monza"]);
    expect(acc.cars).toEqual(["BMW M4 GT3", "Ferrari 296 GT3"]);
    // Monza kept its row (and its id); only its position changed.
    const { data: monza } = await ctx.db.from("game_tracks").select("id, sort").eq("game_id", accId).eq("name", "Monza").single();
    expect(monza).toEqual({ id: ids["track:Monza"], sort: 2 });

    const { data: audit } = await ctx.db.from("audit_log").select("reason, actor_staff_id").eq("entity", "game_tracks").eq("entity_id", ids["track:Monza"]!).order("id", { ascending: false }).limit(1).single();
    expect(audit).toMatchObject({ reason: "New season", actor_staff_id: owner.id });
  });

  it("adds a game with its lists, and turns one off", async () => {
    const r = await admin("/games", { body: { resourceTypeId: typeId, name: `iRacing ${run}`, tracks: ["Bathurst"], cars: ["Mazda MX-5"] } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const id = r.json.game.id as string;
    expect((await admin(`/games/${id}`, { method: "PATCH", body: { active: false } })).status).toBe(200);
    const config = await api("/public/config");
    expect(config.json.games.some((g: { id: string }) => g.id === id)).toBe(false);
  });
});
