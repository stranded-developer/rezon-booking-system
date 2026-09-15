import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ENV_KEYS, loadEnv } from "../src/env.js";
import { mapDbError } from "../src/errors.js";
import { requestIp } from "../src/lib/audit.js";
import { signOperatorToken, verifyOperatorToken } from "../src/lib/operator-token.js";
import { hashPin, verifyPin } from "../src/lib/pin.js";

const SECRET = "s".repeat(40);

describe("PIN hashing", () => {
  it("verifies the right PIN and rejects a wrong one", async () => {
    const stored = await hashPin("4821");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPin("1111")).not.toBe(await hashPin("1111"));
  });

  it("rejects malformed PINs and stored values", async () => {
    await expect(hashPin("123")).rejects.toThrow();
    await expect(hashPin("12a4")).rejects.toThrow();
    expect(await verifyPin("1234", "plaintext")).toBe(false);
  });
});

describe("operator tokens", () => {
  it("round-trips claims", async () => {
    const token = await signOperatorToken("staff-1", "device-1", SECRET, 300);
    expect(await verifyOperatorToken(token, SECRET)).toMatchObject({ sub: "staff-1", dev: "device-1", typ: "rg-operator" });
  });

  it("rejects expired, wrongly signed and tampered tokens", async () => {
    const past = Math.floor(Date.now() / 1000) - 1000;
    expect(await verifyOperatorToken(await signOperatorToken("s", "d", SECRET, 300, past), SECRET)).toBeNull();
    expect(await verifyOperatorToken(await signOperatorToken("s", "d", "x".repeat(40), 300), SECRET)).toBeNull();
    const token = await signOperatorToken("s", "d", SECRET, 300);
    const [h, p, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", dev: "d", typ: "rg-operator", iat: 1, exp: 9999999999 })).toString("base64url");
    expect(await verifyOperatorToken(`${h}.${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifyOperatorToken(`${h}.${p}`, SECRET)).toBeNull();
    expect(await verifyOperatorToken("garbage", SECRET)).toBeNull();
  });
});

describe("mapDbError", () => {
  it.each([
    [{ code: "23505", message: "dup" }, 409, "conflict"],
    [{ code: "23P01", message: "overlap" }, 409, "conflict"],
    [{ code: "23514", message: "Cannot remove the last active superadmin" }, 409, "conflict"],
    [{ code: "23514", message: "violates check constraint" }, 422, "validation_failed"],
    [{ code: "23001", message: "append-only" }, 409, "conflict"],
    [{ code: "XX000", message: "boom" }, 500, "internal"],
  ])("%o → %i %s", (input, status, code) => {
    const err = mapDbError(input);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
  });

  it("never leaks unknown database messages", () => {
    expect(mapDbError({ code: "42P01", message: 'relation "secret_table" does not exist' }).message).toBe("Database error");
  });
});

describe("requestIp", () => {
  const ipOf = async (headers: Record<string, string>) => {
    const app = new Hono();
    app.get("/", (c) => c.text(String(requestIp(c))));
    return (await app.request("/", { headers })).text();
  };

  it("takes the first valid forwarded address and ignores junk", async () => {
    expect(await ipOf({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toBe("203.0.113.7");
    expect(await ipOf({ "x-forwarded-for": "not-an-ip", "x-real-ip": "2001:db8::1" })).toBe("2001:db8::1");
    expect(await ipOf({})).toBe("null");
  });
});

describe("member QR tokens", () => {
  it("are derived per member and version, and only the matching hash shows a QR", async () => {
    const { memberQrToken, currentMemberQr } = await import("../src/lib/qr.js");
    const { hashQrToken } = await import("../src/services/lookup.js");
    const id = "11111111-1111-4111-8111-111111111111";
    const v1 = memberQrToken(SECRET, id, 1);
    expect(v1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(memberQrToken(SECRET, id, 1)).toBe(v1);
    expect(memberQrToken(SECRET, id, 2)).not.toBe(v1);
    expect(memberQrToken(SECRET, "22222222-2222-4222-8222-222222222222", 1)).not.toBe(v1);
    expect(memberQrToken(`${SECRET}x`, id, 1)).not.toBe(v1);
    expect(currentMemberQr(SECRET, { id, qr_version: 1, qr_token_hash: hashQrToken(v1) })).toBe(`rg:m:${v1}`);
    expect(currentMemberQr(SECRET, { id, qr_version: 2, qr_token_hash: hashQrToken(v1) })).toBeNull();
    expect(currentMemberQr(SECRET, { id, qr_version: 0, qr_token_hash: null })).toBeNull();
  });
});

describe("booking calendar invite", () => {
  it("escapes text and folds long lines", async () => {
    const { buildIcs } = await import("../src/lib/ics.js");
    const ics = buildIcs({
      uid: "abc@raceground",
      start: new Date("2030-02-16T01:00:00Z"),
      end: new Date("2030-02-16T02:00:00Z"),
      stamp: new Date("2030-02-11T00:00:00Z"),
      summary: "Raceground: Sim, Bay; A",
      description: "x".repeat(200),
      location: "Raceground",
    });
    expect(ics).toContain("SUMMARY:Raceground: Sim\\, Bay\\; A");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(ics.replace(/\r\n /g, "")).toContain(`DESCRIPTION:${"x".repeat(200)}`);
  });
});

describe("loadEnv", () => {
  it("rejects a short operator secret and applies defaults", () => {
    expect(() =>
      loadEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(30), OPERATOR_TOKEN_SECRET: "short" }),
    ).toThrow(/OPERATOR_TOKEN_SECRET/);
    const env = loadEnv({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "k".repeat(30),
      OPERATOR_TOKEN_SECRET: SECRET,
      QR_TOKEN_SECRET: SECRET,
    });
    expect(env.OPERATOR_IDLE_SECONDS).toBe(300);
    expect(env.BOOKING_SITE_URL).toBe("http://localhost:3000");
    expect(() =>
      loadEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(30), OPERATOR_TOKEN_SECRET: SECRET }),
    ).toThrow(/QR_TOKEN_SECRET/);
    expect(env.PIN_MAX_ATTEMPTS).toBe(5);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000", "http://localhost:3001"]);
  });
});

describe(".env.example", () => {
  it("lists every setting the API reads, so nothing is missed when deploying", () => {
    const example = readFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");
    const documented = new Set(
      example
        .split("\n")
        .map((line) => /^([A-Z_]+)=/.exec(line.trim())?.[1])
        .filter((name): name is string => name !== undefined),
    );
    const missing = ENV_KEYS.filter((key) => !documented.has(key));
    expect(missing, `add these to apps/api/.env.example: ${missing.join(", ")}`).toEqual([]);
  });
});
