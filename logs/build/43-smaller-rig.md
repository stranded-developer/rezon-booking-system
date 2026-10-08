# Phase 8t (part 1) — The rig is smaller; what the spacing check found

**Date:** 2026-10-08
**Decision:** [D92](../decisions/12-2026-10-08-sessions-walk-in-blocks-type.md).

**Done**

- **The rig** on the home page is three quarters of its column on a phone (264px at a 384px screen, was 352px) and at most 24rem on a wide screen (384px, was 576px). The image `sizes` hint follows, so phones download a smaller file.

**The spacing check (the owner asked "can you confirm")**

The home page was captured at 384px, the width of the owner's video, and compared with the video's frames side by side, then at double size.

- **Yes, it differs, and most of the difference is the font.** The video's headings are the same *height* as ours but much narrower. The video uses Garet, a geometric font (single-storey "a" in the body text), and ours uses Unbounded, which is very wide. That is why the video looks smaller and tighter. My first quick look put this down to everything being 20–25% smaller, and that was wrong: card padding and heading heights match.
- **Differences that aren't the font:**
  - The video's buttons have smaller text and less padding: 96×44 against our 142×48 for the hero's Book now, and 80×35 against 106×36 in the header.
  - Body text is about 14px in the video, 16px here.
  - In the hero, the video has about 76px between the header and "— Sydney" (ours 57) and about 24px between the paragraph and the buttons (ours 37).
- **Next:** these are sized once Garet is in (D93), because button and heading widths depend on the font. Measuring now and again after the font change would mean doing it twice.

**Verified**

1. Captured at 384px and 1280px with the change. The rig sits centred under the hero on a phone and in the right column on a wide screen; the angle dots and the "8 Simulators" card are unchanged.
2. **Gate:** see the commit for this step (the home browser test still checks the seven angle buttons).

**Issues found and fixed**

1. The preview server for these captures ran with `next dev`, which shares `.next` with `next build` (see build/41). It was stopped before the gate.
2. **"A member can ask for a new password" is flaky, and build/41 blamed the wrong thing.** It failed again in the full run with no dev server running, passed three times on its own, then failed again in a full run. The trace shows the real cause, which is in the test: it clicks "Forgot your password?" and types the email straight away, and the login page has an Email box too. On a fast run the address went into the login page's box (so the "did it stick?" check passed) just before that page was replaced, and "Send me a link" was pressed on an empty form. The test now waits for the forgot-password page and its heading before typing. build/41's `.next` explanation was wrong: that run was the same race.
3. **Running the whole browser suite three times in a row failed other tests** (the guest booking, the tournament sign-ups). Each run on its own passes. The cause is the API's own abuse limits: 10 booking holds and 10 tournament sign-ups per address per 10-minute window, and one full run uses about 4 of each. That is the limit doing its job, not a fault. Leave a gap between full runs, or run single files.
