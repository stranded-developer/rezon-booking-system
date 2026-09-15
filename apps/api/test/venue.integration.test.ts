/**
 * Venue contact details and website photos (D58) against local Supabase, including real Storage.
 * Settings are restored and every photo this file adds is removed afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PHOTOS, PHOTO_BUCKET } from "../src/services/venue-photos.js";
import { call, cleanupTestData, makeStaff, operatorToken, testContext, type TestContext, type TestStaff } from "./helpers.js";

let ctx: TestContext;
let owner: TestStaff;
let cashier: TestStaff;
let ownerOp: string;
let cashierOp: string;
let originalSettings: Record<string, unknown>;
const added: string[] = [];

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([40, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 2)]);

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

async function upload(bytes: Buffer, opts: { name?: string; type?: string; caption?: string; as?: "owner" | "cashier" } = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], opts.name ?? "photo.png", { type: opts.type ?? "image/png" }));
  if (opts.caption !== undefined) form.set("caption", opts.caption);
  const res = await ctx.app.request("/admin/venue-photos", {
    method: "POST",
    headers: { Authorization: `Bearer ${owner.jwt}`, "X-Operator-Token": opts.as === "cashier" ? cashierOp : ownerOp },
    body: form,
  });
  const json = (await res.json()) as Record<string, any>;
  if (res.status === 201) added.push(json.photo.id);
  return { status: res.status, json };
}

const lastAudit = async (entity: string, entityId: string) =>
  (await ctx.db.from("audit_log").select("*").eq("entity", entity).eq("entity_id", entityId).order("id", { ascending: false }).limit(1).maybeSingle()).data;

beforeAll(async () => {
  ctx = testContext();
  owner = await makeStaff(ctx, "superadmin", "2468", "venue-owner");
  cashier = await makeStaff(ctx, "cashier", "1357", "venue-cashier");
  ownerOp = await operatorToken(ctx, owner);
  cashierOp = await operatorToken(ctx, owner, cashier);
  originalSettings = (await ctx.db.from("venue_settings").select("*").eq("id", 1).single()).data!;
});

afterAll(async () => {
  const { address, phone, contact_email, intro, instagram_url } = originalSettings as Record<"address" | "phone" | "contact_email" | "intro" | "instagram_url", string | null>;
  await ctx.db.from("venue_settings").update({ address, phone, contact_email, intro, instagram_url }).eq("id", 1);
  const { data } = await ctx.db.from("venue_photos").select("id, storage_path").in("id", added);
  if (data?.length) {
    await ctx.db.from("venue_photos").delete().in("id", data.map((p) => p.id));
    await ctx.db.storage.from(PHOTO_BUCKET).remove(data.map((p) => p.storage_path));
  }
  await cleanupTestData(ctx);
});

describe("contact details", () => {
  it("are saved with an audit row and shown in the public config", async () => {
    const r = await admin("/settings", {
      method: "PATCH",
      body: {
        address: " 1 George St, Sydney NSW 2000 ",
        phone: "+61 2 9000 0000",
        contactEmail: "hello@raceground.test",
        intro: "Pool tables, driving sims and VR.",
        instagramUrl: "https://www.instagram.com/raceground/",
        reason: "Website details",
      },
    });
    expect(r.status).toBe(200);
    expect(r.json.settings).toMatchObject({ address: "1 George St, Sydney NSW 2000", phone: "+61 2 9000 0000", contact_email: "hello@raceground.test" });
    expect(await lastAudit("venue_settings", "1")).toMatchObject({ actor_staff_id: owner.id, action: "venue_settings.update", reason: "Website details" });

    const config = await call(ctx, "/public/config");
    expect(config.json.venue).toEqual({
      address: "1 George St, Sydney NSW 2000",
      phone: "+61 2 9000 0000",
      email: "hello@raceground.test",
      intro: "Pool tables, driving sims and VR.",
      instagramUrl: "https://www.instagram.com/raceground/",
    });
  });

  it("empty text clears a field", async () => {
    const r = await admin("/settings", { method: "PATCH", body: { address: "", instagramUrl: "  " } });
    expect(r.status).toBe(200);
    expect(r.json.settings).toMatchObject({ address: null, instagram_url: null });
  });

  it("refuses bad values and cashiers", async () => {
    for (const body of [{ phone: "call me" }, { contactEmail: "nope" }, { instagramUrl: "https://evil.example/raceground" }, { intro: "x".repeat(1001) }]) {
      const r = await admin("/settings", { method: "PATCH", body });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    expect((await admin("/settings", { method: "PATCH", body: { address: "Somewhere" }, as: "cashier" })).status).toBe(403);
    expect((await admin("/venue-photos", { as: "cashier" })).status).toBe(403);
  });
});

describe("photos", () => {
  it("an uploaded photo is stored, public, audited and listed on the website", async () => {
    const r = await upload(PNG, { caption: " The sim room " });
    expect(r.status).toBe(201);
    expect(r.json.photo).toMatchObject({ caption: "The sim room" });
    const url = r.json.photo.url as string;
    expect(url).toMatch(new RegExp(`/storage/v1/object/public/${PHOTO_BUCKET}/[0-9a-f-]{36}\\.png$`));

    const file = await fetch(url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);

    expect(await lastAudit("venue_photos", r.json.photo.id)).toMatchObject({ actor_staff_id: owner.id, action: "venue_photos.insert", reason: "Photo added" });
    const config = await call(ctx, "/public/config");
    expect(config.json.photos).toContainEqual({ url, caption: "The sim room" });
  });

  it("detects the real file type instead of trusting the name", async () => {
    const jpeg = await upload(JPEG, { name: "photo.png", type: "image/png" });
    expect(jpeg.status).toBe(201);
    expect(jpeg.json.photo.url).toMatch(/\.jpg$/);
    const webp = await upload(WEBP, { name: "x.bin", type: "application/octet-stream" });
    expect(webp.status).toBe(201);
    expect(webp.json.photo.url).toMatch(/\.webp$/);

    const text = await upload(Buffer.from("<script>alert(1)</script>"), { name: "evil.jpg", type: "image/jpeg" });
    expect(text.status).toBe(422);
    const gif = await upload(Buffer.from("GIF89a0000000000"), { name: "a.gif", type: "image/gif" });
    expect(gif.status).toBe(422);
    expect((await upload(Buffer.alloc(0))).status).toBe(422);
  });

  it("refuses photos over 5 MB, long captions, a missing file and cashiers", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const r = await upload(big);
    expect([413, 422]).toContain(r.status);
    expect(r.json.error.message).toContain("5 MB");
    expect((await upload(PNG, { caption: "x".repeat(201) })).status).toBe(422);
    expect((await upload(PNG, { as: "cashier" })).status).toBe(403);

    const form = new FormData();
    form.set("caption", "no file");
    const res = await ctx.app.request("/admin/venue-photos", { method: "POST", headers: { Authorization: `Bearer ${owner.jwt}`, "X-Operator-Token": ownerOp }, body: form });
    expect(res.status).toBe(422);
  });

  it("a browser can't upload straight to Storage, even signed in", async () => {
    const anon = createClient(ctx.supabase.url, ctx.supabase.publishableKey, { auth: { persistSession: false } });
    const { error } = await anon.storage.from(PHOTO_BUCKET).upload(`${crypto.randomUUID()}.png`, PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();

    const signedIn = createClient(ctx.supabase.url, ctx.supabase.publishableKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${owner.jwt}` } } });
    const staffTry = await signedIn.storage.from(PHOTO_BUCKET).upload(`${crypto.randomUUID()}.png`, PNG, { contentType: "image/png" });
    expect(staffTry.error).not.toBeNull();
  });

  it("captions can be changed and cleared", async () => {
    const id = added[0]!;
    const r = await admin(`/venue-photos/${id}`, { method: "PATCH", body: { caption: "Sims at night" } });
    expect(r.status).toBe(200);
    expect(r.json.photo.caption).toBe("Sims at night");
    expect((await admin(`/venue-photos/${id}`, { method: "PATCH", body: { caption: "" } })).json.photo.caption).toBeNull();
    expect((await admin(`/venue-photos/${crypto.randomUUID()}`, { method: "PATCH", body: { caption: "x" } })).status).toBe(404);
  });

  it("the order is saved only when every photo is listed once", async () => {
    const current = (await admin("/venue-photos")).json.photos as { id: string }[];
    const reversed = current.map((p) => p.id).reverse();
    const r = await admin("/venue-photos/order", { method: "PUT", body: { ids: reversed } });
    expect(r.status).toBe(200);
    expect((r.json.photos as { id: string }[]).map((p) => p.id)).toEqual(reversed);
    expect((await call(ctx, "/public/config")).json.photos.map((p: { url: string }) => p.url)).toEqual((r.json.photos as { url: string }[]).map((p) => p.url));

    expect((await admin("/venue-photos/order", { method: "PUT", body: { ids: reversed.slice(1) } })).status).toBe(409);
    expect((await admin("/venue-photos/order", { method: "PUT", body: { ids: [...reversed.slice(1), reversed[1]] } })).status).toBe(409);
  });

  it(`the website shows at most ${MAX_PHOTOS} photos`, async () => {
    const { count } = await ctx.db.from("venue_photos").select("id", { count: "exact", head: true });
    for (let i = count ?? 0; i < MAX_PHOTOS; i++) expect((await upload(PNG)).status).toBe(201);
    const r = await upload(PNG);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("too_many_photos");
  });

  it("removing a photo takes it off the website and deletes the file", async () => {
    const id = added[0]!;
    const { data: row } = await ctx.db.from("venue_photos").select("storage_path").eq("id", id).single();
    const url = ctx.db.storage.from(PHOTO_BUCKET).getPublicUrl(row!.storage_path).data.publicUrl;
    expect((await admin(`/venue-photos/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(await lastAudit("venue_photos", id)).toMatchObject({ action: "venue_photos.delete", reason: "Photo removed", actor_staff_id: owner.id });
    expect((await call(ctx, "/public/config")).json.photos.map((p: { url: string }) => p.url)).not.toContain(url);
    expect((await fetch(url)).status).not.toBe(200);
    expect((await admin(`/venue-photos/${id}`, { method: "DELETE" })).status).toBe(404);
  });
});
