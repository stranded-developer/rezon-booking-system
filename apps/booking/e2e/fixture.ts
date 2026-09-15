import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Playwright runs from apps/booking.
export const FIXTURE_FILE = resolve("e2e/.fixture.json");
const REPO_ROOT = resolve("../..");

export interface Fixture {
  run: string;
  /** A resource type only this run books, so the timetable is predictable. */
  resourceTypeId: string;
  resourceTypeKey: string;
  resourceTypeName: string;
  resourceIds: string[];
  resourceLabels: string[];
  /** Fixed-amount code big enough to make a short booking free. */
  freeCode: string;
  usedUpCode: string;
  customerEmail: string;
  /** A member sold at the counter, who then signs up on the website (D56). */
  counterMember: { name: string; email: string; memberNo: string; tierName: string; balanceMinutes: number };
  /** An account with no membership, used for joining online. */
  joiner: { name: string; email: string };
  password: string;
  /** A superadmin used only to sync the Stripe tier catalogue before the membership test. */
  staff: { id: string; email: string; pin: string };
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
