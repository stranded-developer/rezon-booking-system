# Phase 6c-1 — Venue contact details and website photos in the back office

**Date:** 2026-09-15
**Decisions:** [D58–D60](../decisions/07-2026-09-15-booking-website.md): details and photos editable in the back office, lighter public look, account first when joining online.

**Before starting: the modules 6c depends on were checked, not assumed**

The logs for steps 13–15 were re-verified against the code on a clean `db reset`, before any change:
- pgTAP **353/353**
- turbo typecheck/lint/test **9/9** (pricing 78, API 150, including the real Stripe suites)
- POS build + e2e **3 passed, 1 skipped** (the real-Stripe membership e2e needs `stripe listen`)
- The public, booking, member (`/me`), admin booking and cron endpoints the website will call are all present in `apps/api/src/routes`.

**Done**

**Database** (migration `20260915001500_venue_details_photos.sql`)
- `venue_settings`: `address`, `phone`, `contact_email` (any case), `intro`, `instagram_url`, each with a check (format, length, https instagram.com links only).
- `venue_photos`: storage path (`<uuid>.jpg|png|webp` only), caption, sort. RLS on, no browser access. Audited by the existing config trigger.
- Storage bucket `venue-photos`: public read, 5 MB, JPEG/PNG/WebP. No Storage policies for browser roles, so only the API can upload or delete.
- **Local Supabase now runs Storage:** `supabase/config.toml` `[storage] enabled = true`, and `storage-api` was removed from the `db:start` exclude list.

**API**

| Endpoint | What |
|---|---|
| `PATCH /admin/settings` | Also takes `address`, `phone`, `contactEmail`, `intro`, `instagramUrl`. Empty text clears a field. |
| `GET /admin/venue-photos` | Photos with public URLs, in order |
| `POST /admin/venue-photos` | Form upload (file + caption). The type is read from the file's first bytes, never from its name or the browser's content type. 5 MB (body limit + size check). At most 12. The file is removed again if the row can't be saved. |
| `PATCH /admin/venue-photos/:id` | Caption |
| `PUT /admin/venue-photos/order` | New order; every current photo must be listed exactly once (`photos_changed` otherwise) |
| `DELETE /admin/venue-photos/:id` | Row first (off the website), then the file |
| `GET /public/config` | Now includes `venue` (address, phone, email, intro, instagramUrl) and `photos` (url, caption) |

**POS back office** (Venue & hours)
- New **Booking website** card: address, phone, contact email, Instagram link, intro.
- New **Website photos** card: upload with caption, thumbnails, edit caption, move up/down, remove (with confirmation), "n / 12".
- Audit log filter includes `venue_photos`.
- **Form errors now say what's wrong.** The POS API client shows the first field message from the API (for example "Use a link like https://www.instagram.com/yourname") instead of the generic "Some fields are invalid". This helps every back office form.

**Spec updated:** `data-model.md` (columns, `venue_photos`, Storage), `back-office.md` (Booking website screen), `architecture.md` (endpoints, Storage), `booking-site.md` (home page content, light look, joining online).

**Verified**
1. **pgTAP `11_venue_details` (19):**
   - valid details; email in any case; bad phone, email, non-https or non-Instagram link, empty address, intro too long all refused
   - photo insert and delete audited with actor, reason and what was removed
   - storage path must be a uuid file name; no gif; empty caption refused
   - no browser privileges on `venue_photos`
   - bucket public, 5 MB, images only; no Storage write policy for browser roles
   - anon and signed-in users can't insert into `storage.objects`

   `01_schema_seed` table list updated. Full pgTAP **372/372**.
2. **`test/venue.integration.test.ts`, 11 tests** (local DB and real local Storage):
   - details saved, audited with reason, shown in `/public/config`; empty text clears
   - bad phone, email, Instagram and long intro → 422; cashier → 403
   - a PNG upload is stored, **downloaded back over HTTP byte for byte** with `image/png`, audited, and listed publicly
   - a JPEG named `.png` is saved as `.jpg`; WebP with an unknown content type as `.webp`; a script named `.jpg`, a GIF and an empty file are refused
   - over 5 MB, a 201-character caption, no file, and cashier are refused
   - a browser can't upload straight to Storage with the publishable key, even with a staff login
   - captions change and clear; unknown photo 404
   - reorder saved and reflected publicly; a missing or duplicated id → 409
   - the 13th photo → `too_many_photos`
   - remove: gone from the site, file no longer served, audited; removing again → 404
3. **POS e2e `admin.spec.ts` extended:** the owner fills in the website details, sees the Instagram error message, uploads a photo (the thumbnail actually loads from Storage), confirms `/public/config` shows the details and photo, removes it, and finds `venue_photos.delete` in the audit log with their name. Teardown restores the details and removes any photo left by a failed run.
4. **Mutation check, 20 deliberate breaks, 20 killed:**
   - **API (12):** trust any file type, no photo limit, file not deleted, reorder unchecked, upload not attributed, photos or wrong field on the public config, email not saved, empty text not cleared, caption not trimmed, deleting a missing photo succeeds, size limit raised
   - **Database (8, applied to the live DB and undone):** bucket private, bucket accepts any type, browser upload policy, photo audit trigger dropped, phone check dropped, Instagram check loosened, storage path check dropped, visitors granted read on `venue_photos`
5. The venue suite ran more than 20 times on the used local database during mutation testing, passing every time it wasn't mutated.
6. **Gate** (clean `db reset`, same command as the commit):
   - pgTAP 372
   - turbo typecheck/lint/test 9/9 (pricing 78, API 161)
   - POS build + e2e 3 passed, 1 skipped

**Issues found and fixed**
1. **Form errors were unhelpful** (found by the e2e): the back office showed "Some fields are invalid" without saying which field. The API already sent the details; the POS client now shows the first one.
2. The e2e looked for `role=alert` and matched Next.js's hidden route announcer. It now filters by the expected text.
3. The first gate run failed typecheck on the new test file (a typed restore of the original settings under `exactOptionalPropertyTypes`). Vitest doesn't typecheck, so only the gate caught it. Fixed before the commit run.

**Not built yet**
- **Go-live:** the hosted Supabase project needs Storage (included on every plan). The migration creates the bucket there.
- Booking website (6c-2 onwards), which shows these details and photos on its home page.
