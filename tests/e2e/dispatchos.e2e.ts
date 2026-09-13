import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("all primary workspaces render without serious accessibility violations", async ({
  page,
}) => {
  // Eleven workspaces, each with a full axe sweep. ~18s locally but past the
  // 30s default on a CI runner, where it failed on the last workspace.
  test.slow();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    const expectedOfflineFallback =
      message.text() ===
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)";
    if (message.type() === "error" && !expectedOfflineFallback)
      runtimeErrors.push(message.text());
  });
  const workspaces = [
    ["Command center", "Good morning, Dispatch"],
    ["Dispatch board", "Build today’s plan"],
    ["Load board", "Load board"],
    ["Drivers & fleet", "Drivers and fleet"],
    ["Live map", "Live fleet map"],
    ["Detention", "Detention desk"],
    ["Driver view", "Hi, Sofia"],
    ["3D load planner", "3D trailer builder"],
    ["Intelligence", "Exceptions and automatic re-planning"],
    ["KPI & replay", "KPI and historical replay"],
    ["Integrations", "Integration adapters"],
  ] as const;

  for (const [navigation, heading] of workspaces) {
    await page.getByRole("button", { name: new RegExp(`^${navigation}`) }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await page.waitForTimeout(350);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((item) =>
      ["critical", "serious"].includes(item.impact ?? ""),
    );
    const summary = serious.flatMap((item) => item.nodes.map((node) => `${item.id} ${node.target.join(" ")}`)).join("\n");
    expect.soft(summary, navigation).toBe("");
  }
  expect(runtimeErrors).toEqual([]);
});

test("dispatcher can assign and then unassign an eligible unit", async ({ page }) => {
  await page.getByRole("button", { name: /^Dispatch board/ }).click();
  await page.getByRole("button", { name: /Find eligible unit/ }).first().click();
  const modal = page.getByRole("dialog", { name: /RS-4521/ });
  await expect(modal).toBeVisible();
  await modal.locator(".candidate:not(.blocked)").first().getByRole("button", { name: "Assign" }).click();
  await expect(page.getByRole("button", { name: /Plan my morning/ })).toContainText("3 loads");
  await page.locator(".assignment-card").filter({ hasText: "RS-4521" }).getByRole("button", { name: "Unassign" }).click();
  await expect(page.getByRole("button", { name: /Plan my morning/ })).toContainText("4 loads");
});

test("morning plan stays a proposal until approval", async ({ page }) => {
  await page.getByRole("button", { name: /^Dispatch board/ }).click();
  await page.getByRole("button", { name: /Plan my morning/ }).click();
  const modal = page.getByRole("dialog", { name: "Morning plan ready" });
  await expect(modal).toContainText("nothing changes until you approve");
  await modal.getByRole("button", { name: /Apply/ }).click();
  await expect(page.getByRole("button", { name: /Plan my morning/ })).toContainText("loads");
});

test("driver can start an accepted route", async ({ page }) => {
  await page.getByRole("button", { name: "Driver view", exact: true }).click();
  await page.getByRole("button", { name: "Start route" }).click();
  await expect(page.getByText("in transit", { exact: true })).toBeVisible();
});

test("3D planner validates numeric shipment input", async ({ page }) => {
  await page.getByRole("button", { name: "3D load planner", exact: true }).click();
  const pallets = page.getByLabel("PALLETS").first();
  await pallets.fill("0");
  await page.getByRole("button", { name: "Regenerate plan" }).click();
  await expect(page.getByRole("alert")).toContainText("at least one pallet");
});

test("global search, map style, and detention evidence controls work", async ({
  page,
}) => {
  await page.keyboard.press("Control+k");
  const search = page.getByLabel("Search all loads");
  await expect(search).toBeFocused();
  await search.fill("not-a-real-roadstar-load");
  await expect(page.getByText(/No loads match/i)).toBeVisible();

  await page.getByRole("button", { name: /^Live map/ }).click();
  const satellite = page.getByRole("button", { name: "Satellite" });
  await satellite.click();
  await expect(satellite).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /^Detention/ }).click();
  await page.getByText("View record").first().click();
  await expect(page.locator("details").first()).toHaveAttribute("open", "");
});

test("dispatcher can review and record an incident re-plan decision", async ({ page }) => {
  await page.getByRole("button", { name: /^Intelligence/ }).click();
  await page.getByRole("button", { name: "Inject demo closure" }).click();
  const proposal = page.locator(".decision-card").filter({ hasText: "+35 min" }).first();
  await expect(proposal).toContainText("+35 min");
  await proposal.getByRole("button", { name: "Approve ETA" }).click();
  await expect(proposal).toContainText("Decision recorded: approved");
  await expect(page.locator(".decision-log")).toContainText("Approved 35-minute ETA re-plan");
});

test("copilot shows RoadStar's computed facts when no one is signed in", async ({ page }) => {
  await page.getByRole("button", { name: /^Intelligence/ }).click();
  const question = page.getByRole("button", { name: "What is our detention exposure?" });
  await question.click();
  await expect(question).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Sign in to get a narrated answer.")).toBeVisible();
  await expect(page.locator(".copilot-summary")).toContainText("Billable detention across");
  await expect(page.locator(".copilot-facts li").first()).toContainText("billable min");

  const results = await new AxeBuilder({ page }).include(".copilot-panel").analyze();
  const serious = results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""));
  expect(serious.map((item) => item.id)).toEqual([]);
});

test("historical replay labels opportunity rather than guaranteed savings", async ({ page }) => {
  await page.getByRole("button", { name: /^KPI & replay/ }).click();
  await page.getByRole("button", { name: "Run lane-match replay" }).click();
  await expect(page.getByText("147,760 km opportunity")).toBeVisible();
  await expect(page.getByText(/not guaranteed savings/i).first()).toBeVisible();
});

test("irregular cargo estimates pallet displacement and reaches the 3D plan", async ({ page }) => {
  await page.getByRole("button", { name: "3D load planner", exact: true }).click();
  await page.getByText("Add irregular cargo").click();
  await expect(page.getByText(/pallet positions forgone/)).toBeVisible();
  await page.getByRole("button", { name: "Add to trailer plan" }).click();
  await expect(page.locator("article").filter({ hasText: "Forklift" }).getByText("Forklift", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Regenerate plan" }).click();
  await expect(page.getByText(/operator-entered dimensions/i)).toBeVisible();
});
