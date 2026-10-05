import type { Metadata } from "next";
import { BookingView } from "@/components/booking-view";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Your booking — Racegrounds", robots: { index: false, follow: false } };

export default async function BookingPage(props: PageProps<"/booking/[ref]">) {
  const { ref } = await props.params;
  const search = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <PageShell width="narrow">
      <BookingView bookingRef={ref} token={one(search.token) ?? null} justPaid={one(search.paid) === "1"} abandoned={one(search.abandoned) === "1"} />
    </PageShell>
  );
}
