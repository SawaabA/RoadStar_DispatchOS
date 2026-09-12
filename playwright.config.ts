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
    channel: "chrome",
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
