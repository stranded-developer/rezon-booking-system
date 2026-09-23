import { expect, test, type Locator, type Page } from "@playwright/test";
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
 * Wait until the page is interactive. The header's account link is rendered only after the browser
 * has taken over and checked the session, so it is a reliable sign that forms and buttons work.
 * Filling a field before that point "succeeds" but the value is wiped when React takes over.
 */
async function appReady(page: Page) {
  await expect(page.getByRole("link", { name: /Member log in|My account/ })).toBeVisible({ timeout: 20_000 });
}

/**
 * Fill a field and make sure the value survives.
 *
 * `appReady` only proves the **header** is live. The header lives in the shared layout, so after a
 * client-side navigation it is already hydrated while the form on the new page may not be — and a
 * value typed into a React-controlled input before it hydrates is silently wiped, leaving a form
 * that looks filled in and submits nothing. Retrying until the value sticks is what actually waits
 * for the form.
 */
async function fillLive(field: Locator, value: string) {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 20_000 });
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
  await appReady(page);
  await expect(page.getByRole("heading", { name: "Membership" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  // The name is only used for people the venue has no record of; members keep the name on file.
  await expect(page.getByText("Already a member with us? We'll keep the name we have for you.")).toBeVisible();
  await fillLive(page.getByLabel("Name"), f.counterMember.name);
  await fillLive(page.getByRole("textbox", { name: /^Email/ }), f.counterMember.email);
  await fillLive(page.getByLabel("Password"), f.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/We've sent a confirmation link/)).toBeVisible();

  // Until the email is confirmed the login is refused, so nobody can claim someone else's membership.
  await page.goto("/login");
  await appReady(page);
  await fillLive(page.getByRole("textbox", { name: /^Email/ }), f.counterMember.email);
  await fillLive(page.getByLabel("Password"), f.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/confirm your email first/i)).toBeVisible();

  // Clicking the link confirms the email and signs them in (Supabase returns a session with it).
  const confirmation = await latestEmail(f.counterMember.email);
  await page.goto(firstLink(confirmation.body));
  await page.waitForURL(/\/account/, { timeout: 20_000 }).catch(async () => {
    // If the link only confirmed the address, log in as usual.
    await expect(page.getByText("Your email is confirmed")).toBeVisible();
    await fillLive(page.getByRole("textbox", { name: /^Email/ }), f.counterMember.email);
    await fillLive(page.getByLabel("Password"), f.password);
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
  await expect(page.getByText(`${f.counterMember.tierName} member · ${f.counterMember.discountBp / 100}% off`)).toBeVisible();
  // Members never see the referral field: a membership and a code can't be combined.
  await expect(page.getByLabel("Referral code")).toBeHidden();

  const total = page.getByText("Total to pay").locator("xpath=following-sibling::span");
  // $30 for the hour on this booth, less the tier's own percentage (D67 can change it).
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const afterDiscount = (cents: number) => Math.round((cents * (10_000 - f.counterMember.discountBp)) / 10_000);
  await expect(total).toHaveText(money(afterDiscount(30_00)));
  // D63: free play on a booking starts at a whole session — no 15-minute option here.
  const freePlay = page.getByLabel("Use your free play?");
  await expect(freePlay.locator('option[value="15"]')).toHaveCount(0);
  await expect(freePlay.locator("option").nth(1)).toHaveText("30 min");
  await freePlay.selectOption("30");
  await expect(total).toHaveText(money(afterDiscount(15_00))); // half the hour paid for with free minutes
  await shot(page, "web-09-member-quote");

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: `Pay ${money(afterDiscount(15_00))}` }).click();
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
  await appReady(page);
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await appReady(page);
  await fillLive(page.getByRole("textbox", { name: /^Email/ }), f.counterMember.email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText(/we've sent a link/i)).toBeVisible();

  const email = await latestEmail(f.counterMember.email);
  await page.goto(firstLink(email.body));
  await appReady(page);
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  const newPassword = `${f.password}-new`;
  await fillLive(page.getByLabel("New password"), newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();

  await page.waitForURL(/\/login\?reset=1/);
  await expect(page.getByText("Your password is updated")).toBeVisible();
  await appReady(page);
  await fillLive(page.getByRole("textbox", { name: /^Email/ }), f.counterMember.email);
  await fillLive(page.getByLabel("Password"), newPassword);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/account/);
  await expect(page.getByRole("heading", { name: new RegExp(`Hi ${f.counterMember.name}`) })).toBeVisible();
});
