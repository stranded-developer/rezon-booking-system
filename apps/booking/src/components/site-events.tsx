"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SiteEvent } from "@/lib/types";

/**
 * What's on: the pop-up and the banner (D69).
 *
 * Both are dismissed per visitor, remembered in `localStorage` under the event's own id, so a new
 * event shows again and an old one stays shut. Storage can throw (private windows, blocked site
 * data), so every read and write is guarded and the fallback is simply to show the event.
 */

const dismissedKey = (id: string, kind: "popup" | "banner") => `rg.event.${kind}.${id}`;

function wasDismissed(id: string, kind: "popup" | "banner"): boolean {
  try {
    return window.localStorage.getItem(dismissedKey(id, kind)) === "1";
  } catch {
    return false;
  }
}

function remember(id: string, kind: "popup" | "banner"): void {
  try {
    window.localStorage.setItem(dismissedKey(id, kind), "1");
  } catch {
    // Nothing to do: the event simply shows again next time.
  }
}

/**
 * false while rendering on the server and for the first client render, true afterwards.
 *
 * What a visitor has dismissed lives only in their browser, so it cannot be known during the server
 * render. Waiting for this keeps the first client render identical to the server's, which is what
 * avoids a hydration mismatch — and it does so without setting state inside an effect.
 */
const neverChanges = () => () => {};
const useMounted = () => useSyncExternalStore(neverChanges, () => true, () => false);

function CloseButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid size-8 shrink-0 place-items-center rounded-lg text-ink-600 transition hover:bg-white/10 hover:text-ink-950 ${className}`}
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function EventBanner({ events }: { events: SiteEvent[] }) {
  const mounted = useMounted();
  const [closedNow, setClosedNow] = useState<string[]>([]);

  if (!mounted) return null;
  const event = events.find((e) => e.asBanner && !closedNow.includes(e.id) && !wasDismissed(e.id, "banner"));
  if (!event) return null;

  return (
    <div className="relative z-40 border-b border-flag/40 bg-gradient-to-r from-flag/25 via-deep to-deep">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2">
        <span aria-hidden className="text-base">
          🏆
        </span>
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="display mr-2 tracking-wide text-gold">{event.title}</span>
          {event.detail ? <span className="text-ink-600">{event.detail}</span> : null}
        </p>
        {event.ctaLabel && event.ctaUrl ? (
          <Link
            href={event.ctaUrl}
            className="display shrink-0 rounded-lg bg-flag px-3 py-1.5 text-xs tracking-wide text-white transition hover:bg-flag-bright"
          >
            {event.ctaLabel}
          </Link>
        ) : null}
        <CloseButton
          label={`Hide ${event.title}`}
          onClick={() => {
            remember(event.id, "banner");
            setClosedNow((ids) => [...ids, event.id]);
          }}
        />
      </div>
    </div>
  );
}

export function EventPopup({ events }: { events: SiteEvent[] }) {
  const pathname = usePathname();
  const [event, setEvent] = useState<SiteEvent | null>(null);
  // Only on the landing page, as the reference does. A full-screen pop-up over a page someone
  // navigated to on purpose — the booking panel, a tournament sign-up — is in the way, not an
  // announcement. The banner carries the same event everywhere else.
  const onHome = pathname === "/";
  const popupIds = events
    .filter((e) => e.asPopup)
    .map((e) => e.id)
    .join(",");

  useEffect(() => {
    if (!onHome) return;
    const next = events.find((e) => e.asPopup && !wasDismissed(e.id, "popup"));
    if (!next) return;
    // A beat after the page settles, so it doesn't fight the first paint.
    const timer = setTimeout(() => setEvent(next), 900);
    return () => clearTimeout(timer);
    // `events` is a fresh array on every render; its ids are what actually matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupIds, onHome]);

  const close = useCallback(() => {
    setEvent((current) => {
      if (current) remember(current.id, "popup");
      return null;
    });
  }, []);

  // Escape closes it, like any dialog.
  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event, close]);

  if (!event) return null;

  return (
    <div className="animate-fade fixed inset-0 z-50 grid place-items-center bg-night/80 p-4 backdrop-blur-sm" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-popup-title"
        className="animate-pop relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-deep text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CloseButton label="Close" onClick={close} className="absolute right-2 top-2 z-10" />
        <div aria-hidden className="checkers-thin" />
        <div className="space-y-4 p-6 pt-8 sm:p-8">
          <span aria-hidden className="text-4xl">
            🏆
          </span>
          <h2 id="event-popup-title" className="display text-2xl text-gold sm:text-3xl">
            {event.title}
          </h2>
          {event.detail ? (
            <p className="display mx-auto inline-block rounded-lg bg-gold px-4 py-2 text-xl text-night">{event.detail}</p>
          ) : null}
          {event.body ? <p className="text-sm text-ink-600">{event.body}</p> : null}
          {event.ctaLabel && event.ctaUrl ? (
            <Link
              href={event.ctaUrl}
              onClick={close}
              className="display block w-full rounded-xl bg-flag px-6 py-3 text-base tracking-wide text-white transition hover:bg-flag-bright"
            >
              {event.ctaLabel}
            </Link>
          ) : null}
          <button type="button" onClick={close} className="block w-full text-xs text-ink-500 transition hover:text-ink-600">
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
