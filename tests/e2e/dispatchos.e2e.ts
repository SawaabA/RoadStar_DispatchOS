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
  const pallets = page.getByLabel("QTY").first();
  await pallets.fill("0");
  await page.getByRole("button", { name: "Optimize trailer" }).click();
  await expect(page.getByRole("alert")).toContainText("at least one pallet");
});

test("dispatcher creates a mixed-cargo load and imports it into the 3D planner", async ({ page }) => {
  await page.getByRole("button", { name: /^Load board/ }).click();
  await page.getByRole("button", { name: "New load" }).click();
  const dialog = page.getByRole("dialog", { name: "Create a dispatch-ready load" });
  await dialog.getByLabel("CUSTOMER").fill("QA Components");
  await dialog.getByLabel("DESCRIPTION").fill("Mixed cargo acceptance journey");
  await dialog.getByLabel("RATE (CAD)").fill("2200");
  await dialog.getByRole("button", { name: "Continue to cargo" }).click();
  await dialog.getByRole("button", { name: "Add cargo type" }).click();
  await dialog.getByLabel("NAME").nth(1).fill("Forklift attachment");
  await dialog.getByLabel("LENGTH (IN)").nth(1).fill("72");
  await dialog.getByLabel("WIDTH (IN)").nth(1).fill("48");
  await dialog.getByLabel("HEIGHT (IN)").nth(1).fill("36");
  await dialog.getByLabel("UNIT LB").nth(1).fill("1800");
  await dialog.getByRole("button", { name: "Create load" }).click();
  await expect(page.getByText(/was created and is ready for dispatch/)).toBeVisible();
  await page.getByRole("button", { name: "3D load planner", exact: true }).click();
  await page.getByRole("button", { name: /Import .* active dispatch loads/ }).click();
  await expect(page.getByText("Forklift attachment", { exact: true })).toBeVisible();
});

test("dispatcher can edit, duplicate, cancel, archive, and restore a load", async ({ page }) => {
  await page.getByRole("button", { name: /^Load board/ }).click();
  await page.getByRole("button", { name: "New load" }).click();
  let dialog = page.getByRole("dialog", { name: "Create a dispatch-ready load" });
  const originalBill = await dialog.getByLabel("LOAD NUMBER").inputValue();
  await dialog.getByLabel("CUSTOMER").fill("Lifecycle QA");
  await dialog.getByLabel("DESCRIPTION").fill("Lifecycle acceptance test");
  await dialog.getByLabel("RATE (CAD)").fill("900");
  await dialog.getByRole("button", { name: "Continue to cargo" }).click();
  await dialog.getByRole("button", { name: "Create load" }).click();

  const originalRow = page.getByRole("row").filter({ hasText: originalBill });
  await originalRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit dispatch load" });
  const revisedBill = `${originalBill}-R`;
  await dialog.getByLabel("LOAD NUMBER").fill(revisedBill);
  await dialog.getByRole("button", { name: "Continue to cargo" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${revisedBill} changes was created and is ready for dispatch.`)).toBeVisible();

  const revisedRow = page.getByRole("row").filter({ hasText: revisedBill });
  await revisedRow.getByRole("button", { name: "Duplicate" }).click();
  const copyBill = `${revisedBill}-COPY`;
  const copyRow = page.getByRole("row").filter({ hasText: copyBill });
  await copyRow.getByRole("button", { name: "Cancel" }).click();
  await page.getByLabel("Filter loads by status").selectOption("all");
  await copyRow.getByRole("button", { name: "Archive" }).click();
  await expect(copyRow).toContainText("archived");
  await copyRow.getByRole("button", { name: "Restore" }).click();
  await expect(copyRow).toContainText("unassigned");
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

test("historical replay labels opportunity rather than guaranteed savings", async ({ page }) => {
  await page.getByRole("button", { name: /^KPI & replay/ }).click();
  await page.getByRole("button", { name: "Run lane-match replay" }).click();
  await expect(page.getByText("147,760 km opportunity")).toBeVisible();
  await expect(page.getByText(/not guaranteed savings/i).first()).toBeVisible();
});

test("irregular cargo estimates pallet displacement and reaches the 3D plan", async ({ page }) => {
  await page.getByRole("button", { name: "3D load planner", exact: true }).click();
  await page.getByText("Add cargo type", { exact: true }).click();
  await expect(page.getByText(/pallet positions forgone/)).toBeVisible();
  await page.getByRole("button", { name: "Add to manifest" }).click();
  await expect(page.getByText("Forklift", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Optimize trailer" }).click();
  await expect(page.getByText(/Estimated dimensions are marked/i)).toBeVisible();
});
