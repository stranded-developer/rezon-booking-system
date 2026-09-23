import { Suspense } from "react";
import type { Metadata } from "next";
import { TournamentsView } from "@/components/tournaments-view";
import { PageShell, SectionTitle } from "@/components/ui";

export const metadata: Metadata = {
  title: "Tournaments — Raceground",
  description: "Sign up for a Raceground tournament. Spots are limited.",
};

export default function TournamentsPage() {
  return (
    <PageShell>
      <SectionTitle kicker="Compete" className="mb-10">
        Raceground <span className="text-flag">tournaments</span>
      </SectionTitle>
      <Suspense>
        <TournamentsView />
      </Suspense>
    </PageShell>
  );
}
