import { expect, Page, test } from "@playwright/test";

async function signIn(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

test.describe.configure({ mode: "serial" });

test("reactive job: log → book → engineer completes on a phone → office closes", async ({ browser }) => {
  // --- coordinator logs the job on desktop
  const office = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  office.on("dialog", (d) => d.accept());
  await signIn(office, "Priya Nair");
  await expect(office.getByRole("heading", { name: /Good (morning|afternoon|evening), Priya/ })).toBeVisible();
  await office.getByRole("link", { name: "Log a job" }).first().click();
  await office.getByLabel("Customer").fill("Deansgate");
  await office.getByRole("button", { name: /Northgate Property Management/ }).click();
  await office.getByLabel("Site").selectOption({ label: "Deansgate Chambers — M3 4BQ" });
  await office.getByLabel("Priority").selectOption("urgent");
  await expect(office.getByText(/CT-NPM-24: urgent response within 8h/)).toBeVisible();
  await office.getByLabel("Title").fill("Comms room too hot — E2E");
  await office.getByText(/Comms room 2F/).click();
  await office.getByRole("button", { name: "Log job" }).click();
  await expect(office.getByRole("heading", { name: /Comms room too hot — E2E/ })).toBeVisible();
  await expect(office.getByText("To schedule")).toBeVisible();
  const jobUrl = office.url();

  // --- book Lewis via the suggestions dialog
  await office.getByRole("button", { name: "Book visit" }).first().click();
  await office.locator(".suggest", { hasText: "Lewis Tran" }).click();
  await office.getByLabel("Start time").fill("16:00");
  await office.getByRole("button", { name: "Book visit" }).last().click(); // may prompt (accepted) for out-of-hours/overlap
  await expect(office.locator(".pill", { hasText: "Scheduled" }).first()).toBeVisible();

  // --- engineer on a phone
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await signIn(phone, "Lewis Tran");
  await expect(phone.getByRole("heading", { name: "Lewis's work" })).toBeVisible();
  await phone.locator(".eng-card", { hasText: "Comms room too hot — E2E" }).click();
  await phone.getByRole("button", { name: "Arrived on site" }).click();
  await expect(phone.getByRole("button", { name: "Finish visit" })).toBeVisible();
  // equipment check
  await phone.getByRole("button", { name: /FL-\d+ Split/ }).click();
  await phone.getByRole("button", { name: "Good" }).click();
  await phone.getByPlaceholder("Readings").fill("Supply 11°C");
  await phone.getByRole("button", { name: "Save check" }).click();
  await expect(phone.locator(".pill", { hasText: "Good" }).first()).toBeVisible();
  // part used from van
  await phone.getByRole("button", { name: "Add part used" }).click();
  await phone.getByPlaceholder("Search your van or catalogue").fill("capacitor");
  await phone.getByRole("button", { name: /Run capacitor 35\+5/ }).click();
  await expect(phone.getByText("1 × Run capacitor 35+5µF 440V")).toBeVisible();
  // notes + finish
  await phone.getByPlaceholder("What you found and what you did").fill("Outdoor fan capacitor failed; replaced. Cooling restored.");
  await phone.getByRole("button", { name: "Save notes" }).click();
  await phone.getByRole("button", { name: "Finish visit" }).click();
  await phone.getByText("Fixed / work complete").click();
  await phone.getByLabel("Customer sign-off name (optional)").fill("Carl Mitchell");
  await phone.getByRole("button", { name: "Complete visit" }).click();
  await expect(phone.getByText(/Completed .* — Resolved/)).toBeVisible();

  // --- office sees the result and closes
  await office.goto(jobUrl);
  await expect(office.getByText("Outdoor fan capacitor failed; replaced.")).toBeVisible();
  await expect(office.getByText("Parts used: 1 × Run capacitor 35+5µF 440V")).toBeVisible();
  await expect(office.getByText("Attended within target")).toBeVisible();
  await office.getByRole("button", { name: "Review & close" }).click();
  await expect(office.locator(".pill", { hasText: "Closed" })).toBeVisible();
});

test("engineer finds parts needed → office orders and receives → job returns to the queue", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(phone, "Sam O'Connor");
  await phone.locator(".eng-card.live").click();
  await phone.getByRole("button", { name: "Finish visit" }).click();
  await phone.getByText("Parts needed", { exact: true }).click();
  await phone.getByPlaceholder("Search catalogue or type a description").fill("SPA");
  await phone.getByRole("button", { name: /V-belt SPA 1250/ }).click();
  await phone.getByLabel("What happens next?").fill("Belts and fan bearings needed; AHU running on reduced speed meanwhile.");
  await phone.getByRole("button", { name: "Complete visit" }).click();
  await expect(phone.getByText(/Parts required/)).toBeVisible();

  const office = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  office.on("dialog", (d) => d.accept("SUP-E2E"));
  await signIn(office, "Priya Nair");
  await office.goto("/jobs?status=on_hold");
  await office.getByText("Sports hall AHU tripping on overload").click();
  await office.waitForURL(/\/jobs\/\d+$/);
  await expect(office.locator(".page-head .pill", { hasText: /On hold · parts/ })).toBeVisible();
  await office.getByRole("button", { name: "Order needed parts" }).click();
  await office.getByLabel("Supplier").selectOption({ label: "Pennine HVAC Distribution" });
  await office.getByRole("button", { name: "Create draft order" }).click();
  await office.getByRole("button", { name: "Mark as ordered" }).click();
  await office.getByRole("button", { name: "Receive goods" }).click();
  await office.getByRole("button", { name: /Receive into/ }).click();
  await expect(office.getByText(/can now be scheduled/)).toBeVisible();
  await office.locator(".page-head").getByRole("link", { name: /J-\d+/ }).click();
  await office.waitForURL(/\/jobs\/\d+$/);
  await expect(office.locator(".page-head .pill", { hasText: "To schedule" })).toBeVisible();
  await expect(office.getByText(/Parts arrived at Depot stores/).first()).toBeVisible();
});

test("sales accepts a quote and it becomes the job that was waiting for it", async ({ page }) => {
  await signIn(page, "Rachel Dunn");
  await page.goto("/quotes?status=sent");
  await page.getByText("Replace server cupboard air conditioning unit").click();
  await page.getByRole("button", { name: "Record acceptance" }).click();
  await page.getByLabel("Customer order / PO number").fill("OMP-1234");
  await page.getByRole("button", { name: "Record acceptance" }).last().click();
  await expect(page.getByRole("heading", { name: /Server cupboard AC tripping again/ })).toBeVisible();
  await expect(page.locator(".page-head .pill", { hasText: "To schedule" })).toBeVisible();
  await expect(page.getByText("Quote Q-20001 accepted — book the quoted work")).toBeVisible();
  // Sales cannot book visits
  await expect(page.getByRole("button", { name: "Book visit" })).toHaveCount(0);
});

test("roles: engineers only get the mobile app; sales cannot see settings controls", async ({ browser }) => {
  const eng = await browser.newPage();
  await signIn(eng, "Dave Kershaw");
  await eng.goto("/customers");
  await expect(eng.getByRole("heading", { name: "Dave's work" })).toBeVisible();
  const res = await eng.request.get("/api/customers");
  expect(res.status()).toBe(403);

  const sales = await browser.newPage();
  await signIn(sales, "Rachel Dunn");
  await sales.goto("/settings");
  await expect(sales.getByText("Only managers can change these.")).toBeVisible();
  expect((await sales.request.put("/api/settings", { data: { vat_rate: 0.1 } })).status()).toBe(403);
});

test("assistant degrades gracefully when AI is not configured", async ({ page }) => {
  await signIn(page, "Priya Nair");
  await page.getByRole("button", { name: "Assistant" }).click();
  await expect(page.getByText("The assistant isn't available.")).toBeVisible();
  await expect(page.getByText("Every screen and workflow works without it.")).toBeVisible();
});
