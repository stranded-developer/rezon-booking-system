import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EXPLORE_ID } from "@/components/bottom-bar";
import { Reveal } from "@/components/reveal";
import type { SiteTile } from "@/lib/types";

/**
 * The home page's tile sections in the owner's mockup (D88), from `site_tiles` (D87). Titles and
 * images come from the back office; a tile without an image yet shows a dark violet placeholder,
 * so a section reads before its photos exist.
 */

/** A section heading as the mockup sets them: left-aligned, heavy, with a line of copy under it. */
export function SectionHeading({ kicker, title, sub, center = false }: { kicker?: string; title: ReactNode; sub?: string; center?: boolean }) {
  return (
    <Reveal className={center ? "text-center" : ""}>
      {kicker ? <p className="kicker mb-3">{kicker}</p> : null}
      <h2 className="display text-3xl sm:text-5xl">{title}</h2>
      {sub ? <p className={`mt-4 max-w-xl text-ink-600 ${center ? "mx-auto" : ""}`}>{sub}</p> : null}
    </Reveal>
  );
}

function Photo({ tile, sizes }: { tile: SiteTile; sizes: string }) {
  return tile.imageUrl ? (
    <Image src={tile.imageUrl} alt="" fill sizes={sizes} className="object-cover transition-transform duration-700 group-hover:scale-105" />
  ) : (
    <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-violet/45 via-paper to-night" />
  );
}

function Section({ id, label, className = "", children }: { id?: string; label: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={label} className={`scroll-mt-24 ${className}`}>
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">{children}</div>
    </section>
  );
}

/** "More than a race": numbered photo tiles, then the four words. */
export function HighlightTiles({ tiles }: { tiles: SiteTile[] }) {
  if (tiles.length === 0) return null;
  const words = ["Race.", "Play.", "Hang out.", "Compete."];
  return (
    <Section label="What Racegrounds is">
      <SectionHeading title="More than a race" sub="Sim racing, billiards and somewhere to hang out, all under one roof in Sydney." />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile, i) => (
          <Reveal key={tile.id} delayMs={i * 70}>
            <figure className="group relative aspect-[4/3.6] overflow-hidden rounded-lg border border-line bg-paper">
              <Photo tile={tile} sizes="(max-width: 1024px) 50vw, 288px" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-night via-night/30 to-transparent" />
              <span className="display absolute left-2 top-2 rounded-sm bg-night/80 px-1.5 py-1 text-[0.6rem] text-flag">{String(i + 1).padStart(2, "0")}</span>
              <figcaption className="absolute inset-x-0 bottom-0 p-3">
                <span className="display block max-w-[9ch] text-lg leading-tight sm:text-2xl">{tile.title}</span>
                <span aria-hidden className="mt-2 block h-0.5 w-5 bg-flag" />
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
      <p className="display mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {words.map((word, i) => (
          <span key={word} className={i % 2 === 1 ? "text-flag" : ""}>
            {word}
          </span>
        ))}
      </p>
    </Section>
  );
}

/** #6 "Book your event": small chevron buttons, every one to Book now. A VR tile is featured. */
export function EventTiles({ tiles }: { tiles: SiteTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <Section label="Book your event" className="bg-deep/70">
      <SectionHeading title="Book your event" sub="Pick how you want to race, then choose your time." />
      <Reveal>
        <Link href="/book" className="group mt-8 flex items-end justify-between gap-4 border-t border-line pt-5">
          <span>
            <span className="kicker block text-ink-500!">Ready?</span>
            <span className="display mt-1 block text-sm">Book your session</span>
          </span>
          <span className="kicker flex items-center gap-1 group-hover:text-flag-bright">
            Book now <Chevron />
          </span>
        </Link>
      </Reveal>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tiles.map((tile, i) => {
          const featured = /\bVR\b/i.test(tile.title);
          return (
            <Reveal key={tile.id} delayMs={i * 50}>
              <Link
                href="/book"
                className={`group relative flex h-20 items-center justify-between gap-2 overflow-hidden rounded-lg border px-4 transition sm:h-24 ${
                  featured ? "border-violet bg-violet text-white" : "border-line bg-paper/70 hover:border-violet hover:bg-violet/30"
                }`}
              >
                {tile.imageUrl ? (
                  <>
                    <Image src={tile.imageUrl} alt="" fill sizes="(max-width: 1024px) 50vw, 384px" className="object-cover opacity-30 transition-opacity group-hover:opacity-45" />
                    <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-night/70 to-transparent" />
                  </>
                ) : null}
                <span className="display relative text-[0.7rem] leading-tight sm:text-sm">{tile.title}</span>
                <span className={`relative ${featured ? "text-white" : "text-flag"}`}>
                  <Chevron />
                </span>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/** #7 "Types of driving": short photo tiles, shown only. A tile titled "& …" is a caption. */
export function DrivingTiles({ tiles }: { tiles: SiteTile[] }) {
  const cards = tiles.filter((t) => !t.title.startsWith("&"));
  const captions = tiles.filter((t) => t.title.startsWith("&"));
  if (tiles.length === 0) return null;
  return (
    <Section id={EXPLORE_ID} label="Types of driving">
      <SectionHeading title="Types of driving" sub="Open-wheel to off-road: whatever you like to drive, it's on the rigs." />
      <div className="mt-8 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {cards.map((tile, i) => (
          <Reveal key={tile.id} delayMs={i * 50}>
            <figure className="group relative aspect-[2.4/1] overflow-hidden rounded-md border border-line bg-paper">
              <Photo tile={tile} sizes="(max-width: 1024px) 50vw, 384px" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-night/80 via-night/30 to-transparent" />
              <figcaption className={`display absolute inset-y-0 left-3 flex max-w-[80%] items-center text-base leading-tight sm:text-2xl ${i % 2 === 0 ? "text-flag" : "text-white"}`}>
                {tile.title}
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
      {captions.map((tile) => (
        <p key={tile.id} className="kicker mt-5 text-ink-500!">
          {tile.title}
        </p>
      ))}
    </Section>
  );
}

export function Chevron() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M7.5 4.5L13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
