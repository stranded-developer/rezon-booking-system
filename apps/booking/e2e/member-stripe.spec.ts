/**
 * Joining a membership online, paid on Stripe test mode (D60: account first, then pay).
 * Needs E2E_STRIPE=1 and `stripe listen --forward-to localhost:8787/webhooks/stripe`.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { loadFixture, localSupabase } from "./fixture";
import { clearInbox, firstLink, latestEmail } from "./mailpit";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

test.skip(process.env.E2E_STRIPE !== "1", "Set E2E_STRIPE=1 and run `stripe listen` to test joining online");

/** Tiers can only be sold once they exist as Stripe products; a superadmin syncs them. */
async function syncTiersWithStripe() {
  const f = loadFixture();
  const db = localSupabase();
  const { data: tiers } = await db.from("membership_tiers").select("stripe_price_id").eq("active", true);
  if (tiers?.every((t) => t.stripe_price_id !== null)) return;

  const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", { auth: { persistSession: false } });
  const { data: signedIn, error } = await anon.auth.signInWithPassword({ email: f.staff.email, password: f.password });
  if (error || !signedIn.session) throw new Error(`Could not sign in the sync staff: ${error?.message}`);
  const jwt = signedIn.session.access_token;

  const operator = await fetch(`${API_URL}/pos/operator`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ staffId: f.staff.id, pin: f.staff.pin }),
  });
  const { token } = (await operator.json()) as { token: string };
  const synced = await fetch(`${API_URL}/admin/billing/sync-catalog`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "X-Operator-Token": token, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!synced.ok) throw new Error(`Tier sync failed: ${synced.status} ${await synced.text()}`);
}

test("someone joins Silver online: account first, then pays on Stripe", async ({ page }) => {
  const f = loadFixture();
  const db = localSupabase();
  await syncTiersWithStripe();
  await clearInbox(f.joiner.email);

  // ── No account yet: the membership page sends them to sign up first (D60) ──
  await page.goto("/membership");
  await page.getByRole("button", { name: "Join Silver" }).click();
  await page.waitForURL(/\/signup/);
  await expect(page.getByText(/Memberships need an account/)).toBeVisible();
  await page.getByLabel("Name").fill(f.joiner.name);
  await page.getByRole("textbox", { name: /^Email/ }).fill(f.joiner.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/We've sent a confirmation link/)).toBeVisible();

  const confirmation = await latestEmail(f.joiner.email);
  await page.goto(firstLink(confirmation.body));
  await page.waitForURL(/\/account/, { timeout: 20_000 }).catch(async () => {
    await page.getByRole("textbox", { name: /^Email/ }).fill(f.joiner.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/account/);
  });
  await expect(page.getByRole("heading", { name: "No membership yet" })).toBeVisible();

  // ── Pay for Silver on Stripe ──────────────────────────────────────────────
  await page.getByRole("link", { name: "See the tiers" }).click();
  await page.getByRole("button", { name: "Join Silver" }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await expect(page.getByText(/Silver/).first()).toBeVisible();
  await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await page.getByPlaceholder("MM / YY").fill("12" + String(new Date().getFullYear() + 2).slice(2));
  await page.getByPlaceholder("CVC").fill("123");
  const nameOnCard = page.getByPlaceholder("Full name on card");
  if (await nameOnCard.isVisible().catch(() => false)) await nameOnCard.fill(f.joiner.name);
  await shot(page, "web-10-membership-checkout");
  await page.getByTestId("hosted-payment-submit-button").click();

  // ── Back on the account, active once Stripe's webhook lands ───────────────
  await page.waitForURL(/\/account/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Silver membership" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Active")).toBeVisible();
  await expect(page.getByText("5% off every session")).toBeVisible();
  await expect(page.getByTestId("member-qr")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 hour")).toBeVisible(); // 60 free minutes granted with the first invoice
  await expect(page.getByRole("button", { name: "Card and invoices" })).toBeVisible();
  await shot(page, "web-11-membership-active");

  // The membership is real in the database, billed through Stripe.
  const { data: customer } = await db.from("customers").select("id, stripe_customer_id").eq("email", f.joiner.email).single();
  const { data: member } = await db.from("members").select("status, stripe_subscription_id, qr_token_hash").eq("customer_id", customer!.id).single();
  expect(member!.status).toBe("active");
  expect(member!.stripe_subscription_id).toMatch(/^sub_/);
  expect(customer!.stripe_customer_id).toMatch(/^cus_/);

  // ── Cancel at period end, then change their mind ──────────────────────────
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Cancel membership" }).click();
  await expect(page.getByText(/ends at the end of this period/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Active until the end of this period")).toBeVisible();
  await page.getByRole("button", { name: "Keep my membership" }).click();
  await expect(page.getByText(/will keep going/)).toBeVisible({ timeout: 30_000 });
});
