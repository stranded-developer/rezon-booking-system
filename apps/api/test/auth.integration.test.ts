import pg from "pg";
import { decode } from "hono/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signOperatorToken } from "../src/lib/operator-token.js";
import {
  call,
  cleanupTestData,
  trackStaff,
  makeNonStaffUser,
  makeStaff,
  operatorToken,
  signIn,
  staffRow,
  testContext,
  uniqueEmail,
  PASSWORD,
  type TestContext,
  type TestStaff,
} from "./helpers.js";

let ctx: TestContext;
let owner: TestStaff;
let cashier: TestStaff;

beforeAll(async () => {
  ctx = testContext();
  owner = await makeStaff(ctx, "superadmin", "2468", "owner");
  cashier = await makeStaff(ctx, "cashier", "1357", "cashier");
});

afterAll(async () => {
  await cleanupTestData(ctx);
});

describe("health", () => {
  it("responds without auth", async () => {
    const res = await call(ctx, "/health");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
  });
});

describe("device session (Supabase JWT)", () => {
  it("rejects a missing token", async () => {
    const res = await call(ctx, "/pos/staff");
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("unauthenticated");
  });

  it("rejects a garbage or tampered token", async () => {
    expect((await call(ctx, "/pos/staff", { jwt: "not.a.jwt" })).status).toBe(401);
    const [h, , s] = cashier.jwt.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: owner.id, role: "authenticated", exp: 9999999999 })).toString("base64url");
    expect((await call(ctx, "/pos/staff", { jwt: `${h}.${forged}.${s}` })).status).toBe(401);
  });

  it("rejects a signed-in user who is not staff", async () => {
    const jwt = await makeNonStaffUser(ctx);
    const res = await call(ctx, "/pos/staff", { jwt });
    expect(res.status).toBe(403);
  });

  it("lists active staff for the lock screen without secrets", async () => {
    const res = await call(ctx, "/pos/staff", { jwt: cashier.jwt });
    expect(res.status).toBe(200);
    const ids = res.json.staff.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([owner.id, cashier.id]));
    const serialized = JSON.stringify(res.json);
    expect(serialized).not.toContain("pin_hash");
    expect(serialized).not.toContain("scrypt$");
  });
});

describe("POS operator PIN", () => {
  it("issues an operator token for the correct PIN and audits the sign-in", async () => {
    const res = await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: owner.id, pin: owner.pin } });
    expect(res.status).toBe(200);
    expect(res.json.operator).toEqual({ id: owner.id, displayName: "Test owner", role: "superadmin" });
    expect(res.json.expiresInSeconds).toBe(300);
    expect(res.headers.get("X-Operator-Token")).toBe(res.json.token);

    const { data } = await ctx.db
      .from("audit_log")
      .select("action, actor_staff_id, entity_id")
      .eq("action", "pos.operator_signin")
      .eq("entity_id", owner.id);
    expect(data?.length).toBeGreaterThan(0);
  });

  it("rejects malformed input with 422", async () => {
    const res = await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: owner.id, pin: "12a4" } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("validation_failed");
  });

  it("answers an unknown staff id exactly like a wrong PIN", async () => {
    const res = await call(ctx, "/pos/operator", {
      jwt: cashier.jwt,
      body: { staffId: "00000000-0000-4000-8000-000000000000", pin: "1234" },
    });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("pin_invalid");
  });

  it("counts wrong PINs, locks on the 5th, refuses the right PIN while locked, and audits the lock", async () => {
    const victim = await makeStaff(ctx, "cashier", "9999", "lockout");
    for (let i = 1; i <= 4; i++) {
      const res = await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: victim.id, pin: "0000" } });
      expect(res.status).toBe(401);
      expect(res.json.error.details.attemptsRemaining).toBe(5 - i);
    }
    const fifth = await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: victim.id, pin: "0000" } });
    expect(fifth.status).toBe(423);
    expect(fifth.json.error.code).toBe("pin_locked");

    const correctWhileLocked = await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: victim.id, pin: "9999" } });
    expect(correctWhileLocked.status).toBe(423);

    const row = await staffRow(ctx.db, victim.id);
    expect(new Date(row.pin_locked_until!).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    const { data: audit } = await ctx.db.from("audit_log").select("action").eq("entity_id", victim.id).eq("action", "staff.pin_locked");
    expect(audit).toHaveLength(1);

    // Lock expires → correct PIN works and the counter resets.
    await ctx.db.from("staff").update({ pin_locked_until: new Date(Date.now() - 1000).toISOString() }).eq("id", victim.id);
    const after = await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: victim.id, pin: "9999" } });
    expect(after.status).toBe(200);
    const reset = await staffRow(ctx.db, victim.id);
    expect(reset.pin_failed_count).toBe(0);
    expect(reset.pin_locked_until).toBeNull();
  });

  it("a correct PIN is refused if the account gets locked while the PIN is being checked", async () => {
    const victim = await makeStaff(ctx, "cashier", "7777", "race");
    const client = new pg.Client({ connectionString: ctx.supabase.dbUrl });
    await client.connect();
    try {
      // Hold the staff row lock so register_pin_attempt must wait after the API's unlocked pre-check.
      await client.query("begin");
      await client.query("select 1 from staff where id = $1 for update", [victim.id]);
      const pending = call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: victim.id, pin: "7777" } });
      // Wait until the API's RPC is actually blocked on our lock.
      for (let i = 0; i < 100; i++) {
        const { rows } = await client.query(
          "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%register_pin_attempt%'",
        );
        if (rows[0].n > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await client.query("update staff set pin_locked_until = now() + interval '5 minutes' where id = $1", [victim.id]);
      await client.query("commit");
      const res = await pending;
      expect(res.status).toBe(423);
      expect(res.json.error.code).toBe("pin_locked");
    } finally {
      await client.end();
    }
  });

  it("12 simultaneous wrong guesses get exactly 4 'incorrect' answers before the lock", async () => {
    // All guesses are wrong on purpose: a correct PIN in the batch would legitimately reset the counter.
    const victim = await makeStaff(ctx, "cashier", "5555", "parallel");
    const guesses = Array.from({ length: 12 }, (_, i) => String(i).padStart(4, "0"));
    const results = await Promise.all(
      guesses.map((pin) => call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: victim.id, pin } })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
    expect(statuses.filter((s) => s === 423)).toHaveLength(8);
    const row = await staffRow(ctx.db, victim.id);
    expect(row.pin_locked_until).not.toBeNull();
    const { data: audit } = await ctx.db.from("audit_log").select("id").eq("entity_id", victim.id).eq("action", "staff.pin_locked");
    expect(audit).toHaveLength(1);
  });
});

describe("operator token enforcement", () => {
  it("requires an operator token", async () => {
    const res = await call(ctx, "/pos/me", { jwt: cashier.jwt });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("operator_required");
  });

  it("accepts a valid token and slides its expiry forward", async () => {
    const now = Math.floor(Date.now() / 1000);
    // A token issued 200 s ago has 100 s left.
    const aging = await signOperatorToken(cashier.id, await deviceUserId(cashier), ctx.env.OPERATOR_TOKEN_SECRET, 300, now - 200);
    const res = await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: aging });
    expect(res.status).toBe(200);
    expect(res.json.operator.id).toBe(cashier.id);
    const renewed = res.headers.get("X-Operator-Token");
    expect(renewed).toBeTruthy();
    const exp = decode(renewed!).payload.exp as number;
    expect(exp).toBeGreaterThanOrEqual(now + 299);
    const again = await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: renewed! });
    expect(again.status).toBe(200);
  });

  it("passive background requests are authorised but do not extend an idle operator", async () => {
    const token = await operatorToken(ctx, cashier);
    const res = await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: token, headers: { "X-Operator-Passive": "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Operator-Token")).toBeNull();
  });

  it("rejects an expired token (idle lock)", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    const token = await signOperatorToken(cashier.id, (await deviceUserId(cashier)), ctx.env.OPERATOR_TOKEN_SECRET, 300, past);
    const res = await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: token });
    expect(res.status).toBe(401);
  });

  it("rejects a token issued for a different device session", async () => {
    const token = await operatorToken(ctx, owner, cashier); // issued on the owner's device
    const res = await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: token });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signOperatorToken(owner.id, await deviceUserId(cashier), "z".repeat(48), 300);
    const res = await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: token });
    expect(res.status).toBe(401);
  });

  it("cuts off a deactivated operator immediately, even with a live token", async () => {
    const temp = await makeStaff(ctx, "cashier", "2222", "deactivated");
    const token = await operatorToken(ctx, cashier, temp);
    expect((await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: token })).status).toBe(200);
    await ctx.db.from("staff").update({ active: false }).eq("id", temp.id);
    expect((await call(ctx, "/pos/me", { jwt: cashier.jwt, operatorToken: token })).status).toBe(403);
    // …and a deactivated account's own device session is refused too.
    expect((await call(ctx, "/pos/staff", { jwt: temp.jwt })).status).toBe(403);
  });
});

describe("superadmin routes", () => {
  it("refuse a cashier operator", async () => {
    const token = await operatorToken(ctx, cashier);
    for (const [method, path, body] of [
      ["GET", "/admin/staff", undefined],
      ["POST", "/admin/staff", { email: uniqueEmail("x"), password: PASSWORD, displayName: "X", role: "cashier", pin: "1111" }],
      ["PATCH", `/admin/staff/${cashier.id}`, { role: "superadmin" }],
      ["GET", "/admin/audit", undefined],
    ] as const) {
      const res = await call(ctx, path, { method, jwt: cashier.jwt, operatorToken: token, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect((await staffRow(ctx.db, cashier.id)).role).toBe("cashier");
  });

  it("refuse a superadmin device session without a PIN-verified superadmin operator", async () => {
    const cashierOnOwnerDevice = await operatorToken(ctx, owner, cashier);
    expect((await call(ctx, "/admin/staff", { jwt: owner.jwt })).status).toBe(401);
    expect((await call(ctx, "/admin/staff", { jwt: owner.jwt, operatorToken: cashierOnOwnerDevice })).status).toBe(403);
  });

  it("create a cashier who can then sign in and use their PIN; audited without secrets", async () => {
    const token = await operatorToken(ctx, owner);
    const email = uniqueEmail("newcashier");
    const res = await call(ctx, "/admin/staff", {
      jwt: owner.jwt,
      operatorToken: token,
      body: { email, password: PASSWORD, displayName: "New Cashier", role: "cashier", pin: "8642" },
    });
    expect(res.status).toBe(201);
    expect(res.json.staff).toMatchObject({ display_name: "New Cashier", role: "cashier", active: true, email });
    trackStaff(res.json.staff.id);
    expect(JSON.stringify(res.json)).not.toMatch(/pin|scrypt/);

    const newJwt = await signIn(ctx, email);
    const pinRes = await call(ctx, "/pos/operator", { jwt: newJwt, body: { staffId: res.json.staff.id, pin: "8642" } });
    expect(pinRes.status).toBe(200);

    const { data: audit } = await ctx.db
      .from("audit_log")
      .select("action, actor_staff_id, after")
      .eq("entity_id", res.json.staff.id)
      .eq("action", "staff.create")
      .single();
    expect(audit?.actor_staff_id).toBe(owner.id);
    expect(JSON.stringify(audit?.after)).not.toMatch(/pin|scrypt/);
  });

  it("reject duplicate emails and invalid bodies", async () => {
    const token = await operatorToken(ctx, owner);
    const dup = await call(ctx, "/admin/staff", {
      jwt: owner.jwt,
      operatorToken: token,
      body: { email: cashier.email, password: PASSWORD, displayName: "Dup", role: "cashier", pin: "1111" },
    });
    expect(dup.status).toBe(409);
    const bad = await call(ctx, "/admin/staff", {
      jwt: owner.jwt,
      operatorToken: token,
      body: { email: "not-an-email", password: "short", displayName: "", role: "manager", pin: "12345" },
    });
    expect(bad.status).toBe(422);
    const paths = bad.json.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(["displayName", "email", "password", "pin", "role"]);
  });

  it("update a staff member with before/after audit, and a PIN reset clears a lockout", async () => {
    const target = await makeStaff(ctx, "cashier", "3333", "update");
    await ctx.db.from("staff").update({ pin_locked_until: new Date(Date.now() + 60_000).toISOString(), pin_failed_count: 3 }).eq("id", target.id);
    const token = await operatorToken(ctx, owner);
    const res = await call(ctx, `/admin/staff/${target.id}`, {
      method: "PATCH",
      jwt: owner.jwt,
      operatorToken: token,
      body: { displayName: "Renamed", pin: "4444", reason: "forgot PIN" },
    });
    expect(res.status).toBe(200);
    expect(res.json.staff.display_name).toBe("Renamed");

    const row = await staffRow(ctx.db, target.id);
    expect(row.pin_locked_until).toBeNull();
    expect(row.pin_failed_count).toBe(0);
    expect((await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: target.id, pin: "4444" } })).status).toBe(200);
    expect((await call(ctx, "/pos/operator", { jwt: cashier.jwt, body: { staffId: target.id, pin: "3333" } })).status).toBe(401);

    const { data: audit } = await ctx.db
      .from("audit_log")
      .select("action, before, after, reason, actor_staff_id")
      .eq("entity_id", target.id)
      .eq("action", "staff.update_with_pin_reset")
      .single();
    expect(audit).toMatchObject({
      reason: "forgot PIN",
      actor_staff_id: owner.id,
      before: { display_name: "Test update" },
      after: { display_name: "Renamed" },
    });
    expect(JSON.stringify(audit)).not.toContain("scrypt$");
  });

  it("return 404 for an unknown staff id and 422 for an empty update", async () => {
    const token = await operatorToken(ctx, owner);
    expect(
      (await call(ctx, "/admin/staff/00000000-0000-4000-8000-000000000000", { method: "PATCH", jwt: owner.jwt, operatorToken: token, body: { active: false } }))
        .status,
    ).toBe(404);
    expect((await call(ctx, `/admin/staff/${cashier.id}`, { method: "PATCH", jwt: owner.jwt, operatorToken: token, body: {} })).status).toBe(422);
  });

  it("list the audit log newest first with a cursor", async () => {
    const token = await operatorToken(ctx, owner);
    const first = await call(ctx, "/admin/audit?limit=2", { jwt: owner.jwt, operatorToken: token });
    expect(first.status).toBe(200);
    expect(first.json.entries).toHaveLength(2);
    expect(first.json.entries[0].id).toBeGreaterThan(first.json.entries[1].id);
    const next = await call(ctx, `/admin/audit?limit=2&before=${first.json.nextBefore}`, { jwt: owner.jwt, operatorToken: token });
    expect(next.json.entries[0].id).toBeLessThan(first.json.entries[1].id);
  });
});

describe("unknown routes", () => {
  it("return a JSON 404", async () => {
    const res = await call(ctx, "/nope");
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("not_found");
  });
});

async function deviceUserId(staff: TestStaff): Promise<string> {
  return (await staffRow(ctx.db, staff.id)).auth_user_id;
}
