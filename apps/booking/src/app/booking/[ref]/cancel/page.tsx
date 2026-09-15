import type { Metadata } from "next";
import { CancelView } from "@/components/cancel-view";

export const metadata: Metadata = { title: "Cancel your booking — Raceground", robots: { index: false, follow: false } };

export default async function CancelPage(props: PageProps<"/booking/[ref]/cancel">) {
  const { ref } = await props.params;
  const search = await props.searchParams;
  const token = Array.isArray(search.token) ? search.token[0] : search.token;
  return <CancelView bookingRef={ref} token={token ?? null} />;
}
