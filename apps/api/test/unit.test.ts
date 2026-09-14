import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { loadEnv } from "../src/env.js";
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

describe("loadEnv", () => {
  it("rejects a short operator secret and applies defaults", () => {
    expect(() =>
      loadEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(30), OPERATOR_TOKEN_SECRET: "short" }),
    ).toThrow(/OPERATOR_TOKEN_SECRET/);
    const env = loadEnv({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "k".repeat(30),
      OPERATOR_TOKEN_SECRET: SECRET,
    });
    expect(env.OPERATOR_IDLE_SECONDS).toBe(300);
    expect(env.PIN_MAX_ATTEMPTS).toBe(5);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000", "http://localhost:3001"]);
  });
});
