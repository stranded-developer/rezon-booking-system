import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Terms — Raceground" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-black">Terms</h1>
      <Notice tone="warn">Draft. The final wording is being prepared before launch.</Notice>
      <Card>
        <ul className="space-y-3 text-sm text-ink-600">
          <li>Bookings are paid in advance. All prices include GST.</li>
          <li>
            Cancellations and refunds follow our{" "}
            <Link href="/refund-policy" className="underline">
              cancellation policy
            </Link>
            .
          </li>
          <li>Walk-in time is billed per minute after the minimum session length. Booked time is paid in advance and is never charged extra.</li>
          <li>Show your booking code at the counter. We hold your spot for 15 minutes after the start time.</li>
          <li>Please treat the equipment and other guests with care. Staff may end a session for unsafe or abusive behaviour.</li>
          <li>Membership benefits (discount and free play) apply while a membership is active.</li>
        </ul>
      </Card>
    </div>
  );
}
