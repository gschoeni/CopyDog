import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // 3000 is often taken by a local oxen-server, so e2e runs on its own port
    baseURL: "http://localhost:3131",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start --port 3131",
    url: "http://localhost:3131",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
