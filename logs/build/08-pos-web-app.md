# Step 3c — POS web app ✅

**Date:** 2026-09-14

**Done**
- **API additions:**
  - `/pos/config` now includes rate bands, for the in-browser running price
  - `X-Operator-Passive: 1` header: floor polling doesn't renew the operator token, so the server-side 5-minute idle lock still works while the POS is open. Test added.
  - CORS allows the header
- **Pricing and db packages:** added a `default` export condition, so CommonJS tooling (Playwright) can load them.
- **`apps/pos`** (Next.js 16.3.5, React 19.2, Tailwind 4, Turbopack), a client-side app on one route, dark counter theme:

  | Screen | Behaviour |
  |---|---|
  | **Device sign-in** | Supabase email/password. Rejects non-staff accounts. The session persists on the device. |
  | **Lock screen** | Staff tiles + PIN pad (on-screen or keyboard). Shows "Incorrect PIN — N tries left". Locks after **5 min idle** or on Lock; the operator token is kept in memory only. |
  | **Floor** | Tiles grouped by type: state badge, live timer (server-corrected clock), running price estimate, current / next booking, walk-in booking warning, overdue pulse. Closing-soon banner. Polls every 10 s. |
  | **Tile actions** | Start walk-in (with "booked from …" notice), check in booking (from 15 min before), no-show (enabled after the hold), close & pay, void open walk-in (superadmin with reason). |
  | **Close & pay** | Scan field auto-focused for the USB scanner: `rg:m:` → member, 6-char / `rg:r:` → referral, anything else → member search. Member card with "confirm the name" prompt, free-play minutes, referral card, itemised quote, total. Card (CommBank ref) or cash (quick amounts, change). Price adjustment with superadmin approver + PIN for cashiers. Re-quotes automatically when the 2-minute quote expires or the API says `quote_changed`. |
  | **Receipt** | Change due, on-screen receipt, 80 mm print layout (`@media print`). |
  | **Today's bookings** | Search; check in / no-show buttons appear only when allowed. |
  | **Till** | Open with float; paid in/out with reason; close with counted cash and terminal total; full shift report (takings, cash reconciliation, card reconciliation, discounts, free play); print. |

- **Browser end-to-end test** (`apps/pos/e2e`, Playwright + Chromium, `pnpm --filter @raceground/pos e2e`):
  - Global setup seeds staff, a test table, a Gold member with a QR card and a booking later today, and finishes any open till/sessions. Teardown deactivates the seeded data.
  - Playwright starts the API and POS servers itself.

**Verified**
1. **Lint** (ESLint 9 + Next core-web-vitals + React Compiler hook rules): exit 0. **Typecheck:** exit 0. **Production build:** OK.
2. **Browser run against the real API + local Supabase** (Mon 14 Sep 2026, 17:41–17:50 Sydney, outside happy hour), which checks:
   - device sign-in
   - wrong PIN → "Incorrect PIN — 4 tries left"; correct PIN → floor
   - test table Free
   - open till with $200.00 → header "Till open"
   - start walk-in → tile "Walk-in"
   - close & pay: scan field focused; scanned member card → member shown with "Gold member 10%"
   - **total exactly $6.75** (15-min minimum $7.50 − 10%; the test computes the expected amount independently)
   - card button enabled; cash with the largest quick amount → change = tendered − total ($93.25 from $100)
   - receipt: TOTAL $6.75, member number, "Served by …"
   - tile back to Free; today's bookings shows the seeded booking
   - till: expected cash $206.75 → counted exactly → "Shift closed", cash variance $0.00
   - Lock → lock screen
   - **1 passed.** Screenshots in `apps/pos/test-results/screens/` (not committed).
3. **Screenshots reviewed by eye.** Found and fixed:
   - the "Walk-in" badge wrapped onto two lines on long tile names
   - the shift report showed "−$0.00" for zero refunds and paid-outs
   - after the fixes, rebuilt and re-ran: pass
4. **Full monorepo run, uncached:**
   - `turbo typecheck` 4/4, `lint` 1/1, `build` 3/3
   - tests: pricing 78, API 67, pgTAP 165
   - e2e: 1 passed

**Issues found and fixed during this step**
1. **Polling would defeat the idle lock.** Floor polling every 10 s would have renewed the operator token forever, silently breaking the server-side idle lock. Fixed with passive requests; test added.
2. **React Compiler lint errors:**
   - refs read during render (API client built from refs) → the operator token moved to a module-level in-memory store
   - `useMemo(getSupabase)` → inline function
   - synchronous setState in the close dialog's mount effect → the initial quote only sets state after the request resolves
   - the Input component didn't accept `ref` in React 19 → `ComponentProps<"input">`
3. **Walk-in notice done via a thrown error.** The notice was signalled by throwing (which would also show an empty error box). Replaced with a returned notice.
4. **Playwright setup:**
   - device preset overrode the viewport
   - API server started in the wrong folder
   - workspace packages lacked a CommonJS-loadable export
   - `import.meta` doesn't work in CommonJS
   - a receipt selector matched the hidden print copy
   - all fixed; none were app bugs

**Not built yet (tracked)**
- Void or refund of a **closed** sale from the POS UI. The API supports it (superadmin); the UI arrives with the back office sales/receipts screen (Phase 4).
- Camera QR scanning fallback (USB scanner is primary, D45).
- Email receipts (Phase 5/6 with Resend).
- Supabase Realtime instead of polling (only needed with more than one terminal).
- Overstay grace period: waiting on the owner's answer (D48).
