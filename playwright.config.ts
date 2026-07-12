import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs the real app (production build) against:
 *  - local Supabase (`supabase start` must be running)
 *  - an in-process Oxen stub served over HTTP on :3232
 * Ports: app on 3131 (3000 is often a local oxen-server).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3131",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx e2e/support/oxen-stub-server.ts",
      url: "http://localhost:3232/healthz",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm build && pnpm start --port 3131",
      url: "http://localhost:3131",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        OXEN_BASE_URL: "http://localhost:3232",
        OXEN_TOKEN: "e2e-token",
        OXEN_NAMESPACE: "e2e",
        // lets the URL-import e2e fetch the stub's fixture page
        ALLOW_LOCAL_IMPORT: "1",
      },
    },
  ],
});
