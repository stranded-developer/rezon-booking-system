"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, errorMessage } from "@/lib/api";
import { formatCents, formatWallTime } from "@/lib/format";
import type { TournamentEntry } from "@/lib/types";
import { ButtonLink, Card, Notice, Row, Spinner } from "@/components/ui";

/** How long to wait for Stripe's webhook to confirm an entry after the customer paid. */
const CONFIRM_POLL_MS = 2000;
const CONFIRM_WAIT_MS = 60_000;

/** One tournament entry, reached by the link in the confirmation email or after paying (D68). */
export function EntryView({ entryRef, token, justPaid }: { entryRef: string; token: string | null; justPaid: boolean }) {
  const [entry, setEntry] = useState<TournamentEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingForPayment, setWaitingForPayment] = useState(justPaid);
  const startedAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return null;
    try {
      const r = await api<{ entry: TournamentEntry }>(`/tournaments/${entryRef}?token=${encodeURIComponent(token)}`);
      setEntry(r.entry);
      setError(null);
      return r.entry;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, [entryRef, token]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    startedAt.current ??= Date.now();

    async function run() {
      const first = await load();
      if (cancelled || !first) return;
      // After paying, the entry is confirmed by Stripe's webhook, which can take a moment.
      if (justPaid && first.status === "held") {
        const poll = async () => {
          if (cancelled) return;
          const again = await load();
          if (cancelled) return;
          if (again && again.status !== "held") {
            setWaitingForPayment(false);
            return;
          }
          if (Date.now() - (startedAt.current ?? 0) > CONFIRM_WAIT_MS) {
            setWaitingForPayment(false);
            return;
          }
          timer = setTimeout(() => void poll(), CONFIRM_POLL_MS);
        };
        timer = setTimeout(() => void poll(), CONFIRM_POLL_MS);
      } else {
        setWaitingForPayment(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, justPaid]);

  if (!token) return <Notice tone="error">This link is missing its code. Please use the link from your email.</Notice>;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!entry) return <Spinner label="Finding your entry…" />;

  return (
    <div className="space-y-6">
      {waitingForPayment ? <Notice>Confirming your payment… this usually takes a few seconds.</Notice> : null}
      {entry.status === "confirmed" ? (
        <Notice tone="good">You&apos;re in. We&apos;ve emailed your entry code.</Notice>
      ) : entry.status === "held" ? (
        <Notice tone="warn">Your spot is held while the payment goes through.</Notice>
      ) : entry.status === "cancelled" ? (
        <Notice tone="warn">This entry is cancelled.</Notice>
      ) : (
        <Notice tone="warn">This entry expired before it was paid for. You can sign up again if there are spots left.</Notice>
      )}

      <Card title={entry.tournament.name}>
        <div className="space-y-1">
          <Row label="When" value={`${entry.tournament.venueDate}, ${formatWallTime(entry.tournament.venueTime)}`} />
          <Row label="Name" value={entry.customerName} />
          <Row
            label="Entry"
            value={entry.freeEntry ? "Included with your membership" : entry.totalCents === 0 ? "Free" : formatCents(entry.totalCents ?? 0)}
          />
        </div>
        {entry.explanation.length > 0 && !entry.freeEntry ? (
          <ul className="mt-4 space-y-1 rounded-xl bg-mist/60 p-4 text-sm text-ink-600">
            {entry.explanation.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
        {entry.tournament.blurb ? <p className="mt-4 text-sm text-ink-600">{entry.tournament.blurb}</p> : null}
      </Card>

      {entry.status === "confirmed" ? (
        <Card title="Show this at the counter">
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl bg-white p-3" data-testid="entry-qr">
              <QRCodeSVG value={entry.checkInCode} size={160} />
            </div>
            <p className="display text-3xl tracking-[0.2em]" data-testid="entry-ref">
              {entry.ref}
            </p>
            <p className="text-center text-sm text-ink-500">All times are Sydney time. Please arrive 15 minutes before the start.</p>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/tournaments">Back to tournaments</ButtonLink>
        <ButtonLink href="/book" variant="primary">
          Book a session
        </ButtonLink>
      </div>
    </div>
  );
}
