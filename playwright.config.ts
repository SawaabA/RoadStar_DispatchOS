import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";

// Sign-in journeys need a configured Supabase client; their auth responses are
// stubbed in the browser, so the project never has to exist. CI builds have no
// Supabase values, so the dev server gets placeholders (the same ones the
// container smoke job uses). Values from the environment, .env or .env.local
// always win: Vite gives process variables priority over .env files, so a
// placeholder set here would otherwise hide a developer's real project.
const definedInEnvFiles = (name: string) => [".env", ".env.local"].some((file) => {
  try {
    return new RegExp(`^\\s*${name}\\s*=\\s*\\S`, "m").test(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
});
const supabaseFallback = process.env.VITE_SUPABASE_URL || definedInEnvFiles("VITE_SUPABASE_URL")
  ? {}
  : { VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ci_placeholder" };

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
    env: supabaseFallback,
  },
});
