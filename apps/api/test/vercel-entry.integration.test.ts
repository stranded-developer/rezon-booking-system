/**
 * The Vercel entry point (apps/api/api/index.ts) and the way Vercel Cron calls the scheduled jobs:
 * a GET with the CRON_SECRET bearer token that Vercel adds itself.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, inject } from "vitest";
import { createAppFromEnv } from "../src/bootstrap.js";
import handler from "../api/index.js";

const CRON_SECRET = `vercel-entry-${randomBytes(16).toString("hex")}`;

beforeAll(() => {
  const supabase = inject("supabase");
  // The deployed function reads its settings from the environment, exactly like this.
  process.env.SUPABASE_URL = supabase.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = supabase.secretKey;
  process.env.OPERATOR_TOKEN_SECRET = randomBytes(32).toString("hex");
  process.env.QR_TOKEN_SECRET = randomBytes(32).toString("hex");
  process.env.CRON_SECRET = CRON_SECRET;
});

describe("the function Vercel runs", () => {
  it("answers a request built from the environment", async () => {
    const res = await handler(new Request("https://api.example/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("routes unknown paths like the local server does", async () => {
    const res = await handler(new Request("https://api.example/nothing-here"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("refuses to start with settings missing, naming them", () => {
    expect(() => createAppFromEnv({ SUPABASE_URL: "http://127.0.0.1:54321" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("scheduled jobs the way Vercel Cron calls them", () => {
  const paths = ["/cron/reminders", "/cron/forfeit", "/cron/holds"];

  it("accepts a GET with the cron secret", async () => {
    for (const path of paths) {
      const res = await handler(new Request(`https://api.example${path}`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
      expect(res.status, path).toBe(200);
    }
  });

  it("refuses a GET without the secret, or with the wrong one", async () => {
    for (const path of paths) {
      expect((await handler(new Request(`https://api.example${path}`))).status, path).toBe(401);
      const wrong = await handler(new Request(`https://api.example${path}`, { headers: { Authorization: "Bearer not-the-secret-at-all-1234567890" } }));
      expect(wrong.status, path).toBe(401);
    }
  });

  it("still accepts POST, as the local cron calls do", async () => {
    const res = await handler(
      new Request("https://api.example/cron/holds", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
  });
});
