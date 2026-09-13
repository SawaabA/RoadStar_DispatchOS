import { readFileSync } from "node:fs";
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

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("driver view fits the screen with large, reachable controls", async ({ page }) => {
    // Navigation starts as a closed drawer so the page gets the whole width.
    const menu = page.getByRole("button", { name: "Expand navigation" });
    await expect(menu).toBeVisible();
    await menu.click();
    await page.getByRole("button", { name: "Driver view", exact: true }).click();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();

    await expect(page.getByRole("heading", { name: /^Hi, / })).toBeVisible();
    await expect(page.locator(".driver-notes")).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const primary = page.locator(".driver-actions button").first();
    await expect(primary).toBeInViewport();
    const box = (await primary.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    const smallest = await page.locator(".phone-main").evaluate((root) => Math.min(...[...root.querySelectorAll("h1, p, b, small, button, span")]
      .filter((element) => element.getBoundingClientRect().width > 0 && element.childElementCount === 0 && element.textContent?.trim())
      .map((element) => parseFloat(getComputedStyle(element).fontSize))));
    expect(smallest).toBeGreaterThanOrEqual(11);

    const results = await new AxeBuilder({ page }).include(".driver-demo").analyze();
    expect(results.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
      .flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`))).toEqual([]);
  });
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
  await page.getByRole("button", { name: "Advanced cargo load" }).click();
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
  await page.getByRole("button", { name: "Advanced cargo load" }).click();
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

// Dedicated QA accounts come from the environment or the Git-ignored
// .env.qa.local (see docs/auth-testing.md). Without them the live sign-in
// journey is skipped, so CI never needs real credentials.
const qaAccounts: Record<string, string> = (() => {
  try {
    return Object.fromEntries(readFileSync(".env.qa.local", "utf8").split("\n")
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1]!, match[2]!]));
  } catch {
    return {};
  }
})();
const qaValue = (name: string) => process.env[name] || qaAccounts[name] || "";

test("sign-in offers a password, explains a wrong password, and keeps the email link", async ({ page }) => {
  let attempts = 0;
  await page.route("**/auth/v1/token?grant_type=password", async (route) => {
    attempts += 1;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }) });
  });
  await page.goto("/");
  await page.getByText("Demo Dispatcher", { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Connect your workspace" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Password", exact: true })).toHaveAttribute("aria-pressed", "true");

  await dialog.getByLabel("WORK EMAIL").fill("dispatcher-a@roadstar.test");
  const password = dialog.getByLabel("PASSWORD", { exact: true });
  await password.fill("not-the-password");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");

  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Email or password is incorrect.");
  expect(attempts).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Demo Dispatcher", { exact: true }).first()).toBeVisible();

  const results = await new AxeBuilder({ page }).include(".auth-modal").analyze();
  // Report the failing elements, not only the rule, so a regression is actionable.
  expect(results.violations
    .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
    .flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")} — ${node.failureSummary?.split("\n").slice(1).join(" ").trim()}`))).toEqual([]);

  await dialog.getByRole("button", { name: "Email link", exact: true }).click();
  await expect(dialog.getByLabel("PASSWORD", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Email me a secure link" })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("a provisioned dispatcher signs in with a password and signs out", async ({ page }) => {
  const email = qaValue("ROADSTAR_QA_DISPATCHER_A_EMAIL");
  const password = qaValue("ROADSTAR_QA_DISPATCHER_A_PASSWORD");
  test.skip(!email || !password, "Set ROADSTAR_QA_DISPATCHER_A_EMAIL and _PASSWORD, or create .env.qa.local");

  await page.goto("/");
  await page.getByText("Demo Dispatcher", { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Connect your workspace" });
  await dialog.getByLabel("WORK EMAIL").fill(email);
  await dialog.getByLabel("PASSWORD", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(dialog).toBeHidden();
  const accountName = email.split("@")[0]!;
  await expect(page.getByText(accountName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Demo Dispatcher", { exact: true })).toHaveCount(0);

  await page.getByText(accountName, { exact: true }).first().click();
  const account = page.getByRole("dialog", { name: "Dispatcher account" });
  await expect(account).toContainText(`Signed in as ${email}`);
  await account.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Demo Dispatcher", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test("document features ask a signed-out user to sign in instead of failing", async ({ page }) => {
  await page.getByRole("button", { name: /^Load board/ }).click();
  await expect(page.getByRole("heading", { name: "Load documents" })).toBeVisible();
  await expect(page.getByText("Sign in to see proof-of-delivery photos and rate confirmations.")).toBeVisible();

  await page.getByRole("button", { name: /^Driver view/ }).click();
  await expect(page.getByText("Sign in to attach a proof of delivery.")).toBeVisible();
});

test("dispatcher creates a load that joins the load board unassigned", async ({ page }) => {
  await page.getByRole("button", { name: /^Load board/ }).click();
  await page.getByRole("button", { name: "+ New load" }).click();
  const form = page.getByRole("dialog", { name: "New load" });
  await expect(form).toBeVisible();

  await form.getByRole("button", { name: "Create load" }).click();
  await expect(form.getByText("Enter a bill number.")).toBeVisible();
  await expect(form.getByLabel("Pickup city")).toHaveAttribute("aria-invalid", "true");

  const results = await new AxeBuilder({ page }).include(".load-form-modal").analyze();
  // Report each failing element and axe's own explanation, not just the rule name.
  const serious = results.violations
    .filter((item) => ["critical", "serious"].includes(item.impact ?? ""))
    .flatMap((item) => item.nodes.map((node) => `${item.id} ${node.target.join(" ")}: ${node.any[0]?.message ?? node.failureSummary ?? ""}`));
  expect(serious).toEqual([]);

  await form.getByLabel("Bill number").fill("RS-9001");
  await form.getByLabel("Customer").fill("Maple Freight Brokerage");
  await form.getByLabel("Pickup city").selectOption("Guelph");
  await form.getByLabel("Delivery city").selectOption("Hamilton");
  await form.getByLabel("Pickup opens").fill("2026-09-14T08:00");
  await form.getByLabel("Pickup closes").fill("2026-09-14T10:00");
  await form.getByLabel("Deliver by").fill("2026-09-14T15:00");
  await form.getByLabel("Equipment").selectOption("Dry Van");
  await form.getByLabel("Weight (lb)").fill("22000");
  await form.getByLabel("Pallets").fill("12");
  await form.getByLabel("Rate (CAD)").fill("1450");
  await form.getByRole("button", { name: "Create load" }).click();

  await expect(form).toBeHidden();
  const row = page.locator(".table-row").filter({ hasText: "RS-9001" });
  await expect(row).toContainText("Guelph, ON");
  await expect(row).toContainText("Hamilton, ON");
});

test("document reader uses a PDF's text layer, renders scans, and fits images to the vision budget", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { readDocumentForExtraction } = await import("/src/features/documents/lib/documentReader.ts");
    const pdf = async (name: string) => new File([await (await fetch(`/tests/fixtures/${name}`)).arrayBuffer()], name, { type: "application/pdf" });
    const text = await readDocumentForExtraction(await pdf("rate-confirmation-text.pdf"));
    const scan = await readDocumentForExtraction(await pdf("rate-confirmation-scan.pdf"));
    const photoBlob = await (await fetch("/tests/fixtures/rate-confirmation-photo.jpg")).blob();
    const photo = await readDocumentForExtraction(new File([photoBlob], "rate-confirmation.jpg", { type: "image/jpeg" }));
    let broken = "";
    try { await readDocumentForExtraction(new File([new Uint8Array([1, 2, 3])], "broken.pdf", { type: "application/pdf" })); }
    catch (error) { broken = (error as Error).message; }
    return {
      textMode: text.mode,
      textContent: text.mode === "text" ? text.text : "",
      scanMode: scan.mode,
      scanImages: scan.mode === "images" ? scan.images.length : 0,
      scanPayload: scan.mode === "images" ? scan.images.join("").length : 0,
      scanPrefix: scan.mode === "images" ? scan.images[0]!.slice(0, 23) : "",
      photoMode: photo.mode,
      photoRawChars: Math.ceil(photoBlob.size / 3) * 4,
      photoPayload: photo.mode === "images" ? photo.images.join("").length : 0,
      broken,
    };
  });

  expect(result.textMode).toBe("text");
  expect(result.textContent).toContain("MF-88213");
  expect(result.textContent).toContain("31,200");
  expect(result.scanMode).toBe("images");
  expect(result.scanImages).toBe(1);
  expect(result.scanPrefix).toBe("data:image/jpeg;base64,");
  // SPUR's vision tier refuses more than about 125 KB of base64 per request, so
  // every image path must come in under the browser budget of 96,000 characters.
  expect(result.scanPayload).toBeLessThanOrEqual(96_000);
  expect(result.photoMode).toBe("images");
  // The fixture is over budget as a raw upload, so this proves re-encoding happened.
  expect(result.photoRawChars).toBeGreaterThan(96_000);
  expect(result.photoPayload).toBeLessThanOrEqual(96_000);
  expect(result.broken).toBe("This file is not a readable PDF.");
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
