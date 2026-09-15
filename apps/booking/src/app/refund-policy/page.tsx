import type { Metadata } from "next";
import { Card, Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Cancellations and refunds — Raceground" };

export default function RefundPolicyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-black">Cancellations and refunds</h1>
      <Card>
        <ul className="space-y-3 text-sm text-ink-600">
          <li>
            <strong className="text-ink-950">24 hours or more before the start:</strong> cancel from the link in your confirmation email for a
            full refund. Any free-play minutes you used go back into your balance.
          </li>
          <li>
            <strong className="text-ink-950">Between 2 and 24 hours before:</strong> cancel for a 50% refund. Free-play minutes used are not
            returned.
          </li>
          <li>
            <strong className="text-ink-950">Less than 2 hours before:</strong> bookings can&apos;t be cancelled online and no refund applies.
            Please call us if something has come up.
          </li>
          <li>
            <strong className="text-ink-950">If you don&apos;t turn up:</strong> we hold your spot for 15 minutes after the start time, then the
            booking is marked as a no-show. No refund applies.
          </li>
          <li>
            <strong className="text-ink-950">If we have to cancel:</strong> you get a full refund, whenever it happens, and your free-play
            minutes back.
          </li>
          <li>
            <strong className="text-ink-950">Arriving late:</strong> your session still ends at the booked finish time.
          </li>
          <li>
            <strong className="text-ink-950">Running over:</strong> booked time is paid in advance and we never charge you extra for a booking
            that runs over. Staff will let you know when your time is up.
          </li>
        </ul>
        <p className="mt-5 text-sm text-ink-500">
          Refunds go back to the card you paid with and usually appear within 5–10 business days. Prices include GST.
        </p>
      </Card>
      <Notice tone="info">This page describes our booking rules. The full terms are being finalised before launch.</Notice>
    </div>
  );
}
