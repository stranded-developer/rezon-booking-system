/**
 * A real payment on Stripe test mode, end to end in the browser.
 * Needs E2E_STRIPE=1 and `stripe listen --forward-to localhost:8787/webhooks/stripe`,
 * because the booking is confirmed by the webhook.
 */
import { expect, test, type Page } from "@playwright/test";
import { loadFixture, localSupabase } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

test.skip(process.env.E2E_STRIPE !== "1", "Set E2E_STRIPE=1 and run `stripe listen` to test a real payment");

/** Three days out: always more than 24 hours away, and a different day from the free-booking test. */
function payDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day") + 3)).toISOString().slice(0, 10);
}

const dayLabel = () => {
  const [y, m, d] = payDate().split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(Date.UTC(y!, m! - 1, d!)))
    .replace(/,/g, "");
};

test("a guest pays by card on Stripe and the booking is confirmed, then refunded on cancel", async ({ page }) => {
  const f = loadFixture();
  const db = localSupabase();

  await page.goto("/book");
  await page.getByRole("button", { name: f.resourceTypeName }).click();
  await page.getByRole("button", { name: dayLabel(), exact: true }).click();
  await page.getByRole("button", { name: /^11:00 am$/ }).click();
  await page.getByRole("button", { name: "30 min", exact: true }).click();
  await page.getByLabel("Name").fill(`E2E Card Guest ${f.run}`);
  await page.getByRole("textbox", { name: /^Email/ }).fill(f.customerEmail);

  const total = page.getByText("Total to pay").locator("xpath=following-sibling::span");
  await expect(total).toHaveText(/\$\d+\.\d\d/);
  const amount = (await total.textContent())!.trim();
  expect(amount).not.toBe("$0.00");

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: `Pay ${amount}` }).click();

  // ── Stripe Checkout ───────────────────────────────────────────────────────
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await expect(page.getByText(f.resourceTypeName).first()).toBeVisible();
  await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await page.getByPlaceholder("MM / YY").fill("12" + String(new Date().getFullYear() + 2).slice(2));
  await page.getByPlaceholder("CVC").fill("123");
  const nameOnCard = page.getByPlaceholder("Full name on card");
  if (await nameOnCard.isVisible().catch(() => false)) await nameOnCard.fill(`E2E Card Guest ${f.run}`);
  await shot(page, "web-05-stripe-checkout");
  await page.getByTestId("hosted-payment-submit-button").click();

  // ── Back on the booking page, confirmed by the webhook ────────────────────
  await page.waitForURL(/\/booking\/[A-Z0-9]{6}\?/, { timeout: 90_000 });
  await expect(page.getByText("Your booking is confirmed")).toBeVisible({ timeout: 60_000 });
  const ref = (await page.getByTestId("booking-ref").textContent())!.trim();
  await expect(page.getByTestId("booking-qr")).toBeVisible();
  await expect(page.getByText("Paid").locator("xpath=following-sibling::span")).toHaveText(amount);
  await shot(page, "web-06-paid-confirmed");

  // The money is recorded against the booking, through Stripe.
  const { data: booking } = await db.from("bookings").select("id, status, total_cents, stripe_payment_intent_id").eq("ref", ref).single();
  expect(booking!.status).toBe("confirmed");
  expect(booking!.stripe_payment_intent_id).toMatch(/^pi_/);
  const { data: payment } = await db.from("payments").select("id, amount_cents, method, external_ref").eq("booking_id", booking!.id).single();
  expect(payment).toMatchObject({ method: "stripe", amount_cents: booking!.total_cents });
  expect(payment!.external_ref).toBe(booking!.stripe_payment_intent_id);

  // ── Cancel more than 24 hours ahead: full refund on Stripe ────────────────
  await page.getByRole("link", { name: "Cancel this booking" }).click();
  await expect(page.getByText("Cancelled at least 24 hours before the start: full refund.")).toBeVisible();
  await page.getByRole("button", { name: `Cancel and refund ${amount}` }).click();
  await expect(page.getByText(`Booking ${ref} is cancelled`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`We've refunded ${amount} to your card`, { exact: false })).toBeVisible();
  await shot(page, "web-07-refunded");

  const { data: refund } = await db.from("refunds").select("amount_cents, stripe_refund_id").eq("payment_id", payment!.id).single();
  expect(refund!.amount_cents).toBe(booking!.total_cents);
  expect(refund!.stripe_refund_id).toMatch(/^re_/);
});
