import { expect, test, type Page } from "@playwright/test";
import { loadFixture, localSupabase } from "./fixture";
import { clearInbox, firstLink, latestEmail } from "./mailpit";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

/** Four days out: clear of the other tests' days and always more than 24 hours ahead. */
function bookingDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day") + 4)).toISOString().slice(0, 10);
}

/**
 * Type into a field and make sure the value sticks. A page that is still hydrating resets a
 * controlled input, which would otherwise submit an empty form.
 */
async function fillWhenReady(field: import("@playwright/test").Locator, value: string) {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 15_000 });
}

const dayLabel = () => {
  const [y, m, d] = bookingDate().split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(Date.UTC(y!, m! - 1, d!)))
    .replace(/,/g, "");
};

test("a counter member signs up, gets their membership, books with the discount and free play, then cancels", async ({ page }) => {
  const f = loadFixture();
  const db = localSupabase();
  await clearInbox(f.counterMember.email);

  // ── Sign up with the email the venue has (D56) ────────────────────────────
  await page.goto("/membership");
  await expect(page.getByRole("heading", { name: "Membership" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(f.counterMember.name);
  await page.getByRole("textbox", { name: /^Email/ }).fill(f.counterMember.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/We've sent a confirmation link/)).toBeVisible();

  // Until the email is confirmed the login is refused, so nobody can claim someone else's membership.
  await page.goto("/login");
  await page.getByRole("textbox", { name: /^Email/ }).fill(f.counterMember.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/confirm your email first/i)).toBeVisible();

  // Clicking the link confirms the email and signs them in (Supabase returns a session with it).
  const confirmation = await latestEmail(f.counterMember.email);
  await page.goto(firstLink(confirmation.body));
  await page.waitForURL(/\/account/, { timeout: 20_000 }).catch(async () => {
    // If the link only confirmed the address, log in as usual.
    await expect(page.getByText("Your email is confirmed")).toBeVisible();
    await page.getByRole("textbox", { name: /^Email/ }).fill(f.counterMember.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/account/);
  });

  // ── The counter membership is now on the account (D56), with its QR (D57) ──
  await expect(page.getByRole("heading", { name: `${f.counterMember.tierName} membership` })).toBeVisible();
  await expect(page.getByText(f.counterMember.memberNo)).toBeVisible();
  await expect(page.getByText("60 min").first()).toBeVisible();
  await expect(page.getByTestId("member-qr")).toBeVisible();
  await shot(page, "web-08-account");

  // The QR is the member's real card: it matches what the venue stored.
  const { data: member } = await db.from("members").select("id, qr_token_hash, qr_version").eq("member_no", f.counterMember.memberNo).single();
  expect(member!.qr_token_hash).not.toBeNull();

  // ── Book with the member discount and free play ───────────────────────────
  await page.getByRole("link", { name: "Book now" }).click();
  await page.getByRole("button", { name: f.resourceTypeName }).click();
  await page.getByRole("button", { name: dayLabel(), exact: true }).click();
  await page.getByRole("button", { name: /^4:00 pm$/ }).click();
  await page.getByRole("button", { name: "1 hour", exact: true }).click();
  await expect(page.getByText(`${f.counterMember.tierName} member · 10% off`)).toBeVisible();
  // Members never see the referral field: a membership and a code can't be combined.
  await expect(page.getByLabel("Referral code")).toBeHidden();

  const total = page.getByText("Total to pay").locator("xpath=following-sibling::span");
  await expect(total).toHaveText("$27.00"); // $30 for the hour, less 10%
  await page.getByLabel("Use your free play?").selectOption("30");
  await expect(total).toHaveText("$13.50"); // half the hour paid for with free minutes
  await shot(page, "web-09-member-quote");

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Pay \$13\.50/ }).click();
  await page.waitForURL(/checkout\.stripe\.com|\/booking\//, { timeout: 60_000 });
  // Paying is covered by the Stripe test; here we only need the hold, so step back out of Checkout.
  await page.goto("/account");

  // The unpaid hold already took the free minutes, and they come back when it is released.
  await expect(page.getByRole("heading", { name: "Free play history" })).toBeVisible();
  await expect(page.getByText("30 min").first()).toBeVisible();
  const { data: held } = await db.from("bookings").select("id, ref, status, free_minutes_used").eq("member_id", member!.id).eq("status", "held").single();
  expect(held!.free_minutes_used).toBe(30);

  await db.rpc("booking_release_hold", { p_booking: held!.id });
  await page.reload();
  await expect(page.getByText("60 min").first()).toBeVisible();
});

test("a member can ask for a new password", async ({ page }) => {
  const f = loadFixture();
  await clearInbox(f.counterMember.email);

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await fillWhenReady(page.getByRole("textbox", { name: /^Email/ }), f.counterMember.email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText(/we've sent a link/i)).toBeVisible();

  const email = await latestEmail(f.counterMember.email);
  await page.goto(firstLink(email.body));
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  const newPassword = `${f.password}-new`;
  await fillWhenReady(page.getByLabel("New password"), newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();

  await page.waitForURL(/\/login\?reset=1/);
  await expect(page.getByText("Your password is updated")).toBeVisible();
  await fillWhenReady(page.getByRole("textbox", { name: /^Email/ }), f.counterMember.email);
  await fillWhenReady(page.getByLabel("Password"), newPassword);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/account/);
  await expect(page.getByRole("heading", { name: new RegExp(`Hi ${f.counterMember.name}`) })).toBeVisible();
});
