import { expect, test, type Page } from "@playwright/test";
import { toLocal } from "@raceground/pricing";
import { loadFixture } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
const dollars = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);

test.describe.configure({ mode: "serial" });

test("a cashier runs the counter: sign in, PIN, till, walk-in, member close, receipt, bookings, close till, lock", async ({ page }) => {
  const f = loadFixture();
  const local = toLocal(Date.now(), "Australia/Sydney");
  test.skip(local.minuteOfDay < 10 * 60 || local.minuteOfDay >= 20 * 60 + 45, `Walk-ins are only possible 10:00–20:45 Sydney time (now ${local.label})`);

  // Device sign-in
  await page.goto("/");
  await expect(page.getByText("Sign in this counter device")).toBeVisible();
  await shot(page, "01-device-sign-in");
  await page.getByLabel("Staff email").fill(f.cashier.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Lock screen and PIN
  await expect(page.getByText("Who's on the counter?")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(f.cashier.name) }).click();
  await shot(page, "02-pin-pad");
  for (const d of "0000") await page.keyboard.press(d);
  await expect(page.getByText("Incorrect PIN — 4 tries left")).toBeVisible();
  for (const d of f.cashier.pin) await page.keyboard.press(d);

  // Floor
  const header = page.locator("header");
  await expect(header.getByText(f.cashier.name)).toBeVisible();
  const tile = page.getByRole("button", { name: new RegExp(f.resourceLabel) });
  await expect(tile).toContainText("Free");
  await shot(page, "03-floor");

  // Open the till
  await header.getByRole("button", { name: "No shift open" }).click();
  await expect(page.getByLabel("Opening float")).toHaveValue("200.00");
  await page.getByRole("button", { name: "Open till with $200.00" }).click();
  await expect(page.getByText("Expected in drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header.getByRole("button", { name: /Till open/ })).toBeVisible();

  // Start a walk-in
  await tile.click();
  await page.getByRole("button", { name: "Start walk-in" }).click();
  await expect(tile).toContainText("Walk-in");
  await shot(page, "04-walk-in-running");

  // Close with the member card scanned (the USB scanner types the code and presses Enter)
  await tile.click();
  await page.getByRole("button", { name: "Close & pay" }).click();
  await expect(page.getByText("Minimum 15 min charge")).toBeVisible();
  const scan = page.getByPlaceholder("Scan or type…");
  await expect(scan).toBeFocused();
  await scan.fill(`rg:m:${f.memberToken}`);
  await scan.press("Enter");
  await expect(page.getByText(f.memberName)).toBeVisible();
  await expect(page.getByText("Gold member 10%")).toBeVisible();
  await shot(page, "05-close-with-member");

  const dialog = page.getByRole("dialog");
  const totalCents = dollars((await dialog.locator(".text-5xl").first().textContent()) ?? "");
  // Closed straight away → 15-minute minimum on a $30/hr table, Gold 10% off.
  // Entirely inside weekday happy hour: 15 min @ $27/hr = $6.75 → $6.08. Outside: $7.50 → $6.75.
  const at = toLocal(Date.now(), "Australia/Sydney");
  const weekdayHappyHour = at.isoDayOfWeek <= 5 && at.minuteOfDay >= 10 * 60 && at.minuteOfDay < 14 * 60 + 44;
  const outsideHappyHour = at.isoDayOfWeek > 5 || at.minuteOfDay >= 15 * 60;
  if (weekdayHappyHour) expect(totalCents).toBe(608);
  else if (outsideHappyHour) expect(totalCents).toBe(675);
  else expect(totalCents).toBeGreaterThan(0);

  await expect(dialog.getByRole("button", { name: /^Take .* by card$/ })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cash", exact: true }).click();
  const quick = dialog.locator("button", { hasText: /^\$\d/ });
  const biggest = quick.last();
  const tenderedCents = dollars((await biggest.textContent()) ?? "");
  await biggest.click();
  await dialog.getByRole("button", { name: /^Take .* cash$/ }).click();

  await expect(page.getByText("Change due")).toBeVisible();
  const changeCents = dollars((await page.getByText("Change due").locator("..").locator(".text-5xl").textContent()) ?? "");
  expect(changeCents).toBe(tenderedCents - totalCents);
  // The on-screen receipt (a hidden copy exists for printing).
  const receipt = page.getByRole("dialog").locator(".bg-white");
  await expect(receipt.getByText("TOTAL", { exact: true })).toBeVisible();
  await expect(receipt.getByText("TOTAL", { exact: true }).locator("..")).toContainText(`$${(totalCents / 100).toFixed(2)}`);
  await expect(receipt.getByText(/Member RG-\d{6}/)).toBeVisible();
  await expect(receipt.getByText(`Served by ${f.cashier.name}`)).toBeVisible();
  await shot(page, "06-receipt");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(tile).toContainText("Free");

  // Today's bookings
  await header.getByRole("button", { name: "Today's bookings" }).click();
  await expect(page.getByText(f.bookingCustomer)).toBeVisible();
  await shot(page, "07-bookings");
  await page.keyboard.press("Escape");

  // Close the till with an exact count
  await header.getByRole("button", { name: /Till open/ }).click();
  const expectedCash = 20_000 + totalCents;
  await expect(page.getByText("Expected in drawer").locator("..")).toContainText(`$${(expectedCash / 100).toFixed(2)}`);
  await page.getByLabel("Cash counted in drawer").fill((expectedCash / 100).toFixed(2));
  await page.getByLabel("CommBank terminal end-of-day total").fill("0.00");
  await page.getByRole("button", { name: "Close till" }).click();
  await expect(page.getByText("Shift closed")).toBeVisible();
  await expect(page.getByText("Cash variance").locator("..")).toContainText("$0.00");
  await shot(page, "08-shift-closed");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(header.getByRole("button", { name: "No shift open" })).toBeVisible();

  // Lock
  await header.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByText("Who's on the counter?")).toBeVisible();
  await shot(page, "09-locked");
});
