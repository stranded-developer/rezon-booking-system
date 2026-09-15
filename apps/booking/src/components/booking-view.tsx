"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { api, errorMessage } from "@/lib/api";
import { formatCents, formatMinutes } from "@/lib/format";
import type { Booking } from "@/lib/types";
import { ButtonLink, Card, Notice, Row, Spinner } from "@/components/ui";

/** How long to wait for Stripe's webhook to confirm a booking after the customer paid. */
const CONFIRM_POLL_MS = 2000;
const CONFIRM_WAIT_MS = 60_000;

export function BookingView({
  bookingRef,
  token,
  justPaid,
  abandoned,
}: {
  bookingRef: string;
  token: string | null;
  justPaid: boolean;
  abandoned: boolean;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingForPayment, setWaitingForPayment] = useState(justPaid);
  const startedAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return null;
    try {
      const r = await api<{ booking: Booking }>(`/bookings/${bookingRef}?token=${encodeURIComponent(token)}`);
      setBooking(r.booking);
      setError(null);
      return r.booking;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, [bookingRef, token]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    startedAt.current ??= Date.now();

    async function run() {
      // The customer pressed "back" at Stripe: free the time for someone else straight away.
      if (abandoned && token) {
        await api(`/bookings/${bookingRef}/abandon`, { body: { token } }).catch(() => undefined);
      }
      const first = await load();
      if (cancelled || !first) return;
      // After paying, the booking is confirmed by Stripe's webhook, which can take a moment.
      if (justPaid && first.status === "held") {
        const poll = async () => {
          if (cancelled) return;
          const b = await load();
          if (cancelled) return;
          if (b && b.status !== "held") {
            setWaitingForPayment(false);
            return;
          }
          if (Date.now() - (startedAt.current ?? Date.now()) > CONFIRM_WAIT_MS) {
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
  }, [abandoned, justPaid, load, bookingRef, token]);

  const missingToken = !token;
  if (error || missingToken) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{error ?? "This link is missing its code. Please open the link from your email."}</Notice>
        <ButtonLink href="/book" variant="primary">
          Book a time
        </ButtonLink>
      </div>
    );
  }
  if (!booking) return <Spinner label="Finding your booking…" />;

  const confirmed = booking.status === "confirmed" || booking.status === "arrived" || booking.status === "completed";
  const paid = booking.totalCents ?? 0;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {waitingForPayment ? <Notice tone="info">Thanks! We&apos;re confirming your payment. This page updates itself.</Notice> : null}
      {confirmed ? <Notice tone="good">Your booking is confirmed. See you at Raceground.</Notice> : null}
      {booking.status === "cancelled" ? (
        <Notice tone="warn">
          This booking is cancelled.
          {booking.refundCents ? ` We refunded ${formatCents(booking.refundCents)} to your card.` : " No refund applied."}
        </Notice>
      ) : null}
      {booking.status === "expired" ? <Notice tone="warn">This booking wasn&apos;t paid in time, so the slot was released.</Notice> : null}
      {booking.status === "no_show" ? <Notice tone="warn">This booking was marked as a no-show.</Notice> : null}
      {booking.status === "held" && !waitingForPayment ? (
        <Notice tone="warn">
          {abandoned ? "Payment wasn't completed, so we've released the time." : "We're holding this time until payment is completed."}
        </Notice>
      ) : null}

      <Card>
        <p className="text-sm text-ink-500">Booking code</p>
        <p data-testid="booking-ref" className="text-4xl font-black tracking-widest tnum">{booking.ref}</p>
        <div className="mt-5 space-y-1">
          <Row label="What" value={`${booking.resourceType} · ${booking.resource}`} />
          <Row label="When" value={`${booking.venueDate}, ${booking.venueStartTime}–${booking.venueEndTime}`} />
          <Row label="How long" value={formatMinutes(booking.durationMinutes)} />
          <Row label="Name" value={booking.customerName} />
          {booking.freeMinutesUsed > 0 ? <Row label="Free play used" value={`${booking.freeMinutesUsed} min`} /> : null}
          <Row label={paid > 0 ? "Paid" : "Total"} value={formatCents(paid)} strong />
          {booking.gstCents ? <p className="text-right text-xs text-ink-500">includes GST {formatCents(booking.gstCents)}</p> : null}
        </div>

        {confirmed ? (
          <div className="mt-6 flex flex-col items-center gap-2 rounded-xl bg-mist p-5">
            <div data-testid="booking-qr">
              <QRCodeSVG value={booking.checkInCode} size={160} level="M" />
            </div>
            <p className="text-center text-sm text-ink-600">Show this at the counter when you arrive.</p>
          </div>
        ) : null}
      </Card>

      {confirmed ? (
        <Card title="Need to change it?">
          {booking.cancellation?.allowed ? (
            <>
              <p className="text-sm text-ink-600">
                Cancel now and we&apos;ll refund {formatCents(booking.cancellation.refundCents)} of the {formatCents(booking.cancellation.paidCents)} you paid.
              </p>
              <div className="mt-4">
                <ButtonLink href={`/booking/${booking.ref}/cancel?token=${encodeURIComponent(token ?? "")}`} variant="secondary">
                  Cancel this booking
                </ButtonLink>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-600">
              It&apos;s too close to the start to cancel online. Please call the venue if something has come up.
            </p>
          )}
        </Card>
      ) : (
        <ButtonLink href="/book" variant="primary">
          Book another time
        </ButtonLink>
      )}

      <p className="text-center text-sm text-ink-500">
        Keep this link: it&apos;s the only way back to your booking.{" "}
        <Link href="/" className="underline">
          Raceground home
        </Link>
      </p>
    </div>
  );
}
