import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    // Default to Playwright's bundled Chromium so the suite runs on any machine
    // and pins one browser build. Set PLAYWRIGHT_CHANNEL=chrome to use a locally
    // installed Google Chrome instead.
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER === "true" ? undefined : {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
