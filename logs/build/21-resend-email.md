# Phase 7b — Real emails through Resend

**Date:** 2026-09-16

Until now every email the system writes — booking confirmation with its calendar invite, the daily reminder, cancellations, the membership welcome — was only printed to the server log. A customer could book and pay and receive nothing. This step makes them real.

**Done**

- **`EMAIL_TRANSPORT=resend`** alongside the existing `console`, plus `RESEND_API_KEY`. The API **refuses to start** with `resend` and no key, or with a key that isn't a Resend one: saying "send email" and silently not sending is the failure this prevents.
- **`createResendEmail`** posts to Resend's API (no SDK, so no extra dependency), with a 10-second timeout, and attaches the `.ics` calendar invite base64-encoded with its content type.
- **`createEmailSender`** picks the transport from the settings; the local server and the Vercel entry both go through it.
- **Every attempt is recorded in `email_log`, before sending.** The unique index (template + entity) means the same message is never sent twice, even if a webhook is delivered again. A failure is marked `failed` with the reason, and the index ignores failed rows, so a later attempt is still allowed.
- **Sending never throws.** An email must not fail a payment, a refund or a cancellation: the money operation completes, the failure is logged and recorded.
- **Spec updated:** `architecture.md` (transport), `deploy.md` §7b — both halves of email, because Supabase's own sign-up and password emails are a separate system that needs SMTP pointed at the same verified domain.

**Verified**
1. **`test/email-resend.integration.test.ts` (9)**, against the real `email_log` with Resend stubbed:
   - sends to the right URL with the right key, sender, recipient, subject and body, and records the provider's id
   - a calendar invite arrives as a base64 attachment that decodes back to the original, with its content type
   - the same message is never sent twice (second attempt is a no-op, nothing reaches the provider)
   - a refused send (422, "the sending domain is not verified") returns rather than throwing, is recorded as `failed` with the reason, **and a later attempt goes through**
   - an answer without an id counts as a failure, not a success
   - the console transport is the default; `resend` in the settings really uses Resend; a missing or malformed key is refused at startup
2. **Mutation check, 7 deliberate breaks, 7 killed:** failure throws instead of being recorded, a failed send marked as sent (which would block every retry), provider id not recorded, an error answer treated as success, attachment sent unencoded, settings ignored so it always uses the console, and the log written *after* sending (which would allow a double send).
3. **Gate** (clean `db reset`, same command as the commit): pgTAP 372 · turbo 11/11 (pricing 78, API **182**) · POS e2e **5 passed** · booking e2e 7 passed. (All five POS tests ran this time: the walk-in one only runs between 10:00 and 20:45 Sydney.)

**Not done here**
- **Nothing is sent until the owner sets it up**: a domain verified in Resend, `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` and an `EMAIL_FROM` on that domain. Until then the default console transport is unchanged.
- **Supabase's own auth emails are separate** and still come from "Supabase Auth" until custom SMTP is configured (deploy.md §7b). That is configuration, not code.
- HTML email templates: everything is plain text plus the calendar attachment, which is deliberate for now and reads fine in every client.
