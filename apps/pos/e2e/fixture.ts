import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Playwright runs from apps/pos.
export const FIXTURE_FILE = resolve("e2e/.fixture.json");
const REPO_ROOT = resolve("../..");

export interface Fixture {
  run: string;
  password: string;
  cashier: { id: string; email: string; name: string; pin: string };
  owner: { id: string; email: string; name: string; pin: string };
  /** This run's own resource type, at a rate no back-office change can move. */
  resourceTypeId: string;
  resourceTypeRateCents: number;
  resourceId: string;
  resourceLabel: string;
  memberToken: string;
  memberName: string;
  bookingCustomer: string;
  /** A free confirmed booking tomorrow midday, for the back office Bookings page. */
  adminBooking: { ref: string; customer: string; date: string; startTime: string; resourceId: string; resourceLabel: string };
  /** Starting within the hour: too late for the policy, so only a venue-fault cancel works. */
  adminBookingSoon: { ref: string; date: string; resourceId: string };
  originalBusinessName: string | null;
  originalWebsite: { address: string | null; phone: string | null; contact_email: string | null; intro: string | null; instagram_url: string | null };
}

export function localSupabase() {
  const out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const vars = Object.fromEntries(
    out
      .split("\n")
      .map((l) => /^([A-Z_]+)="(.*)"$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  ) as Record<string, string>;
  return createClient(vars.API_URL!, vars.SECRET_KEY ?? vars.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export const saveFixture = (f: Fixture) => writeFileSync(FIXTURE_FILE, JSON.stringify(f, null, 2));
export const loadFixture = (): Fixture => JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as Fixture;


/** A tier's current values, read from the database. Prices and percentages are the owner's to change (D67). */
export async function tierValues(name: string): Promise<{ id: string; name: string; discountBp: number; monthlyPriceCents: number }> {
  const db = localSupabase();
  const { data, error } = await db.from("membership_tiers").select("id, name, discount_bp, monthly_price_cents").eq("name", name).single();
  if (error) throw error;
  return { id: data.id as string, name: data.name as string, discountBp: data.discount_bp as number, monthlyPriceCents: data.monthly_price_cents as number };
}

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A resource type's hourly rate, read from the database — the owner can change it (D74). */
export async function resourceTypeRate(key: string): Promise<number> {
  const db = localSupabase();
  const { data, error } = await db.from("resource_types").select("base_rate_cents").eq("key", key).single();
  if (error) throw error;
  return data.base_rate_cents as number;
}
