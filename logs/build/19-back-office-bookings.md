# Phase 6c-4 — Back office Bookings page

**Date:** 2026-09-15

**Done**

The last piece of Phase 6: the screen for the booking endpoints built in 6b-2. It lives in the POS app at `/admin/bookings` and needs a superadmin, like the rest of the back office.

- **A day at a time:** arrows and a date box, plus "Today". Each row shows the time, what was booked, the customer (with booking code and member number), the status, what was paid and any refund.
- **Search** by booking code, name, email or phone within the day.
- **Open a booking** to see the customer's contact details, free play used, what was paid and how, then cancel it:
  - the **policy refund right now** is quoted by the API and shown before anything is done ("$13.50 of $27.00 (half, 14 h before the start)")
  - **"Our fault"** re-quotes it as a full refund with the free minutes returned, at any time, including inside the 2-hour window
  - **"Set the refund myself"** takes an amount up to what was paid, with an optional return of the free minutes
  - a **reason is required** (at least 3 characters); it goes in the audit log and in the email to the customer
- Cancelled or expired bookings say so instead of offering the form.

Nothing new was needed in the API or the database: this step is the screen for what 6b-2 already checked and audited.

**Verified**
1. **POS e2e `bookings-admin.spec.ts`:** a superadmin opens Bookings, changes the day, finds the booking (its code, customer, table and time), searches for it, gets an empty list for a code that isn't there, opens it and sees the half-refund policy quoted, can't cancel without a reason, marks it as the venue's fault (the quote changes to the venue rule), cancels it, and sees the row turn to "cancelled". The database then shows the status, reason and the staff member who did it, and the audit log has the same reason against them. Re-opening says it's already cancelled.
   - **Inside 2 hours:** a second booking starting within the hour shows "less than 2 hours before the start"; cancelling without marking it as the venue's fault is refused by the API with a message about the 2-hour rule, and ticking "Our fault" then cancels it.
   - The fixtures are built relative to now (3 hours and 1 hour ahead, each on its own table), so the test means the same thing whatever time it runs.
2. **Mutation check, 7 deliberate breaks, 7 killed:** reason not required, venue fault not sent to the API, quote ignores venue fault, day filter ignored, search ignored, cancelled bookings still look cancellable, reason not passed on.
   - "Venue fault not sent" survived the first version of the test, because a free booking three hours out cancels the same either way. The "inside 2 hours" case was added for exactly that, and it kills the mutation.
   - The "set the refund myself" path is exercised by the API tests (`admin.integration`/`bookings-stripe`), including a real Stripe refund; the screen only passes the amount through.
3. The POS suite ran **twice in a row: 4 passed, 1 skipped both times**. The skipped one is the walk-in test, which only runs between 10:00 and 20:45 Sydney time.
4. **Gate** (clean `db reset`, same command as the commit): pgTAP 372 · turbo 11/11 (pricing 78, API 161) · POS e2e 4 passed + 1 skipped · booking site e2e 7 passed.

**Issues found and fixed**
1. The first version of the test used a booking at a fixed time of day, which fell into a different refund window depending on when the suite ran. The fixtures are now relative to the current time.
2. Test-only: the date box needed a more specific selector (the day arrows share its label), and the cancelled-by column is `cancelled_by_staff_id`.

**Phase 6 is complete.** Online booking works end to end: database rules (6a), API and payments (6b), the website for guests and members (6c-2, 6c-3), and the staff view of it (6c-4).

**Not built yet**
- Reports, real emails through Resend, the final legal wording, and the deploy to Vercel and hosted Supabase — all Phase 7.
