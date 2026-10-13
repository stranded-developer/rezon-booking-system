# Step 48 — The experience cards follow the owner's mockups

**Date:** 2026-10-13
**Decisions:** [D98](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- **Wording** from `assets/brand/ui-1/2/3.jpeg`, word for word: the lime line, three ticked lines and the button for Single Session, Double Session and Leaderboard Challenge.
  - Migration `20261013003100_experience_card_wording.sql` adds `experiences.button_label` (1–40 characters, or empty for "Book <name>") and moves the three launch experiences to the new wording, **only where they still carry their launch wording**, so text the venue has already changed is left alone. `seed.sql` has the same wording for a fresh database.
  - API: `buttonLabel` on the back office's create/edit (`admin-config.ts`) and in `/public/config` (`bookings.ts`).
  - Back office → Experiences: a **Button text** field; the tagline field says the site prints it in capitals.
- **One card** (`apps/booking/src/components/experience-card.tsx`) for the home page and `/book`, replacing two different ones. Colours as in the mockups: near-black card, white name, lime capitals line and price, "Most popular" green, other badges grey, lime button; the length is written out ("30 minutes", "60 minutes").
- **The big price is the normal one** ($35.00). Happy hour has its own violet box: "HAPPY HOUR $29.00 / 12:00 pm–3:00 pm, every day". It shows the cheapest promotional price that applies by itself (`src/lib/happy-hour.ts`); the student price, which has to be asked for, is not shown here.
- Spec: `booking-site.md` (cards), `back-office.md`, `data-model.md`.

**Verified**

1. Migration applied to a used local database (`supabase migration up`): the three experiences moved to the new wording and button text.
2. API test: the button text is saved trimmed, an empty one is stored as none, 41 characters are refused (422). The public config test expects `buttonLabel`.
3. pgTAP: Single and Double Session carry the mockups' line and button text.
4. Browser test: the Single Session card shows its line, a ticked line, **$35.00**, the happy-hour box with $29.00 and its hours, and the button "Book your first race" opens the booking.
5. Screenshots of `/book` on desktop and phone, and the home page.
6. **Gate:** see the commit for this step.

**For the live site**

- Run `supabase db push` **before** deploying the API, or the API asks for a column that isn't there yet.

**Issues found and fixed**

1. The home page browser test still expected the old line ("Quick Race, Time trial, Drift, and more.") and "60 min". It now checks the mockups' wording, "30 minutes" / "60 minutes" (written out, as in the mockups), and that the home page button links to the right booking.
