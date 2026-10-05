import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { sessionRules } from "@/components/session-rules";
import { Card, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/types";

export const metadata: Metadata = { title: "Terms — Racegrounds" };

export default async function TermsPage() {
  // The rules' numbers are the venue's own settings (D85); the launch values if the API is away.
  await connection();
  let rules = sessionRules(15, 15);
  try {
    const config = await api<PublicConfig>("/public/config");
    rules = sessionRules(config.arriveEarlyMinutes, config.noShowHoldMinutes);
  } catch {
    // keep the launch values
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="display text-4xl">Terms</h1>
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
          <li>Show your booking code at the counter.</li>
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
          <li>Please treat the equipment and other guests with care. Staff may end a session for unsafe or abusive behaviour.</li>
          <li>Membership benefits (discount and free play) apply while a membership is active.</li>
        </ul>
      </Card>
    </div>
  );
}
