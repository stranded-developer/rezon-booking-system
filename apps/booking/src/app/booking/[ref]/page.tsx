import type { Metadata } from "next";
import { BookingView } from "@/components/booking-view";

export const metadata: Metadata = { title: "Your booking — Raceground", robots: { index: false, follow: false } };

export default async function BookingPage(props: PageProps<"/booking/[ref]">) {
  const { ref } = await props.params;
  const search = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <BookingView bookingRef={ref} token={one(search.token) ?? null} justPaid={one(search.paid) === "1"} abandoned={one(search.abandoned) === "1"} />;
}
