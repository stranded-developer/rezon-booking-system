/**
 * The back office screens for experiences, promotional prices, tournaments and what's on
 * (D65, D66, D68, D69). Everything is created by the test and switched off afterwards, so it
 * passes on a used database.
 */
import { expect, test, type Page } from "@playwright/test";
import { loadFixture, localSupabase, money } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

let run: string;
let expName: string;
let tournamentName: string;
let eventTitle: string;

test.beforeAll(() => {
  run = loadFixture().run;
  expName = `E2E Sprint ${run}`;
  tournamentName = `E2E Admin Cup ${run}`;
  eventTitle = `E2E Admin Event ${run}`;
});

test.afterAll(async () => {
  const db = localSupabase();
  await db.from("experiences").update({ active: false }).eq("name", expName);
  await db.from("tournaments").update({ published: false }).eq("name", tournamentName);
  await db.from("site_events").update({ active: false }).eq("title", eventTitle);
});

/** Sign in and unlock with the owner's PIN, the way every other back office test does. */
async function signInAsOwner(page: Page) {
  const f = loadFixture();
  await page.goto("/");
  await page.getByLabel("Staff email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: new RegExp(f.owner.name) }).click();
  for (const digit of f.owner.pin) await page.keyboard.press(digit);
  await expect(page.getByRole("link", { name: "Back office", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Back office", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sales" })).toBeVisible();
}

/**
 * Move around the back office by clicking, never by `goto`.
 *
 * Who is on the counter is held in the browser, not in a cookie, so a full page load puts the POS
 * back to the operator picker — which is the right behaviour for a shared machine at a counter.
 */
const openAdmin = (page: Page, label: string) => page.getByRole("link", { name: label, exact: true }).first().click();

test("a superadmin creates an experience, a promotional price, a tournament and an event", async ({ page }) => {
  const db = localSupabase();
  await signInAsOwner(page);

  // ── An experience: a fixed length at a flat price (D65) ───────────────────
  await openAdmin(page, "Experiences");
  await expect(page.getByRole("heading", { name: "Experiences" })).toBeVisible();
  await page.getByRole("button", { name: "Add experience" }).click();
  const expDialog = page.getByRole("dialog");
  await expDialog.getByRole("textbox", { name: /^Short code/ }).fill(`e2e_sprint_${run}`);
  await expDialog.getByRole("textbox", { name: "Name", exact: true }).fill(expName);
  await expDialog.getByRole("textbox", { name: /^Length in minutes/ }).fill("45");
  await expDialog.getByRole("textbox", { name: /^Price \(incl\. GST\)/ }).fill("42.00");

  // 45 minutes is not a whole number of 30-minute sessions, so saving is blocked (D63).
  await expect(expDialog.getByText(/^A length has to be a whole number of 30-minute sessions/)).toBeVisible();
  await expect(expDialog.getByRole("button", { name: `Add experience` })).toBeDisabled();

  await expDialog.getByRole("textbox", { name: /^Length in minutes/ }).fill("60");
  await expDialog.getByRole("textbox", { name: /^Bullet points/ }).fill("Two races, twice the fun\nA full hour on the simulator");
  await expDialog.getByRole("textbox", { name: /^Badges/ }).fill("Most popular");
  await expDialog.getByRole("button", { name: "Add experience" }).click();

  await expect(page.getByRole("heading", { name: new RegExp(expName) })).toBeVisible();
  const card = page.locator("section").filter({ hasText: expName }).first();
  await expect(card).toContainText(money(4200));
  await expect(card).toContainText("60 min");
  await shot(page, "pos-20-experiences");

  // ── A promotional price. Overlaps are allowed: the cheapest wins (D66) ────
  await card.getByRole("button", { name: "Add price" }).click();
  const promoDialog = page.getByRole("dialog");
  await promoDialog.getByRole("textbox", { name: /^Name/ }).fill("Happy Hour");
  await promoDialog.getByRole("textbox", { name: /^Start time/ }).fill("12:00");
  await promoDialog.getByRole("textbox", { name: /^End time/ }).fill("15:00");
  await promoDialog.getByRole("textbox", { name: /^Price \(incl\. GST\)/ }).fill("35.00");
  await promoDialog.getByRole("button", { name: "Add price" }).click();
  await expect(card).toContainText("Happy Hour");
  await expect(card).toContainText("Automatically");

  await card.getByRole("button", { name: "Add price" }).click();
  const studentDialog = page.getByRole("dialog");
  await studentDialog.getByRole("textbox", { name: /^Name/ }).fill("Student");
  await studentDialog.getByRole("textbox", { name: /^Start time/ }).fill("00:00");
  await studentDialog.getByRole("textbox", { name: /^End time/ }).fill("24:00");
  await studentDialog.getByRole("textbox", { name: /^Price \(incl\. GST\)/ }).fill("38.00");
  await studentDialog.getByText("The customer has to ask for this price").click();
  await studentDialog.getByRole("button", { name: "Add price" }).click();
  await expect(card).toContainText("Only if the customer asks");

  // The price change is traceable to whoever made it.
  const { data: created } = await db.from("experiences").select("id").eq("name", expName).single();
  const { data: audit } = await db
    .from("audit_log")
    .select("action, actor_staff_id")
    .eq("entity", "experiences")
    .eq("entity_id", created!.id)
    .order("id", { ascending: false })
    .limit(1)
    .single();
  expect(audit!.action).toBe("experiences.insert");
  expect(audit!.actor_staff_id).not.toBeNull();

  // ── A tournament, saved as a draft until it is published (D68) ────────────
  await openAdmin(page, "Tournaments");
  await expect(page.getByRole("heading", { name: "Tournaments" })).toBeVisible();
  await page.getByRole("button", { name: "Add tournament" }).click();
  const tDialog = page.getByRole("dialog");
  await tDialog.getByRole("textbox", { name: "Name", exact: true }).fill(tournamentName);
  const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 16);
  await tDialog.getByRole("textbox", { name: /^Starts/ }).fill(inTenDays);
  await tDialog.getByRole("textbox", { name: /^Spots/ }).fill("12");
  await tDialog.getByRole("textbox", { name: /^Entry fee/ }).fill("25.00");
  await tDialog.getByRole("button", { name: "Add tournament" }).click();

  const row = page.locator("tr").filter({ hasText: tournamentName });
  await expect(row).toContainText("Draft");
  await expect(row).toContainText("0 of 12");
  await row.getByRole("button", { name: "Publish" }).click();
  await expect(row).toContainText("Published");
  await shot(page, "pos-21-tournaments");

  // ── An event for the website's pop-up and banner (D69) ────────────────────
  await openAdmin(page, "What's on");
  await expect(page.getByRole("heading", { name: "What's on" })).toBeVisible();
  await page.getByRole("button", { name: "Add event" }).click();
  const eDialog = page.getByRole("dialog");
  await eDialog.getByRole("textbox", { name: /^Title/ }).fill(eventTitle);
  await eDialog.getByRole("textbox", { name: /^Highlight/ }).fill("$2,000 cash prize pool");
  await eDialog.getByRole("textbox", { name: /^Button label/ }).fill("Enter now");

  // A button needs both a label and a link, or neither.
  await expect(eDialog.getByText("A button needs both a label and a link, or neither.")).toBeVisible();
  await expect(eDialog.getByRole("button", { name: "Add event" })).toBeDisabled();
  await eDialog.getByRole("textbox", { name: /^Button goes to/ }).fill("/tournaments");
  await eDialog.getByRole("button", { name: "Add event" }).click();

  const eventRow = page.locator("tr").filter({ hasText: eventTitle });
  await expect(eventRow).toContainText("$2,000 cash prize pool");
  await expect(eventRow).toContainText("Pop-up");
  await expect(eventRow).toContainText("Banner");
  await shot(page, "pos-22-events");

  // Turning it off takes it off the public site, and off this list until hidden ones are shown.
  await eventRow.getByRole("button", { name: "Turn off" }).click();
  await expect(eventRow).toHaveCount(0);
  await page.getByRole("button", { name: "Show hidden" }).click();
  await expect(page.locator("tr").filter({ hasText: eventTitle })).toContainText("Off");
});
