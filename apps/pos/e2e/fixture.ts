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
  resourceId: string;
  resourceLabel: string;
  memberToken: string;
  memberName: string;
  bookingCustomer: string;
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
