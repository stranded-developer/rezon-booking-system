import { Suspense } from "react";
import type { Metadata } from "next";
import { BookView } from "@/components/book/book-view";
import { PageShell, Spinner } from "@/components/ui";

export const metadata: Metadata = {
  title: "Book a race or a table — Raceground",
  description: "Pick an experience, choose a time and pay online. Every price includes GST.",
};

export default function BookPage() {
  return (
    <PageShell>
      <Suspense fallback={<Spinner label="Loading what's available…" />}>
        <BookView />
      </Suspense>
    </PageShell>
  );
}
