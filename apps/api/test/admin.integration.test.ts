/**
 * Back office API against local Supabase. Every write is checked for its audit row (actor + reason).
 * Config that other tests rely on (settings, opening hours) is restored afterwards.
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
let originalSettings: Record<string, unknown>;
let originalHours: { day_of_week: number; open_time: string; close_time: string; closed: boolean }[];
let originalTiers: { id: string; name: string; discount_bp: number; monthly_price_cents: number; monthly_free_minutes: number; max_balance_minutes: number; active: boolean }[];
const createdResourceTypes: string[] = [];

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
  owner = await makeStaff(ctx, "superadmin", "2468", "admin-owner");
  cashier = await makeStaff(ctx, "cashier", "1357", "admin-cashier");
  ownerOp = await operatorToken(ctx, owner);
  cashierOp = await operatorToken(ctx, owner, cashier);
  await finishOpenWork(ctx, owner.id);
  originalSettings = (await ctx.db.from("venue_settings").select("*").eq("id", 1).single()).data!;
  originalHours = (await ctx.db.from("opening_hours").select("*").order("day_of_week")).data!;
  originalTiers = (await ctx.db.from("membership_tiers").select("id, name, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes, active")).data!;
});

afterAll(async () => {
  ctx.clock.real();
  await finishOpenWork(ctx, owner.id);
  await ctx.db
    .from("venue_settings")
    .update({ business_name: originalSettings.business_name as string | null, abn: originalSettings.abn as string | null, no_show_hold_minutes: originalSettings.no_show_hold_minutes as number })
    .eq("id", 1);
  await ctx.db.from("opening_hours").upsert(originalHours, { onConflict: "day_of_week" });
  for (const t of originalTiers) {
    const { id, ...values } = t;
    await ctx.db.from("membership_tiers").update(values).eq("id", id);
  }
  if (createdResourceTypes.length) {
    await ctx.db.from("happy_hours").update({ active: false }).overlaps("resource_type_ids", createdResourceTypes);
    await ctx.db.from("rate_bands").update({ active: false }).in("resource_type_id", createdResourceTypes);
    await ctx.db.from("resources").update({ active: false }).in("resource_type_id", createdResourceTypes);
    await ctx.db.from("resource_types").update({ active: false }).in("id", createdResourceTypes);
  }
  await cleanupTestData(ctx);
});

describe("permissions", () => {
  it("cashiers are refused on every back office area", async () => {
    for (const path of ["/settings", "/opening-hours", "/resource-types", "/rate-bands", "/happy-hours", "/tiers", "/members", "/referral-codes", "/sales", "/shifts"]) {
      expect((await admin(path, { as: "cashier" })).status, path).toBe(403);
    }
  });
});

describe("settings and opening hours", () => {
  it("updates business details with the ABN normalised, and audits actor and reason", async () => {
    const r = await admin("/settings", { method: "PATCH", body: { businessName: "Raceground Pty Ltd", abn: "12 345 678 901", noShowHoldMinutes: 20, reason: "Registered business" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.settings).toMatchObject({ business_name: "Raceground Pty Ltd", abn: "12345678901", no_show_hold_minutes: 20 });
    const audit = await lastAudit("venue_settings", "1");
    expect(audit).toMatchObject({ actor_staff_id: owner.id, action: "venue_settings.update", reason: "Registered business" });
    expect((audit!.before as { no_show_hold_minutes: number }).no_show_hold_minutes).toBe(originalSettings.no_show_hold_minutes);
  });

  it("rejects an invalid ABN and an empty update", async () => {
    expect((await admin("/settings", { method: "PATCH", body: { abn: "1234" } })).status).toBe(422);
    expect((await admin("/settings", { method: "PATCH", body: { reason: "nothing" } })).status).toBe(422);
  });

  it("replaces opening hours for the week and audits each changed day", async () => {
    // Start from the launch hours so "unchanged" is well defined, then note the audit position.
    await ctx.db.from("opening_hours").upsert([1, 2, 3, 4, 5, 6, 7].map((d) => ({ day_of_week: d, open_time: "10:00", close_time: "21:00", closed: false })), { onConflict: "day_of_week" });
    const { data: mark } = await ctx.db.from("audit_log").select("id").order("id", { ascending: false }).limit(1).single();
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, openTime: "10:00", closeTime: d >= 5 ? "23:00" : "21:00", closed: false }));
    const r = await admin("/opening-hours", { method: "PUT", body: { days, reason: "Late nights Fri–Sun" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.days.map((d: { close_time: string }) => d.close_time)).toEqual(["21:00", "21:00", "21:00", "21:00", "23:00", "23:00", "23:00"]);
    const audit = await lastAudit("opening_hours", "6");
    expect(audit).toMatchObject({ actor_staff_id: owner.id, reason: "Late nights Fri–Sun" });
    const { data: newRows } = await ctx.db.from("audit_log").select("entity_id").eq("entity", "opening_hours").gt("id", mark!.id);
    expect(newRows!.map((row) => row.entity_id).sort()).toEqual(["5", "6", "7"]); // unchanged days → no audit rows
  });

  it("rejects closing before opening, duplicate days and a missing day", async () => {
    const base = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, openTime: "10:00", closeTime: "21:00", closed: false }));
    expect((await admin("/opening-hours", { method: "PUT", body: { days: base.map((d) => (d.dayOfWeek === 3 ? { ...d, closeTime: "09:00" } : d)) } })).status).toBe(422);
    expect((await admin("/opening-hours", { method: "PUT", body: { days: base.map((d) => ({ ...d, dayOfWeek: 1 })) } })).status).toBe(422);
    expect((await admin("/opening-hours", { method: "PUT", body: { days: base.slice(0, 6) } })).status).toBe(422);
  });
});

describe("resources, rates and happy hours", () => {
  let typeId: string;
  let resourceId: string;
  let bandId: string;

  it("adds a resource type and a resource as configuration", async () => {
    const t = await admin("/resource-types", { body: { key: `karts_${run}`, name: `Karts ${run}`, baseRateCents: 4500, minMinutes: 20, reason: "New attraction" } });
    expect(t.status, JSON.stringify(t.json)).toBe(201);
    typeId = t.json.resourceType.id;
    createdResourceTypes.push(typeId);
    expect(await lastAudit("resource_types", typeId)).toMatchObject({ action: "resource_types.insert", actor_staff_id: owner.id, reason: "New attraction" });

    const r = await admin("/resources", { body: { resourceTypeId: typeId, label: "Kart 1" } });
    expect(r.status).toBe(201);
    resourceId = r.json.resource.id;
    const dup = await admin("/resources", { body: { resourceTypeId: typeId, label: "Kart 1" } });
    expect(dup.status).toBe(409);
    const badType = await admin("/resources", { body: { resourceTypeId: randomUUID(), label: "Ghost" } });
    expect(badType.status).toBe(422);
  });

  it("changes a base rate with before/after in the audit log", async () => {
    const r = await admin(`/resource-types/${typeId}`, { method: "PATCH", body: { baseRateCents: 5000, reason: "Price review" } });
    expect(r.status).toBe(200);
    const audit = await lastAudit("resource_types", typeId);
    expect((audit!.before as { base_rate_cents: number }).base_rate_cents).toBe(4500);
    expect((audit!.after as { base_rate_cents: number }).base_rate_cents).toBe(5000);
  });

  it("won't deactivate a resource while it's in use", async () => {
    await admin("/opening-hours", { method: "PUT", body: { days: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, openTime: "00:00", closeTime: "24:00", closed: false })) } });
    const { data: session, error } = await ctx.db.rpc("pos_open_walk_in", { p_resource: resourceId, p_staff: owner.id });
    expect(error).toBeNull();
    const refused = await admin(`/resources/${resourceId}`, { method: "PATCH", body: { active: false } });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("resource_in_use");
    await ctx.db.rpc("pos_void_session", { p_session: session!.id, p_staff: owner.id, p_reason: "test" });
    expect((await admin(`/resources/${resourceId}`, { method: "PATCH", body: { active: false, reason: "Maintenance" } })).status).toBe(200);
  });

  it("adds a weekend rate band and refuses an overlapping one", async () => {
    const r = await admin("/rate-bands", { body: { resourceTypeId: typeId, daysOfWeek: [6, 7], startTime: "10:00", endTime: "21:00", rateCents: 6000, reason: "Weekend pricing" } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    bandId = r.json.rateBand.id;
    const overlap = await admin("/rate-bands", { body: { resourceTypeId: typeId, daysOfWeek: [7], startTime: "20:00", endTime: "22:00", rateCents: 7000 } });
    expect(overlap.status).toBe(422);
    expect(overlap.json.error.message).toContain("Overlaps");
    const otherDay = await admin("/rate-bands", { body: { resourceTypeId: typeId, daysOfWeek: [5], startTime: "20:00", endTime: "22:00", rateCents: 7000 } });
    expect(otherDay.status).toBe(201);
    expect((await admin("/rate-bands", { body: { resourceTypeId: typeId, daysOfWeek: [1], startTime: "12:00", endTime: "11:00", rateCents: 1 } })).status).toBe(422);
  });

  it("editing a band into an overlap is refused; deactivating then allows the other shape", async () => {
    const { data: bands } = await ctx.db.from("rate_bands").select("id, days_of_week").eq("resource_type_id", typeId);
    const friday = bands!.find((b) => b.days_of_week.includes(5))!.id;
    expect((await admin(`/rate-bands/${friday}`, { method: "PATCH", body: { daysOfWeek: [5, 6] } })).status).toBe(422);
    expect((await admin(`/rate-bands/${bandId}`, { method: "PATCH", body: { active: false } })).status).toBe(200);
    expect((await admin(`/rate-bands/${friday}`, { method: "PATCH", body: { daysOfWeek: [5, 6], reason: "Extend" } })).status).toBe(200);
    const del = await admin(`/rate-bands/${bandId}?reason=${encodeURIComponent("Replaced")}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await lastAudit("rate_bands", bandId)).toMatchObject({ action: "rate_bands.delete", reason: "Replaced", after: null });
  });

  it("adds a weekend happy hour for the new type but refuses one overlapping the weekday happy hour", async () => {
    const ok = await admin("/happy-hours", {
      body: { name: `Sunday session ${run}`, resourceTypeIds: [typeId], daysOfWeek: [7], startTime: "10:00", endTime: "12:00", discountBp: 2000 },
    });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const clash = await admin("/happy-hours", {
      body: { name: "Clash", resourceTypeIds: [typeId], daysOfWeek: [3], startTime: "11:00", endTime: "12:00", discountBp: 1500 },
    });
    expect(clash.status).toBe(422);
    expect(clash.json.error.message).toContain("Overlaps happy hour");
    expect((await admin("/happy-hours", { body: { name: "Too much", resourceTypeIds: null, daysOfWeek: [7], startTime: "22:00", endTime: "23:00", discountBp: 10000 } })).status).toBe(422);
  });
});

describe("tiers", () => {
  it("lists tiers with member counts and edits benefits with validation", async () => {
    const list = await admin("/tiers");
    expect(list.status).toBe(200);
    const silver = list.json.tiers.find((t: { name: string }) => t.name === "Silver");
    expect(silver).toHaveProperty("activeMembers");
    const r = await admin(`/tiers/${silver.id}`, { method: "PATCH", body: { monthlyFreeMinutes: 90, reason: "Promo" } });
    expect(r.status).toBe(200);
    expect(r.json.tier.monthly_free_minutes).toBe(90);
    expect((await admin(`/tiers/${silver.id}`, { method: "PATCH", body: { discountBp: 10000 } })).status).toBe(422);
  });

  it("changes a monthly price with history and flags Stripe sync as pending", async () => {
    const list = await admin("/tiers");
    const gold = list.json.tiers.find((t: { name: string }) => t.name === "Gold");
    const r = await admin(`/tiers/${gold.id}/price`, { body: { amountCents: gold.monthly_price_cents + 500, reason: "Annual review" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ stripeSyncPending: true, tier: { monthly_price_cents: gold.monthly_price_cents + 500 } });
    expect(await lastAudit("membership_tiers", gold.id)).toMatchObject({ actor_staff_id: owner.id });
    expect((await admin(`/tiers/${gold.id}/price`, { body: { amountCents: gold.monthly_price_cents + 500 } })).status).toBe(422);
  });
});

describe("members", () => {
  let memberId: string;
  let firstCard: string;

  it("creates a complimentary member whose card works at the POS", async () => {
    const tiers = (await admin("/tiers")).json.tiers;
    const r = await admin("/members", {
      body: { name: `Comp ${run}`, email: `comp-${run}@raceground.test`, tierId: tiers.find((t: { name: string }) => t.name === "Diamond").id, reason: "Staff perk" },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    memberId = r.json.member.id;
    firstCard = r.json.card.qr;
    expect(firstCard).toMatch(/^rg:m:[A-Za-z0-9_-]{43}$/);
    expect(r.json.member).toMatchObject({ tierName: "Diamond", status: "active", eligible: true, balanceMinutes: 0 });

    const scan = await call(ctx, "/pos/members/scan", { jwt: owner.jwt, operatorToken: ownerOp, body: { code: firstCard } });
    expect(scan.status).toBe(200);
    expect(scan.json.member.id).toBe(memberId);

    expect((await admin("/members", { body: { name: "No contact", tierId: tiers[0].id, reason: "x x x" } })).status).toBe(422);
  });

  it("adjusts the balance with a reason and shows it in the ledger", async () => {
    expect((await admin(`/members/${memberId}/balance`, { body: { deltaMinutes: 120, reason: "Birthday" } })).json.balanceMinutes).toBe(120);
    expect((await admin(`/members/${memberId}/balance`, { body: { deltaMinutes: -30, reason: "Correction" } })).json.balanceMinutes).toBe(90);
    const over = await admin(`/members/${memberId}/balance`, { body: { deltaMinutes: -91, reason: "Too much" } });
    expect(over.status).toBe(422);
    expect(over.json.error.code).toBe("insufficient_balance");
    expect((await admin(`/members/${memberId}/balance`, { body: { deltaMinutes: 10, reason: "" } })).status).toBe(422);

    const detail = await admin(`/members/${memberId}`);
    expect(detail.json.member).toMatchObject({ balanceMinutes: 90, billing: "complimentary" });
    expect(detail.json.ledger.map((l: { delta_minutes: number; actor: string }) => [l.delta_minutes, l.actor])).toEqual([
      [-30, "Test admin-owner"],
      [120, "Test admin-owner"],
    ]);
  });

  it("reissues the card: the old one stops working, the new one works", async () => {
    const r = await admin(`/members/${memberId}/card`, { body: { reason: "Lost phone" } });
    expect(r.status).toBe(200);
    expect(r.json.card.qr).not.toBe(firstCard);
    const old = await call(ctx, "/pos/members/scan", { jwt: owner.jwt, operatorToken: ownerOp, body: { code: firstCard } });
    expect(old.status).toBe(404);
    const fresh = await call(ctx, "/pos/members/scan", { jwt: owner.jwt, operatorToken: ownerOp, body: { code: r.json.card.qr } });
    expect(fresh.status).toBe(200);
  });

  it("searches members by name", async () => {
    const r = await admin(`/members?q=${encodeURIComponent(`Comp ${run}`)}`);
    expect(r.json.members.map((m: { id: string }) => m.id)).toEqual([memberId]);
  });
});

describe("referral codes", () => {
  let codeId: string;

  it("generates a batch of unique codes with limits and expiry", async () => {
    const r = await admin("/referral-codes", { body: { type: "fixed", value: 1000, maxUses: 10, validUntil: "2031-12-31T12:59:59Z", count: 5, reason: "Launch flyer" } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const codes = r.json.codes as { id: string; code: string; max_uses: number; created_by: string }[];
    expect(codes).toHaveLength(5);
    expect(new Set(codes.map((c) => c.code)).size).toBe(5);
    codes.forEach((c) => expect(c.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/));
    expect(codes[0]!.created_by).toBe(owner.id);
    codeId = codes[0]!.id;
    expect(await lastAudit("referral_codes", codeId)).toMatchObject({ action: "referral_codes.insert", reason: "Launch flyer" });
  });

  it("validates values", async () => {
    expect((await admin("/referral-codes", { body: { type: "percent", value: 10000, maxUses: 1 } })).status).toBe(422);
    expect((await admin("/referral-codes", { body: { type: "fixed", value: 0, maxUses: 1 } })).status).toBe(422);
    expect((await admin("/referral-codes", { body: { type: "fixed", value: 100, maxUses: 1, count: 101 } })).status).toBe(422);
  });

  it("won't lower max uses below uses already made; deactivation is audited", async () => {
    await ctx.db.from("referral_codes").update({ uses_count: 3 }).eq("id", codeId);
    const lower = await admin(`/referral-codes/${codeId}`, { method: "PATCH", body: { maxUses: 2 } });
    expect(lower.status).toBe(422);
    expect(lower.json.error.message).toContain("uses already made");
    const off = await admin(`/referral-codes/${codeId}`, { method: "PATCH", body: { active: false, reason: "Flyer withdrawn" } });
    expect(off.status).toBe(200);
    expect(await lastAudit("referral_codes", codeId)).toMatchObject({ action: "referral_codes.update", reason: "Flyer withdrawn" });
    const list = await admin("/referral-codes?include=all");
    expect(list.json.codes.find((c: { id: string }) => c.id === codeId)).toMatchObject({ usable: false, uses_count: 3 });
  });
});

describe("sales, refunds and shifts", () => {
  let sessionId: string;
  let paymentId: string;

  it("lists a day's sales with payment details", async () => {
    await admin("/opening-hours", { method: "PUT", body: { days: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, openTime: "00:00", closeTime: "24:00", closed: false })) } });
    const { data: table } = await ctx.db.from("resources").insert({ resource_type_id: createdResourceTypes[0]!, label: `Sale ${run}` }).select("id").single();
    await ctx.db.from("resource_types").update({ active: true }).eq("id", createdResourceTypes[0]!);
    const pos = (path: string, body?: unknown) => call(ctx, `/pos${path}`, { jwt: owner.jwt, operatorToken: ownerOp, ...(body !== undefined ? { body } : {}) });

    expect((await pos("/shifts/open", { openingFloatCents: 10_000 })).status).toBe(201);
    ctx.clock.set("2030-02-01T12:00:00+11:00");
    const open = await pos("/sessions", { resourceId: table!.id });
    expect(open.status, JSON.stringify(open.json)).toBe(201);
    sessionId = open.json.session.id;
    ctx.clock.set("2030-02-01T13:00:00+11:00");
    const q = await pos(`/sessions/${sessionId}/quote`, {});
    const close = await pos(`/sessions/${sessionId}/close`, { closedAt: q.json.quote.closedAt, tender: { method: "cash", tenderedCents: q.json.quote.totalCents } });
    expect(close.status, JSON.stringify(close.json)).toBe(200);

    const sales = await admin("/sales?date=2030-02-01");
    expect(sales.status).toBe(200);
    const sale = sales.json.sales.find((s: { sessionId: string }) => s.sessionId === sessionId);
    expect(sale).toMatchObject({ status: "closed", resource: `Sale ${run}`, totalCents: q.json.quote.totalCents, closedBy: "Test admin-owner", payment: { method: "cash", refundedCents: 0 } });
    paymentId = sale.payment.id;
    expect((await admin("/sales?date=2030-02-02")).json.sales.find((s: { sessionId: string }) => s.sessionId === sessionId)).toBeUndefined();
  });

  it("refunds part of a payment, refuses too much, then voids the rest", async () => {
    const r = await admin(`/payments/${paymentId}/refund`, { body: { amountCents: 1000, reason: "Controller fault" } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const tooMuch = await admin(`/payments/${paymentId}/refund`, { body: { amountCents: 1_000_000, reason: "Oops" } });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.json.error.code).toBe("refund_exceeds_payment");

    const voided = await admin(`/sales/${sessionId}/void`, { body: { reason: "Customer complaint" } });
    expect(voided.status).toBe(200);
    const sale = (await admin("/sales?date=2030-02-01")).json.sales.find((s: { sessionId: string }) => s.sessionId === sessionId);
    expect(sale.status).toBe("voided");
    expect(sale.payment.refundedCents).toBe(sale.payment.amountCents);
  });

  it("lists shifts and filters flagged ones", async () => {
    ctx.clock.real();
    const current = await call(ctx, "/pos/shifts/current", { jwt: owner.jwt, operatorToken: ownerOp });
    const expected = current.json.shift.cash.expectedCents;
    const closed = await call(ctx, "/pos/shifts/current/close", { jwt: owner.jwt, operatorToken: ownerOp, body: { countedCashCents: expected + 5000, terminalCardTotalCents: 0 } });
    expect(closed.status).toBe(200);
    const list = await admin("/shifts?limit=5");
    expect(list.json.shifts[0]).toMatchObject({ id: closed.json.report.shift.id, flagged: true, cash_variance_cents: 5000, opener: "Test admin-owner" });
    const flagged = await admin("/shifts?flagged=true&limit=100");
    expect(flagged.json.shifts.every((s: { flagged: boolean }) => s.flagged)).toBe(true);
  });
});

describe("audit viewer", () => {
  it("shows actor names and filters by entity", async () => {
    const r = await admin("/audit?entity=referral_codes&limit=5");
    expect(r.status).toBe(200);
    expect(r.json.entries.length).toBeGreaterThan(0);
    expect(r.json.entries.every((e: { entity: string }) => e.entity === "referral_codes")).toBe(true);
    expect(r.json.entries[0].actor).toBe("Test admin-owner");
  });
});
