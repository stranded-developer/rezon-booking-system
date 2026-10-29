/**
 * The 12-month plan (D114) sold through real Stripe Checkout (test mode): 12 monthly payments, then it stops.
 * Needs the same as membership.spec.ts: `stripe listen` forwarding to the API, and E2E_STRIPE=1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import { loadFixture, localSupabase } from "./fixture";

test.skip(process.env.E2E_STRIPE !== "1", "Set E2E_STRIPE=1 with `stripe listen` forwarding to run the real Stripe checkout test");
test.setTimeout(240_000);

/** Twelve months after Stripe's billing anchor, clamped to the month's last day like Stripe's own periods. */
const twelveMonthsOn = (anchor: number) => {
  const a = new Date(anchor * 1000);
  const last = new Date(Date.UTC(a.getUTCFullYear() + 1, a.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(a.getUTCFullYear() + 1, a.getUTCMonth(), Math.min(a.getUTCDate(), last), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds()) / 1000;
};

test("sell a 12-month plan on the customer's phone: Stripe stops it after 12 payments, and it isn't 'cancelling'", async ({ page, context }) => {
  const f = loadFixture();
  const db = localSupabase();
  const apiEnv = readFileSync(resolve("../api/.env.local"), "utf8");
  const stripe = new Stripe(/^STRIPE_SECRET_KEY=(\S+)$/m.exec(apiEnv)![1]!);
  const email = `e2e-term-${f.run}@raceground.test`;
  const name = `E2E Term ${f.run}`;

  try {
    await page.goto("/");
    await page.getByLabel("Staff email").fill(f.owner.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: new RegExp(f.owner.name) }).click();
    for (const d of f.owner.pin) await page.keyboard.press(d);
    await page.getByRole("link", { name: "Back office", exact: true }).click();
    await page.getByRole("link", { name: "Membership tiers", exact: true }).click();
    await page.getByRole("button", { name: "Sync with Stripe" }).click();
    await expect(page.getByText(/Synced \d tiers with Stripe/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "← Back to the floor" }).click();

    await page.getByRole("button", { name: "Sell membership" }).click();
    const sale = page.getByRole("dialog");
    await sale.getByRole("button", { name: "12 months, paid monthly" }).click();
    await expect(sale).toContainText("12 monthly payments, then it stops by itself");
    await sale.getByRole("button", { name: /Silver/ }).click();
    await sale.getByLabel("Name").fill(name);
    await sale.getByLabel("Email").fill(email);
    await page.screenshot({ path: "test-results/screens/membership-12-01-plan.png" });
    await sale.getByRole("button", { name: "Show payment QR" }).click();
    const checkoutUrl = (await page.getByTestId("checkout-link").getAttribute("href"))!;

    const phone = await context.newPage();
    await phone.goto(checkoutUrl);
    await phone.locator("#cardNumber").fill("4242424242424242");
    await phone.locator("#cardExpiry").fill("12 / 34");
    await phone.locator("#cardCvc").fill("123");
    await phone.locator("#billingName").fill(name);
    await phone.locator("#billingCountry").selectOption("AU");
    await phone.getByTestId("hosted-payment-submit-button").click();
    await phone.waitForURL(/\/checkout\/complete/, { timeout: 90_000 });

    await expect(page.getByTestId("membership-active")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("membership-active")).toContainText(/\d+ min free play ready/, { timeout: 150_000 });

    const { data: member } = await db
      .from("members")
      .select("id, status, stripe_subscription_id, term_ends_at, customers!inner(email)")
      .eq("customers.email", email)
      .single();
    const sub = await stripe.subscriptions.retrieve(member!.stripe_subscription_id!);
    expect(sub.metadata.term_months).toBe("12");
    expect(sub.cancel_at).toBe(twelveMonthsOn(sub.billing_cycle_anchor));
    expect(sub.cancel_at_period_end).toBe(false);
    expect(member!.status).toBe("active");
    expect(Date.parse(member!.term_ends_at!)).toBe(sub.cancel_at! * 1000);
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Back office", exact: true }).click();
    await page.getByRole("link", { name: "Members", exact: true }).click();
    await page.getByPlaceholder("Search name, email or phone").fill(name);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("row", { name: new RegExp(name) }).click();
    await expect(page.getByTestId("member-term")).toContainText("12-month plan, paid monthly");
    await page.screenshot({ path: "test-results/screens/membership-12-02-back-office.png" });
  } finally {
    const { data } = await db.from("members").select("stripe_subscription_id, customers!inner(email)").eq("customers.email", email).maybeSingle();
    if (data?.stripe_subscription_id) await stripe.subscriptions.cancel(data.stripe_subscription_id).catch(() => undefined);
  }
});
