/**
 * The Vercel entry point (apps/api/api/index.ts), exercised the way Vercel runs it: as a Node
 * request handler behind a real HTTP server, not by handing it a web Request. The first deploy
 * failed exactly here — Vercel passes Node's (request, response) pair, and anything that expects a
 * web Request hangs until the function times out.
 *
 * Also covers how Vercel Cron calls the scheduled jobs: a GET with the CRON_SECRET bearer token.
 */
import { randomBytes } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createAppFromEnv } from "../src/bootstrap.js";
import handler, { createHandler } from "../api/index.js";

const CRON_SECRET = `vercel-entry-${randomBytes(16).toString("hex")}`;
let baseUrl: string;
let server: Server;

/** Serves a handler on a free port, like the runtime does, and returns its address. */
async function listen(h: RequestListener): Promise<{ server: Server; url: string }> {
  const created = createServer(h);
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  return { server: created, url: `http://127.0.0.1:${(created.address() as AddressInfo).port}` };
}

const close = (s: Server) => new Promise<void>((resolve) => s.close(() => resolve()));

beforeAll(async () => {
  const supabase = inject("supabase");
  // The deployed function reads its settings from the environment, exactly like this.
  process.env.SUPABASE_URL = supabase.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = supabase.secretKey;
  process.env.OPERATOR_TOKEN_SECRET = randomBytes(32).toString("hex");
  process.env.QR_TOKEN_SECRET = randomBytes(32).toString("hex");
  process.env.CRON_SECRET = CRON_SECRET;
  const started = await listen(handler);
  server = started.server;
  baseUrl = started.url;
});

afterAll(async () => {
  if (server) await close(server);
});

describe("the function Vercel runs", () => {
  it("answers a real HTTP request built from the environment", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("reads request headers, which needs Node's request adapted properly", async () => {
    // The first deploy crashed on exactly this: "this.raw.headers.get is not a function".
    const res = await fetch(`${baseUrl}/pos/floor`, { headers: { Authorization: "Bearer not-a-real-token" } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
  });

  it("routes unknown paths like the local server does", async () => {
    const res = await fetch(`${baseUrl}/nothing-here`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("refuses to start with settings missing, naming them", () => {
    expect(() => createAppFromEnv({ SUPABASE_URL: "http://127.0.0.1:54321" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("answers with what is wrong instead of crashing when a setting is missing", async () => {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const misconfigured = await listen(createHandler(() => createAppFromEnv({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: undefined })));
    try {
      const res = await fetch(`${misconfigured.url}/health`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("config_error");
      expect(body.error.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
      // The answer names the setting; it never repeats the value of another one.
      expect(body.error.message).not.toContain(secret);
    } finally {
      await close(misconfigured.server);
    }
  });
});

describe("scheduled jobs the way Vercel Cron calls them", () => {
  const paths = ["/cron/reminders", "/cron/forfeit", "/cron/holds"];

  it("accepts a GET with the cron secret", async () => {
    for (const path of paths) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
      expect(res.status, path).toBe(200);
    }
  });

  it("refuses a GET without the secret, or with the wrong one", async () => {
    for (const path of paths) {
      expect((await fetch(`${baseUrl}${path}`)).status, path).toBe(401);
      const wrong = await fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer not-the-secret-at-all-1234567890" } });
      expect(wrong.status, path).toBe(401);
    }
  });

  it("still accepts POST, as the local cron calls do", async () => {
    const res = await fetch(`${baseUrl}/cron/holds`, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.status).toBe(200);
  });
});
