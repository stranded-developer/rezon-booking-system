import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke test of the POS against the local API and local Supabase.
 * Prerequisites: `pnpm db:start` (repo root), apps/api/.env.local and apps/pos/.env.local.
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
    baseURL: "http://localhost:3001",
    viewport: { width: 1366, height: 900 },
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
      url: "http://localhost:3001",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
