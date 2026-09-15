"use client";

import { useEffect, useState } from "react";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { formatCents, formatMinutes } from "@/lib/format";
import type { Booking } from "@/lib/types";
import { Button, ButtonLink, Card, Notice, Row, Spinner } from "@/components/ui";

export function CancelView({ bookingRef, token }: { bookingRef: string; token: string | null }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ refundCents: number; minutesReturned: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ booking: Booking }>(`/bookings/${bookingRef}?token=${encodeURIComponent(token)}`)
      .then((r) => !cancelled && setBooking(r.booking))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [bookingRef, token]);

  async function cancel() {
    if (!booking?.cancellation || !token) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ refundCents: number; minutesReturned: number }>(`/bookings/${bookingRef}/cancel`, {
        body: { token, expectedRefundCents: booking.cancellation.refundCents },
      });
      setDone(r);
    } catch (err) {
      // The refund changed while the page was open (the 24-hour mark passed): show the new amount.
      if (err instanceof ApiRequestError && err.code === "refund_changed") {
        const details = err.details as { refundCents?: number } | undefined;
        if (typeof details?.refundCents === "number" && booking.cancellation) {
          setBooking({ ...booking, cancellation: { ...booking.cancellation, refundCents: details.refundCents } });
        }
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Notice tone="error">This link is missing its code. Please open the link from your email.</Notice>;
  if (error && !booking) return <Notice tone="error">{error}</Notice>;
  if (!booking) return <Spinner label="Finding your booking…" />;

  if (done) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <Notice tone="good">
          Booking {booking.ref} is cancelled.{" "}
          {done.refundCents > 0
            ? `We've refunded ${formatCents(done.refundCents)} to your card — it usually shows within 5–10 business days.`
            : "No refund applies to this cancellation."}
          {done.minutesReturned > 0 ? ` ${done.minutesReturned} free minutes are back in your balance.` : ""}
        </Notice>
        <ButtonLink href="/book" variant="primary">
          Book another time
        </ButtonLink>
      </div>
    );
  }

  if (booking.status === "cancelled") {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <Notice tone="warn">This booking is already cancelled.</Notice>
        <ButtonLink href="/book" variant="primary">
          Book another time
        </ButtonLink>
      </div>
    );
  }

  const quote = booking.cancellation;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-black">Cancel booking {booking.ref}</h1>
      <Card>
        <div className="space-y-1">
          <Row label="What" value={`${booking.resourceType} · ${booking.resource}`} />
          <Row label="When" value={`${booking.venueDate}, ${booking.venueStartTime}–${booking.venueEndTime}`} />
          <Row label="How long" value={formatMinutes(booking.durationMinutes)} />
          <Row label="Paid" value={formatCents(quote?.paidCents ?? booking.totalCents ?? 0)} />
        </div>
      </Card>

      {quote?.allowed ? (
        <Card title="What you'll get back">
          <Row label="Refund to your card" value={formatCents(quote.refundCents)} strong />
          {quote.returnMinutes > 0 ? <p className="mt-2 text-sm text-ink-600">{quote.returnMinutes} free minutes go back into your balance.</p> : null}
          <p className="mt-2 text-sm text-ink-500">
            {quote.rule === "full" ? "Cancelled at least 24 hours before the start: full refund." : null}
            {quote.rule === "half" ? "Cancelled between 2 and 24 hours before the start: half refund." : null}
          </p>
          {error ? (
            <div className="mt-4">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="danger" size="lg" disabled={busy} onClick={() => void cancel()}>
              {busy ? "Cancelling…" : `Cancel and refund ${formatCents(quote.refundCents)}`}
            </Button>
            <ButtonLink href={`/booking/${booking.ref}?token=${encodeURIComponent(token ?? "")}`} size="lg">
              Keep my booking
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-ink-600">
            Bookings can&apos;t be cancelled online less than 2 hours before the start. Please call the venue if something has come up.
          </p>
          <div className="mt-4">
            <ButtonLink href={`/booking/${booking.ref}?token=${encodeURIComponent(token ?? "")}`}>Back to my booking</ButtonLink>
          </div>
        </Card>
      )}
    </div>
  );
}
