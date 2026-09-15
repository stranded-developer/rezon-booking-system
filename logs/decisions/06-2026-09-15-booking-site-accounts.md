# Raceground — Decisions Log #6 — Booking Site, Accounts, Hosting Questions

**Date:** 2026-09-15
**Status:** D54 follows the owner's answer in chat. D55–D57 were made by the developer during Phase 6b and are recorded here for review.

---

## D54 — Booking reminders go out once a day, for tomorrow's bookings ✅ owner 2026-09-15

**Decision:**
- Change: the reminder is no longer sent exactly 24 hours before each booking.
- A **daily job** emails everyone with a **confirmed booking tomorrow** (venue date). Suggested run time is about 09:00 Sydney.
- Each booking gets at most one reminder, even if the job runs twice.

**Why:**
- The owner asked whether Vercel's once-a-day scheduled jobs are enough.
- With this change, every scheduled job fits a daily schedule: balance forfeit, booking reminders, and the optional hold cleanup.
- An hourly reminder would need Vercel Pro's hourly cron, or Supabase pg_cron.

**Note:** Vercel's free Hobby plan is for non-commercial use. A business taking payments most likely needs Pro regardless of cron limits. Confirm before go-live.

## D55 — Three Vercel projects (booking site, POS, API) are kept

**Decision:** Keep the API as its own project.

**Why:**
- The API holds the secret keys (Stripe, Supabase service role) and does every money write, so it can never run in a browser.
- As a separate project, a site or POS release can't break the other app.
- Vercel bills per team member, not per project, and all three deploy from the same GitHub repo.
- The API could later be folded into the booking site project if wanted; nothing in the code depends on the split.

## D56 — Booking-site logins are linked to customers only after the email is confirmed

**Decision:**
- A Supabase login becomes a customer account on first use. It is linked to the customer with the same email: counter-sold members and earlier guest bookings join it.
- This happens only if Supabase shows the email as confirmed.
- Staff logins are refused on the booking site.
- Email confirmation is switched on (local config). **It must stay on in the hosted Supabase project.**
- Counter-sold members get online access by signing up with the email they gave at the counter. The welcome email says so.

**Why:** Without confirmation, anyone could register a member's email address and take over their membership, free minutes and QR.

## D57 — Member QR codes are re-showable (derived from a server secret)

**Decision:**
- The member QR token is `HMAC(QR_TOKEN_SECRET, member id + version)`. Only its hash is stored, as before.
- The account page shows the same QR every time. An active member without a card gets one automatically.
- "Reissue" (member or back office) moves to the next version, and every older QR stops working.
- The cashier's **Print card** prints the member's existing QR instead of replacing it.

**Why:** The spec puts the QR on the member's account page. With random tokens stored only as hashes, the page could never show the QR again without invalidating the printed card.

**Note:** Changing `QR_TOKEN_SECRET` invalidates every member QR, so treat it like a password and never rotate it casually.
