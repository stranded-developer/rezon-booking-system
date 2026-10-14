# Step 56 — The venue gets an email for every confirmed booking

**Date:** 2026-10-14
**Decisions:** [D105](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- Migration `20261014003400_booking_alert_email.sql`: `venue_settings.booking_alert_email` (null = no alerts, a basic email-shape check), set to racegrounds@gmail.com where empty.
- API: when a booking is confirmed (a $0 booking at once, a paid one when Stripe's webhook arrives), `sendBookingConfirmation` also emails the alert address (`booking_alert`, once per booking): code, what and which simulator/table, day and times, setup, amount paid, free play used, and the customer's name, email and phone. It goes even when the customer gave only a phone number. Like every email, a failed send never fails the booking.
- Back office → Venue & hours → **Booking alerts to** (empty = none); the API refuses an address that isn't one, and the public config never shows it.
- Spec: `back-office.md`, `booking-site.md`, `data-model.md`.

**Verified**

1. API test: with an alert address set, a confirmed booking sends the alert to it with the code, day and time, name, email, phone and amount, and the customer still gets their confirmation; with none set, no alert. The test uses its own $0 code and puts the setting back.
2. API test: "nope" is refused as the alert address; `/public/config` contains nothing about it.
3. POS browser test: the field shows the saved address, a new one saves to the database, then the original is restored.
4. **Gate:** see the commit for this step.

**For the live site**

- `supabase db push` before deploying the API (new column). The migration sets racegrounds@gmail.com.
