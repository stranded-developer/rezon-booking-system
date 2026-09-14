import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient, type Db } from "@raceground/db";
import { inject } from "vitest";
import { createApp } from "../src/app.js";
import type { Clock } from "../src/context.js";
import type { StaffRole } from "../src/context.js";
import { loadEnv, type Env } from "../src/env.js";
import { OPERATOR_HEADER } from "../src/middleware/auth.js";
import { createStaff } from "../src/services/staff.js";

export const PASSWORD = "correct-horse-battery";

/** A clock tests can move. Defaults to real time. */
export class TestClock implements Clock {
  private fixed: Date | null = null;
  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }
  set(iso: string | Date): void {
    this.fixed = new Date(iso);
  }
  advanceMinutes(minutes: number): void {
    this.fixed = new Date(this.now().getTime() + minutes * 60_000);
  }
  real(): void {
    this.fixed = null;
  }
}

export function testContext(overrides: Record<string, string> = {}) {
  const supabase = inject("supabase");
  const env: Env = loadEnv({
    SUPABASE_URL: supabase.url,
    SUPABASE_SERVICE_ROLE_KEY: supabase.secretKey,
    OPERATOR_TOKEN_SECRET: randomBytes(32).toString("hex"),
    ...overrides,
  });
  const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const clock = new TestClock();
  const app = createApp({ env, db, clock });
  return { env, db, app, supabase, clock };
}

export type TestContext = ReturnType<typeof testContext>;

export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@raceground.test`;

export async function signIn(ctx: TestContext, email: string, password = PASSWORD): Promise<string> {
  const client = createClient(ctx.supabase.url, ctx.supabase.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

export interface TestStaff {
  id: string;
  email: string;
  pin: string;
  role: StaffRole;
  jwt: string;
}

const createdStaffIds: string[] = [];
const createdUserIds: string[] = [];

export async function makeStaff(ctx: TestContext, role: StaffRole, pin = "1234", label: string = role): Promise<TestStaff> {
  const email = uniqueEmail(label);
  const staff = await createStaff(
    ctx.db,
    { email, password: PASSWORD, displayName: `Test ${label}`, role, pin },
    { actorStaffId: null, reason: "test fixture" },
  );
  createdStaffIds.push(staff.id);
  return { id: staff.id, email, pin, role, jwt: await signIn(ctx, email) };
}

export async function makeNonStaffUser(ctx: TestContext): Promise<string> {
  const email = uniqueEmail("customer");
  const { data, error } = await ctx.db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return signIn(ctx, email);
}

/** Register staff created through the API (not makeStaff) so cleanup deactivates them too. */
export function trackStaff(id: string): void {
  createdStaffIds.push(id);
}

/**
 * Keep the local database usable after a test run. Staff are referenced by the append-only audit
 * log so they cannot be deleted; they are deactivated instead (hidden from the POS lock screen).
 * Cashiers first, so the last-superadmin guard only ever blocks a superadmin that must remain.
 */
export async function cleanupTestData(ctx: TestContext): Promise<void> {
  const ids = createdStaffIds.splice(0);
  const { data: rows } = await ctx.db.from("staff").select("id, role").in("id", ids);
  const ordered = [...(rows ?? [])].sort((a, b) => (a.role === b.role ? 0 : a.role === "cashier" ? -1 : 1));
  for (const row of ordered) {
    await ctx.db.from("staff").update({ active: false }).eq("id", row.id);
  }
  for (const id of createdUserIds.splice(0)) {
    await ctx.db.auth.admin.deleteUser(id);
  }
}

export interface CallOptions {
  method?: string;
  jwt?: string;
  operatorToken?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call(ctx: TestContext, path: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  if (opts.operatorToken) headers[OPERATOR_HEADER] = opts.operatorToken;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await ctx.app.request(path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, any>) : {};
  return { status: res.status, json, headers: res.headers };
}

/** Device signs in as `device`, then `operator` enters their PIN. Returns the operator token. */
export async function operatorToken(ctx: TestContext, device: TestStaff, operator: TestStaff = device): Promise<string> {
  const res = await call(ctx, "/pos/operator", { jwt: device.jwt, body: { staffId: operator.id, pin: operator.pin } });
  if (res.status !== 200) throw new Error(`Operator sign-in failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.token as string;
}

export async function staffRow(db: Db, id: string) {
  const { data, error } = await db.from("staff").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
