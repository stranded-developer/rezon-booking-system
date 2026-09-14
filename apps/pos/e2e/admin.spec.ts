import { expect, test, type Page } from "@playwright/test";
import { loadFixture } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

test("a superadmin uses the back office: referral codes, complimentary member, balance, rules validation, venue, audit", async ({ page }) => {
  const f = loadFixture();

  // Sign in as the owner and open the back office from the floor.
  await page.goto("/");
  await page.getByLabel("Staff email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: new RegExp(f.owner.name) }).click();
  for (const d of f.owner.pin) await page.keyboard.press(d);
  await page.getByRole("link", { name: "Back office", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sales" })).toBeVisible();
  await shot(page, "admin-01-sales");

  // Referral codes: generate two 15% codes with 3 uses each.
  await page.getByRole("link", { name: "Referral codes", exact: true }).click();
  await page.getByRole("button", { name: "Generate codes" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Percent off").fill("15");
  await dialog.getByLabel("Max uses (each)").fill("3");
  await dialog.getByLabel("How many codes").fill("2");
  await dialog.getByRole("button", { name: "Generate 2 codes" }).click();
  const created = page.getByTestId("created-codes");
  await expect(created.locator("div")).toHaveCount(2);
  const codes = (await created.locator("div").allTextContents()).map((c) => c.trim());
  codes.forEach((c) => expect(c).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/));
  await shot(page, "admin-02-codes-created");
  await page.keyboard.press("Escape");
  const row = page.getByRole("row", { name: new RegExp(codes[0]!) });
  await expect(row).toContainText("15% off");
  await expect(row).toContainText("0 / 3");
  await expect(row).toContainText("Usable");

  // Members: add a complimentary Gold member, show their card, then add 45 free minutes.
  const memberName = `E2E Comp ${f.run}`;
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByRole("button", { name: "Add complimentary member" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill(memberName);
  await add.getByLabel("Email").fill(`e2e-comp-${f.run}@raceground.test`);
  await add.getByLabel("Tier").selectOption({ label: "Gold · 10% off" });
  await add.getByLabel("Reason").fill("Staff perk");
  await add.getByRole("button", { name: "Create member" }).click();
  await expect(page.getByText("Member created")).toBeVisible();
  await expect(page.getByTestId("member-qr").locator("svg")).toBeVisible();
  await shot(page, "admin-03-member-card");
  await page.keyboard.press("Escape");

  await page.getByPlaceholder("Search name, email or phone").fill(memberName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("row", { name: new RegExp(memberName) }).click();
  const member = page.getByRole("dialog");
  await expect(member.getByTestId("member-balance")).toHaveText("0 min");
  await member.getByLabel("Minutes (+/−)").fill("45");
  await member.getByLabel("Reason").first().fill("Goodwill");
  await member.getByRole("button", { name: "Add 45 min" }).click();
  await expect(member.getByTestId("member-balance")).toHaveText("45 min");
  await expect(member.getByText("+45 min")).toBeVisible();
  await expect(member.getByText(/Goodwill/)).toBeVisible();
  await shot(page, "admin-04-member-balance");
  await page.keyboard.press("Escape");

  // Rules: an overlapping happy hour is refused with a clear message.
  await page.getByRole("link", { name: "Rates & happy hours", exact: true }).click();
  await expect(page.getByRole("cell", { name: "$30.00" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Add happy hour" }).click();
  const hh = page.getByRole("dialog");
  await hh.getByLabel("Name").fill("Clash test");
  await hh.getByRole("button", { name: "Add happy hour" }).click();
  await expect(hh.getByRole("alert")).toContainText("Overlaps happy hour");
  await shot(page, "admin-05-overlap-refused");
  await page.keyboard.press("Escape");

  // Venue: business name for receipts.
  await page.getByRole("link", { name: "Venue & hours", exact: true }).click();
  const businessName = `Raceground E2E ${f.run}`;
  await page.getByLabel("Business name").fill(businessName);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Audit log shows who did it.
  await page.getByRole("link", { name: "Audit log", exact: true }).click();
  await page.getByLabel("Filter").selectOption("venue_settings");
  const audit = page.getByRole("row", { name: /venue_settings\.update/ }).first();
  await expect(audit).toContainText(f.owner.name);
  await expect(audit).toContainText(businessName);
  await page.getByLabel("Filter").selectOption("referral_codes");
  await expect(page.getByRole("row", { name: /referral_codes\.insert/ }).first()).toContainText(f.owner.name);
  await shot(page, "admin-06-audit");

  // Staff list includes the cashier; the cashier can't open the back office.
  await page.getByRole("link", { name: "Staff", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(f.cashier.name) })).toContainText("Cashier");
  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("button", { name: new RegExp(f.cashier.name) }).click();
  for (const d of f.cashier.pin) await page.keyboard.press(d);
  await expect(page.getByText("The back office is for superadmins")).toBeVisible();
  await page.getByRole("link", { name: "Back to the floor", exact: true }).click();
  await expect(page.getByRole("link", { name: "Back office", exact: true })).toHaveCount(0);
});
