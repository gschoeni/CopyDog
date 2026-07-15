import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs the real app (production build) against:
 *  - local Supabase (`supabase start` must be running)
 *  - an in-process Oxen stub served over HTTP on :3232
 *
 * Ports: tests own 3132 so they coexist with a running `pnpm dev` on 3131
 * (and the local oxen-server on 3000). Email links point at site_url
 * (3131); the test helpers rewrite them to the test origin.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3132",
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
      // isolated dist dir: building here must not clobber a running dev server's .next
      command: "NEXT_DIST_DIR=.next-build pnpm build && NEXT_DIST_DIR=.next-build pnpm start --port 3132",
      url: "http://localhost:3132",
      // never reuse a foreign server: tests must run the production build
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        OXEN_BASE_URL: "http://localhost:3232",
        OXEN_API_KEY: "e2e-token",
        OXEN_NAMESPACE: "e2e",
        // lets the URL-import e2e fetch the stub's fixture page
        ALLOW_LOCAL_IMPORT: "1",
        // agent e2e runs against the stub's scripted chat completions
        LLM_BASE_URL: "http://localhost:3232",
      },
    },
  ],
});
