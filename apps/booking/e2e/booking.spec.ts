import { expect, test, type Page } from "@playwright/test";
import { loadFixture } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

/** Two days out in venue time: a full day of slots, and always more than 24 hours away (full refund). */
function bookingVenueDate(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const at = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + 2));
  return at.toISOString().slice(0, 10);
}

const bookingDayLabel = () => {
  const [y, m, d] = bookingVenueDate().split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(Date.UTC(y!, m! - 1, d!)))
    .replace(/,/g, "");
};

test("the home page shows what the back office says", async ({ page }) => {
  const f = loadFixture();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Billiards, driving sims and VR");
  // Rates come from the venue's own configuration, including this run's test type.
  await expect(page.getByRole("heading", { name: "Billiard Table" })).toBeVisible();
  await expect(page.getByText("$30.00/hr").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: f.resourceTypeName })).toBeVisible();
  await expect(page.getByText(/Happy Hour: 10% off/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opening hours" })).toBeVisible();
  await expect(page.getByText("10:00 am – 9:00 pm").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Silver" })).toBeVisible();
  await shot(page, "web-01-home");
  await page.getByRole("link", { name: "Book now" }).first().click();
  await expect(page.getByRole("heading", { name: "Book your time" })).toBeVisible();
});

test("a guest books and cancels: timetable, referral code, free booking, QR, refund", async ({ page }) => {
  const f = loadFixture();
  await page.goto("/book");

  // 1. What and when: this run's own booth, tomorrow, the first free time, 15 minutes.
  await page.getByRole("button", { name: f.resourceTypeName }).click();
  await page.getByRole("button", { name: bookingDayLabel(), exact: true }).click();
  const firstSlot = page.getByRole("button", { name: /^10:00 am$/ });
  await expect(firstSlot).toBeEnabled();
  await firstSlot.click();
  await page.getByLabel("Or another length").selectOption({ label: "15 min" });
  await expect(page.getByLabel(`Which ${f.resourceTypeName}?`)).toContainText("Any available");

  // A quote appears before any details are given: $30/hr for 15 min, less the 10% weekday happy hour.
  const total = page.getByText("Total to pay").locator("xpath=following-sibling::span");
  await expect(total).toHaveText(/\$\d/);
  const beforeCode = await total.textContent();

  // 2. Details and a referral code.
  await page.getByLabel("Name").fill(`E2E Web Guest ${f.run}`);
  await page.getByRole("textbox", { name: /^Email/ }).fill(f.customerEmail);
  await page.getByLabel("Referral code").fill(f.usedUpCode);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("That code has already been fully used.")).toBeVisible();
  await page.getByLabel("Referral code").fill(f.freeCode);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(new RegExp(`Code ${f.freeCode} applied`, "i"))).toBeVisible();
  await expect(total).toHaveText("$0.00");
  expect(beforeCode).not.toBe("$0.00");
  await shot(page, "web-02-quote");

  // 3. Confirm: nothing to pay, so no Stripe. The terms have to be accepted first.
  const confirm = page.getByRole("button", { name: /Confirm booking/ });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText("Your booking is confirmed")).toBeVisible();
  const ref = (await page.getByTestId("booking-ref").textContent())!.trim();
  expect(ref).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  await expect(page.getByTestId("booking-qr")).toBeVisible();
  await expect(page.getByText(f.resourceTypeName)).toBeVisible();
  await shot(page, "web-03-confirmed");
  const bookingUrl = page.url();

  // The time is no longer offered to anyone else.
  await page.goto("/book");
  await page.getByRole("button", { name: f.resourceTypeName }).click();
  await page.getByRole("button", { name: bookingDayLabel(), exact: true }).click();
  await expect(page.getByRole("button", { name: /^10:00 am$/ })).toBeEnabled(); // the second booth is still free

  // The link only works with its own code.
  await page.goto(`/booking/${ref}?token=not-the-right-token-at-all`);
  await expect(page.getByRole("alert").filter({ hasText: /Booking not found/i })).toBeVisible();

  // 4. Cancel with a refund preview.
  await page.goto(bookingUrl);
  await page.getByRole("link", { name: "Cancel this booking" }).click();
  await expect(page.getByRole("heading", { name: `Cancel booking ${ref}` })).toBeVisible();
  await expect(page.getByText("Cancelled at least 24 hours before the start: full refund.")).toBeVisible();
  await shot(page, "web-04-cancel");
  await page.getByRole("button", { name: /Cancel and refund/ }).click();
  await expect(page.getByText(`Booking ${ref} is cancelled`)).toBeVisible();

  await page.goto(bookingUrl);
  await expect(page.getByText("This booking is cancelled")).toBeVisible();
});

test("the legal pages explain the rules", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Cancellations & refunds" }).click();
  await expect(page.getByRole("heading", { name: "Cancellations and refunds" })).toBeVisible();
  await expect(page.getByText(/24 hours or more before the start/)).toBeVisible();
  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { name: "Terms" })).toBeVisible();
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByText(/Payments are handled by Stripe/)).toBeVisible();
});
