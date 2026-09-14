# Change — no overstay charge, time-up pop-up (D48 revised) ✅

**Date:** 2026-09-14

**Done**
- **API `quoteClose`:** a booking session is always `prepaid` (total $0), and member, referral and free minutes are ignored for it. The `overstay` mode is removed.
- **POS:**
  - running price is $0 for booked sessions
  - new `TimeUpAlert` pop-up for tables whose booking has ended, or any open table after closing time, with "Close {table}" (opens the $0 close directly) and "Remind me in 2 min" per session
  - "Overstay" text removed from the close screen
- **Spec:** pos.md and booking-site.md updated.

**Verified**
1. **API test rewritten:** at 17:10 a booking that ended at 17:00 is still "overdue" on the floor. Its quote is prepaid $0 even when a member and a referral code are offered. The close writes no payment, and the referral use count stays 0. API 91/91.
2. **New browser test `e2e/time-up.spec.ts`:**
   - seeds a booking that ended 5 minutes ago with the customer checked in
   - after PIN: pop-up "E2E Late … — time is up", "Booking ended at hh:mm (5 min ago)"
   - "Remind me in 2 min" hides it; after a reload it's back
   - "Close …" goes straight to "Prepaid booking — nothing to pay" at $0.00 → Close session → Done
   - pop-up gone, tile Free, no payment row
   - Screenshot reviewed.
3. **Bug found and fixed while re-running the back office browser test:** after saving venue settings, the "Saved." confirmation disappeared instantly, because the forms were keyed on the loaded data and remounted when it reloaded. It had only passed before because the reload was slower. The keys were removed.
4. **Full run:**
   - e2e 3/3, twice in a row
   - API 91, pgTAP 200
5. **Correction to the commit above (a3d4ade).** That commit's log said pricing 78/78, but in that combined run **1 pricing test failed**, and the commit wasn't gated on the test result.
   - **Cause:** a timeout. The 2,000-random-session invariant test takes about 2.5 s alone but 12–15 s when typecheck, lint and API tests run in parallel, past Vitest's 5 s default. Reproduced twice.
   - **Checked the engine isn't slow:** 0.37 ms per 1 h quote, 0.77 ms for 3 h, 3.56 ms for 11 h.
   - **Fixed:** a 60 s timeout on that test only.
   - **Verified:** combined turbo typecheck + lint + test run twice (pricing 78/78, API 91/91 both times).
   - From now on commits only run after the checks pass in the same command.
