import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

for (const file of [".env", ".env.local", ".env.qa.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const email = process.env.ROADSTAR_QA_DISPATCHER_A_EMAIL;
const password = process.env.ROADSTAR_QA_DISPATCHER_A_PASSWORD;
if (!email || !password) throw new Error("Dispatcher QA credentials are not configured.");

const output = "deliverables/pitch-deck/assets";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

const settle = async (delay = 2_500) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(delay);
};
const capture = async (name) => {
  await page.addStyleTag({ content: ".profile b,.profile small{visibility:hidden!important}" });
  await page.screenshot({ path: `${output}/${name}`, fullPage: false });
};
const navigate = async (label) => {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await settle();
};

await page.goto("https://roadstardispatch.xyz/", { waitUntil: "domcontentloaded", timeout: 90_000 });
await settle();
const signInControl = page.getByText("Sign in to sync", { exact: true });
if (await signInControl.count()) {
  await page.locator(".profile").click();
  await page.locator('input[name="email"]').fill(email);
  await page.locator("#auth-password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator(".auth-modal").waitFor({ state: "hidden", timeout: 30_000 });
}
await settle();

await navigate("Command center");
await capture("01_dashboard.png");

await navigate("3D load planner");
await page.locator(".loader-page").waitFor({ state: "visible" });
await settle(4_000);
await capture("02_core_feature.png");

await navigate("KPI & replay");
await settle();
await capture("03_analytics.png");

await navigate("Integrations");
await settle();
await capture("04_settings.png");

await navigate("Live map");
await page.locator(".maplibregl-map").waitFor({ state: "visible" });
await settle(4_000);
const poi = page.locator(".poi-marker").first();
if (await poi.count()) await poi.click();
await capture("05_live_map.png");

await navigate("Detention");
await capture("06_detention.png");

await navigate("Driver view");
await capture("07_driver.png");

console.log(`Captured authenticated product screens in ${output}`);
await browser.close();
