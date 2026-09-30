/**
 * Member prices (D82), arriving early (D85) and the home page tiles (D87), against local Supabase
 * on a fixed clock: Monday 11 Feb 2030, 09:00 Sydney (AEDT, +11).
 *
 * Uses its own resource type, experience, promotions and members, so the launch data is never
 * relied on for the arithmetic.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupTestData,
  makeStaff,
  operatorToken,
  PASSWORD,
  signIn,
  testContext,
  useOpeningHours,
  type CallOptions,
  type TestContext,
  type TestStaff,
} from "./helpers.js";

const run = randomUUID().slice(0, 8);
const SAT = "2030-02-16";
const expKey = `test_mp_${run}`;

let ctx: TestContext;
let owner: TestStaff;
let ownerOp: string;
let typeId: string;
let resourceId: string;
let experienceId: string;
let silverTierId: string;
let goldTierId: string;
let silverJwt: string;
let goldJwt: string;
const userIds: string[] = [];
const tileIds: string[] = [];

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

/** An admin upload: the same call, as a multipart form. */
async function adminUpload(path: string, bytes: Uint8Array, name: string) {
  const form = new FormData();
  form.set("file", new File([bytes], name));
  const r = await ctx.app.request(`/admin${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${owner.jwt}`, "X-Operator-Token": ownerOp },
    body: form,
  });
  const renewed = r.headers.get("X-Operator-Token");
  if (renewed) ownerOp = renewed;
  return { status: r.status, json: (await r.json()) as Record<string, any> };
}

/** A member of `tier`, signed in on the website. */
async function memberOf(tierId: string, label: string): Promise<string> {
  const email = `${label}-${run}@raceground.test`;
  const { data: customer, error } = await ctx.db.from("customers").insert({ name: `${label} ${run}`, email }).select("id").single();
  if (error) throw error;
  const { error: memberError } = await ctx.db
    .from("members")
    .insert({ customer_id: customer.id, tier_id: tierId, status: "active", qr_token_hash: randomBytes(32).toString("hex") });
  if (memberError) throw memberError;
  const { data: user, error: userError } = await ctx.db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (userError) throw userError;
  userIds.push(user.user.id);
  const jwt = await signIn(ctx, email);
  expect((await api("/me", { jwt })).json.member.eligible).toBe(true);
  return jwt;
}

const quote = (jwt: string | null, startTime: string, over: Record<string, unknown> = {}) =>
  api("/public/quote", { ...(jwt ? { jwt } : {}), body: { experienceKey: expKey, date: SAT, startTime, ...over } });

let restoreHours: () => Promise<void>;
let studentPromoId: string;

beforeAll(async () => {
  ctx = testContext();
  ctx.clock.set("2030-02-11T09:00:00+11:00");
  owner = await makeStaff(ctx, "superadmin", "6184", "mp-owner");
  ownerOp = await operatorToken(ctx, owner);

  const { data: type, error } = await ctx.db
    .from("resource_types")
    .insert({ key: `test_mp_${run}`, name: `MP Rig ${run}`, base_rate_cents: 6000, min_minutes: 15, sort: 995 })
    .select("id")
    .single();
  if (error) throw error;
  typeId = type.id;
  const { data: resource, error: rError } = await ctx.db.from("resources").insert({ resource_type_id: typeId, label: "Rig M", sort: 1 }).select("id").single();
  if (rError) throw rError;
  resourceId = resource.id;

  const { data: exp, error: eError } = await ctx.db
    .from("experiences")
    .insert({ key: expKey, resource_type_id: typeId, name: "Test Session", minutes: 30, price_cents: 35_00, sort: 1 })
    .select("id")
    .single();
  if (eError) throw eError;
  experienceId = exp.id;

  const { data: promos, error: pError } = await ctx.db
    .from("experience_promos")
    .insert([
      { experience_id: experienceId, name: "Test Happy Hour", days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "12:00", end_time: "15:00", price_cents: 29_00, claimed: false },
      { experience_id: experienceId, name: "Test Student", days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "00:00", end_time: "24:00", price_cents: 26_00, claimed: true },
    ])
    .select("id, name");
  if (pError) throw pError;
  studentPromoId = promos.find((p) => p.name === "Test Student")!.id;

  const { data: tiers } = await ctx.db.from("membership_tiers").select("id, name").in("name", ["Silver", "Gold"]);
  silverTierId = tiers!.find((t) => t.name === "Silver")!.id;
  goldTierId = tiers!.find((t) => t.name === "Gold")!.id;
  silverJwt = await memberOf(silverTierId, "silver");
  goldJwt = await memberOf(goldTierId, "gold");

  restoreHours = await useOpeningHours(ctx);
});

afterAll(async () => {
  await restoreHours?.();
  for (const id of tileIds) await ctx.db.from("site_tiles").delete().eq("id", id);
  await ctx.db.from("experiences").update({ active: false }).eq("id", experienceId);
  await ctx.db.from("resources").update({ active: false }).eq("id", resourceId);
  await ctx.db.from("resource_types").update({ active: false }).eq("id", typeId);
  for (const id of userIds) await ctx.db.auth.admin.deleteUser(id);
  await cleanupTestData(ctx);
});

describe("member prices (D82)", () => {
  it("are set in the back office, audited, and published for the membership page", async () => {
    const r = await admin(`/experiences/${experienceId}/member-prices`, {
      method: "PUT",
      body: { prices: [{ tierId: silverTierId, priceCents: 32_00 }, { tierId: goldTierId, priceCents: 28_00 }], reason: "Poster" },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    const config = await api("/public/config");
    const exp = config.json.experiences.find((e: { key: string }) => e.key === expKey);
    expect(exp.memberPrices).toEqual(
      expect.arrayContaining([
        { tierId: silverTierId, priceCents: 32_00 },
        { tierId: goldTierId, priceCents: 28_00 },
      ]),
    );
    const { data: audit } = await ctx.db.from("audit_log").select("actor_staff_id, reason").eq("entity", "experience_member_prices").order("id", { ascending: false }).limit(1).single();
    expect(audit).toEqual({ actor_staff_id: owner.id, reason: "Poster" });
  });

  it("charges a member their tier's flat price, not a percentage off", async () => {
    const gold = await quote(goldJwt, "17:00");
    expect(gold.status, JSON.stringify(gold.json)).toBe(200);
    expect(gold.json.quote.totalCents).toBe(28_00);
    const silver = await quote(silverJwt, "17:00");
    // Silver 10% of $35 would be $31.50; the poster price is $32.
    expect(silver.json.quote.totalCents).toBe(32_00);
    expect(silver.json.quote.explanation[0]).toContain("Silver member price $32.00");
  });

  it("never stacks with Happy Hour: the cheaper of the two is charged", async () => {
    // Gold's $28 beats $29 — it is not $29 less 20%.
    expect((await quote(goldJwt, "13:00")).json.quote.totalCents).toBe(28_00);
    // Silver's $32 loses to $29, which Silver pays in full.
    const silver = await quote(silverJwt, "13:00");
    expect(silver.json.quote.totalCents).toBe(29_00);
    expect(silver.json.quote.explanation[0]).toContain("Test Happy Hour");
  });

  it("lets a cheaper price the member asks for win, still without stacking", async () => {
    const r = await quote(goldJwt, "17:00", { claimedPromoIds: [studentPromoId] });
    expect(r.json.quote.totalCents).toBe(26_00);
  });

  it("falls back to the tier's percentage once the flat price is removed", async () => {
    await admin(`/experiences/${experienceId}/member-prices`, { method: "PUT", body: { prices: [{ tierId: silverTierId, priceCents: null }] } });
    expect((await quote(silverJwt, "17:00")).json.quote.totalCents).toBe(31_50);
    await admin(`/experiences/${experienceId}/member-prices`, { method: "PUT", body: { prices: [{ tierId: silverTierId, priceCents: 32_00 }] } });
  });

  it("leaves a guest's price alone", async () => {
    expect((await quote(null, "17:00")).json.quote.totalCents).toBe(35_00);
    expect((await quote(null, "13:00")).json.quote.totalCents).toBe(29_00);
  });
});

describe("arriving early (D85)", () => {
  it("is a venue setting the site and the booking both carry", async () => {
    const before = (await api("/public/config")).json.arriveEarlyMinutes;
    expect(typeof before).toBe("number");
    expect((await admin("/settings", { method: "PATCH", body: { arriveEarlyMinutes: 20 } })).status).toBe(200);
    expect((await api("/public/config")).json.arriveEarlyMinutes).toBe(20);
    await admin("/settings", { method: "PATCH", body: { arriveEarlyMinutes: before } });
  });
});

describe("home page tiles (D87)", () => {
  // The smallest valid PNG and a file that only claims to be one.
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  const fake = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
  let tileId: string;

  it("adds a tile at the end of its section", async () => {
    const r = await admin("/site-tiles", { body: { section: "driving", title: `Karting ${run}` } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    tileId = r.json.tile.id;
    tileIds.push(tileId);
    const { data } = await ctx.db.from("site_tiles").select("sort").eq("section", "driving");
    expect(r.json.tile.sort).toBe(Math.max(...data!.map((t) => t.sort)));
    expect(r.json.tile.imageUrl).toBeNull();
  });

  it("takes an image, checked by its contents, and shows it on the site", async () => {
    expect((await adminUpload(`/site-tiles/${tileId}/image`, fake, "tile.png")).status).toBe(422);
    const r = await adminUpload(`/site-tiles/${tileId}/image`, png, "tile.png");
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.tile.imageUrl).toMatch(/\/storage\/v1\/object\/public\/venue-photos\/tiles\/.+\.png$/);
    const config = await api("/public/config");
    expect(config.json.tiles.find((t: { id: string }) => t.id === tileId)).toMatchObject({ section: "driving", title: `Karting ${run}`, imageUrl: r.json.tile.imageUrl });
    // The file is really there.
    expect((await fetch(r.json.tile.imageUrl)).status).toBe(200);
  });

  it("replaces an image and removes the old file", async () => {
    const first = (await admin("/site-tiles")).json.tiles.find((t: { id: string }) => t.id === tileId).imageUrl as string;
    const second = await adminUpload(`/site-tiles/${tileId}/image`, png, "again.png");
    expect(second.json.tile.imageUrl).not.toBe(first);
    expect((await fetch(first)).status).not.toBe(200);
  });

  it("renames, hides and removes a tile", async () => {
    expect((await admin(`/site-tiles/${tileId}`, { method: "PATCH", body: { title: `Go-karts ${run}` } })).json.tile.title).toBe(`Go-karts ${run}`);
    await admin(`/site-tiles/${tileId}`, { method: "PATCH", body: { active: false } });
    expect((await api("/public/config")).json.tiles.some((t: { id: string }) => t.id === tileId)).toBe(false);
    const url = (await admin("/site-tiles")).json.tiles.find((t: { id: string }) => t.id === tileId).imageUrl as string;
    expect((await admin(`/site-tiles/${tileId}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(url)).status).not.toBe(200);
  });

  it("refuses a section that doesn't exist", async () => {
    expect((await admin("/site-tiles", { body: { section: "footer", title: "x" } })).status).toBe(422);
  });
});
