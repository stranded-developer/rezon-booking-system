/**
 * Real membership sale through Stripe Checkout (test mode).
 * Needs: STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET in apps/api/.env.local and
 * `stripe listen --forward-to localhost:8787/webhooks/stripe` running. Run with E2E_STRIPE=1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import { loadFixture, localSupabase } from "./fixture";

const enabled = process.env.E2E_STRIPE === "1";

test.skip(!enabled, "Set E2E_STRIPE=1 with `stripe listen` forwarding to run the real Stripe checkout test");

test("sell a membership at the counter: Stripe sync, QR checkout paid by card, active, card printed, cancel and undo", async ({ page, context }) => {
  test.setTimeout(240_000);
  const f = loadFixture();
  const db = localSupabase();
  const apiEnv = readFileSync(resolve("../api/.env.local"), "utf8");
  const stripe = new Stripe(/^STRIPE_SECRET_KEY=(\S+)$/m.exec(apiEnv)![1]!);
  const email = `e2e-sale-${f.run}@raceground.test`;
  const name = `E2E Sale ${f.run}`;

  try {
    // Owner signs in and syncs tiers with Stripe.
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

    // Counter: sell Silver.
    await page.getByRole("link", { name: "← Back to the floor" }).click();
    await page.getByRole("button", { name: "Sell membership" }).click();
    const sale = page.getByRole("dialog");
    await sale.getByRole("button", { name: /Silver/ }).click();
    await sale.getByLabel("Name").fill(name);
    await sale.getByLabel("Email").fill(email);
    await sale.getByRole("button", { name: "Show payment QR" }).click();
    await expect(page.getByTestId("checkout-qr").locator("svg")).toBeVisible();
    await page.screenshot({ path: "test-results/screens/membership-01-qr.png" });
    const checkoutUrl = (await page.getByTestId("checkout-link").getAttribute("href"))!;
    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    // The customer's phone: Stripe Checkout, test Visa.
    const phone = await context.newPage();
    await phone.goto(checkoutUrl);
    await phone.locator("#cardNumber").fill("4242424242424242");
    await phone.locator("#cardExpiry").fill("12 / 34");
    await phone.locator("#cardCvc").fill("123");
    await phone.locator("#billingName").fill(name);
    await phone.locator("#billingCountry").selectOption("AU");
    await expect(phone.locator("body")).toContainText("100.00");
    await expect(phone.locator("body")).not.toContainText("IDR");
    await phone.screenshot({ path: "test-results/screens/membership-02-stripe-checkout.png", fullPage: true });
    await phone.getByTestId("hosted-payment-submit-button").click();
    await phone.waitForURL(/\/checkout\/complete/, { timeout: 90_000 });
    await expect(phone.getByRole("heading", { name: "You're in!" })).toBeVisible();

    // Back at the counter the POS notices the webhook and shows the member active.
    await expect(page.getByTestId("membership-active")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("membership-active")).toContainText("Silver");
    // The free minutes are granted by a second webhook (invoice.paid), which can land a little after
    // the one that activates the membership; the screen fills in when it does.
    await expect(page.getByTestId("membership-active")).toContainText("60 min free play ready", { timeout: 60_000 });
    await page.screenshot({ path: "test-results/screens/membership-03-active.png" });
    await page.getByRole("button", { name: "Print member card" }).click();
    // Printing the first card asks the API for a new token, so allow for a round trip.
    await expect(page.getByTestId("member-qr").locator("svg")).toBeVisible({ timeout: 15_000 });

    // Database: active, $100 Stripe payment, 60-minute grant.
    const { data: member } = await db
      .from("members")
      .select("id, status, stripe_subscription_id, qr_token_hash, customers!inner(email)")
      .eq("customers.email", email)
      .single();
    expect(member).toMatchObject({ status: "active" });
    expect(member!.qr_token_hash).not.toBeNull();
    const { data: payments } = await db.from("payments").select("amount_cents, method").eq("member_id", member!.id);
    expect(payments).toEqual([{ amount_cents: 10000, method: "stripe" }]);
    await page.keyboard.press("Escape");

    // Back office: cancel at the end of the paid month, then undo.
    await page.getByRole("link", { name: "Back office", exact: true }).click();
    await page.getByRole("link", { name: "Members", exact: true }).click();
    await page.getByPlaceholder("Search name, email or phone").fill(name);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("row", { name: new RegExp(name) }).click();
    const detail = page.getByRole("dialog");
    await expect(detail).toContainText("Billed monthly through Stripe");
    await detail.getByRole("button", { name: "Cancel at end of paid month" }).click();
    await expect(detail).toContainText("Benefits continue until then");
    await expect(detail.getByText("cancelling", { exact: true })).toBeVisible();
    expect((await stripe.subscriptions.retrieve(member!.stripe_subscription_id!)).cancel_at_period_end).toBe(true);
    await detail.getByRole("button", { name: "Keep membership (undo cancel)" }).click();
    await expect(detail).toContainText("keep renewing");
    expect((await stripe.subscriptions.retrieve(member!.stripe_subscription_id!)).cancel_at_period_end).toBe(false);
    await page.screenshot({ path: "test-results/screens/membership-04-back-office.png" });
  } finally {
    // Don't leave a live-looking test subscription running.
    const { data } = await db.from("members").select("stripe_subscription_id, customers!inner(email)").eq("customers.email", email).maybeSingle();
    if (data?.stripe_subscription_id) await stripe.subscriptions.cancel(data.stripe_subscription_id).catch(() => undefined);
  }
});
