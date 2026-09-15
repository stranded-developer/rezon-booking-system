import type { Metadata } from "next";
import { Card, Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy — Raceground" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-black">Privacy</h1>
      <Notice tone="warn">Draft. The final wording is being prepared before launch.</Notice>
      <Card>
        <ul className="space-y-3 text-sm text-ink-600">
          <li>We collect your name, and an email address or phone number, so we can confirm your booking and contact you about it.</li>
          <li>Payments are handled by Stripe. We never see or store your card details.</li>
          <li>We keep booking and payment records as required for tax and accounting.</li>
          <li>We don&apos;t sell your details to anyone.</li>
          <li>To ask what we hold about you, or to have it removed, contact the venue.</li>
        </ul>
      </Card>
    </div>
  );
}
