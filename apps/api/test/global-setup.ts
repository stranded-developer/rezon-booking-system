import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

export interface LocalSupabase {
  url: string;
  secretKey: string;
  publishableKey: string;
  dbUrl: string;
  /** STRIPE_SECRET_KEY from apps/api/.env.local (test mode), if present. */
  stripeKey: string | null;
}

declare module "vitest" {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

/** Reads connection details from the running local Supabase stack. Fails loudly if it isn't running. */
export default function setup(project: TestProject) {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  let output: string;
  try {
    output = execFileSync("corepack", ["pnpm", "exec", "supabase", "status", "-o", "env"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Local Supabase is not running. Start Docker, then run `pnpm db:start` from the repo root.");
  }
  const vars = Object.fromEntries(
    output
      .split("\n")
      .map((line) => /^([A-Z_]+)="(.*)"$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  ) as Record<string, string>;

  const url = vars.API_URL;
  const secretKey = vars.SECRET_KEY ?? vars.SERVICE_ROLE_KEY;
  const publishableKey = vars.PUBLISHABLE_KEY ?? vars.ANON_KEY;
  const dbUrl = vars.DB_URL;
  if (!url || !secretKey || !publishableKey || !dbUrl) {
    throw new Error("Could not read API_URL / SECRET_KEY / PUBLISHABLE_KEY / DB_URL from `supabase status`.");
  }
  const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
  const stripeKey = existsSync(envFile) ? (/^STRIPE_SECRET_KEY=(sk_test_\S+)$/m.exec(readFileSync(envFile, "utf8"))?.[1] ?? null) : null;
  project.provide("supabase", { url, secretKey, publishableKey, dbUrl, stripeKey });
}
