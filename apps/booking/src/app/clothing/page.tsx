import type { Metadata } from "next";
import { connection } from "next/server";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/types";
import { ButtonLink, Checkers } from "@/components/ui";

export const metadata: Metadata = {
  title: "Clothing — Raceground",
  description: "Raceground clothing is on its way.",
};

/** The catalogue is still being made (D86): a coming-soon banner until it is. */
export default async function ClothingPage() {
  await connection();
  let instagramUrl: string | null = null;
  try {
    instagramUrl = (await api<PublicConfig>("/public/config")).venue.instagramUrl;
  } catch {
    instagramUrl = null;
  }

  return (
    <>
      <section className="mx-auto w-full max-w-4xl px-4 py-16 text-center">
        <p className="display text-sm tracking-[0.2em] text-flag">Raceground</p>
        <h1 className="display mt-3 text-5xl sm:text-6xl">
          <span className="text-flag">Clothing</span>
        </h1>

        <div className="mx-auto mt-10 max-w-2xl overflow-hidden rounded-2xl border border-flag/40 bg-paper/80">
          <div aria-hidden className="checkers-thin" />
          <div className="px-6 py-10">
            <p className="display text-3xl sm:text-4xl">Coming soon</p>
            <p className="mx-auto mt-3 max-w-md text-ink-600">
              Our first collection is in the works. Tees, hoodies and caps for the grid — keep an eye out.
            </p>
            {instagramUrl ? (
              <ButtonLink href={instagramUrl} variant="primary" className="mt-6" target="_blank" rel="noreferrer">
                Follow us for the drop
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </section>

      <Checkers />

      {/* Where the catalogue will go: empty tiles, so the page already has its shape. */}
      <section aria-label="Catalogue preview" className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-3 px-4 py-14 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden className="grid aspect-square place-items-center rounded-xl border border-line bg-mist/40">
            <span className="display text-xs tracking-[0.2em] text-ink-500">Coming soon</span>
          </div>
        ))}
      </section>
    </>
  );
}
