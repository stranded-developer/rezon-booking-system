# Raceground — Decisions Log #7 — Booking Website (Phase 6c)

**Date:** 2026-09-15
**Status:** D58–D60 follow the owner's answers in chat before Phase 6c started.

---

## D58 — Venue contact details and photos are editable in the back office ✅ owner 2026-09-15

**Decision:**
- The home page shows the venue's **address, phone, contact email, a short intro and an Instagram link**. A superadmin edits them in **Venue & hours** in the back office, like the business name and ABN.
- **Photos** are uploaded, captioned, ordered and removed in the back office too. The booking site shows them on the home page.
- Photos are kept in **Supabase Storage** (a public `venue-photos` bucket). Only the API uploads or deletes them, like every other write. Visitors can view them but never upload.
- Every change is audited.

**Why:**
- None of these details were in the spec or the database.
- The owner chose back office editing over placeholders so the site can be kept current without a developer.

**Note:** Local Supabase now starts its Storage service. The hosted project gets the bucket from the same migration.

## D59 — The booking website has a lighter public look ✅ owner 2026-09-15

**Decision:**
- The booking site uses a **light background** with the same RACEGROUND wordmark and lime "flag" accent as the POS.
- The POS and back office stay dark.

**Why:** The owner prefers a lighter, consumer-style site for the public.

## D60 — Buying a membership online: account first, then pay ✅ owner 2026-09-15

**Decision:**
- **Guests booking a session never log in.** They give a name plus an email or phone (booking-site.md §3). This is unchanged.
- **Buying a membership on the website** goes: create account → confirm the email → log in → pay on Stripe Checkout.
- This is how the 6b-2 API already works, and it keeps D56 intact: nobody can take over a counter member's membership by signing up with their email.

**Why:** The owner confirmed the order after it was clarified that the question was only about buying a membership, not about booking.
