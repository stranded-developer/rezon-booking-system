import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the booking site against the local API and local Supabase.
 * Prerequisites: `pnpm db:start` (repo root), apps/api/.env.local and apps/booking/.env.local.
 * The real Stripe payment test also needs E2E_STRIPE=1 and
 * `stripe listen --forward-to localhost:8787/webhooks/stripe`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec tsx --env-file=.env.local src/server.ts",
      url: "http://localhost:8787/health",
      reuseExistingServer: true,
      cwd: "../api",
      timeout: 60_000,
    },
    {
      command: "pnpm start",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
