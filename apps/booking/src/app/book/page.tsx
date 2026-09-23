import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking-flow";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = {
  title: "Book a table, sim or VR seat — Raceground",
  description: "Pick a time, see the price including GST, and pay online.",
};

export default function BookPage() {
  return (
    <PageShell>
      <BookingFlow />
    </PageShell>
  );
}
