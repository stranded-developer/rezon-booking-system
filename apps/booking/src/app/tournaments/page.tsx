import { Suspense } from "react";
import type { Metadata } from "next";
import { TournamentsView } from "@/components/tournaments-view";
import { PageShell, SectionTitle } from "@/components/ui";

export const metadata: Metadata = {
  title: "Tournaments — Racegrounds",
  description: "Sign up for a Racegrounds tournament. Spots are limited.",
};

export default function TournamentsPage() {
  return (
    <PageShell>
      <SectionTitle kicker="Compete" level={1} className="mb-10">
        Racegrounds <span className="text-flag">tournaments</span>
      </SectionTitle>
      <Suspense>
        <TournamentsView />
      </Suspense>
    </PageShell>
  );
}
