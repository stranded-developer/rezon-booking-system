import type { Metadata } from "next";
import { EntryView } from "@/components/entry-view";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Your tournament entry — Racegrounds", robots: { index: false, follow: false } };

export default async function EntryPage(props: PageProps<"/tournaments/[ref]">) {
  const { ref } = await props.params;
  const search = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <PageShell width="narrow">
      <EntryView entryRef={ref} token={one(search.token) ?? null} justPaid={one(search.paid) === "1"} />
    </PageShell>
  );
}
