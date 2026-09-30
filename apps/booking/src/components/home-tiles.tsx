import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EXPLORE_ID } from "@/components/bottom-bar";
import { Reveal } from "@/components/reveal";
import type { SiteTile } from "@/lib/types";

/**
 * The home page's image tiles (D87), in the owner's reference format: a heading with one word in
 * the accent colour, a grid of image tiles with the title across the middle, and a wide bar under
 * them. Titles and images come from the back office; a tile without an image yet shows a dark
 * placeholder so the section still reads.
 */

function Heading({ lead, accent, sub }: { lead: string; accent: string; sub: string }) {
  return (
    <Reveal>
      <h2 className="display text-4xl sm:text-5xl">
        {lead} <span className="text-flag">{accent}</span>
      </h2>
      <p className="mt-3 max-w-2xl text-lg text-ink-600">{sub}</p>
    </Reveal>
  );
}

const PLACEHOLDER_TINTS = ["from-flag/25", "from-sky-500/25", "from-gold/25", "from-emerald-400/20"];

function TileFace({ tile, index, sizes, text }: { tile: SiteTile; index: number; sizes: string; text: string }) {
  return (
    <>
      {tile.imageUrl ? (
        <Image src={tile.imageUrl} alt="" fill sizes={sizes} className="object-cover transition-transform duration-700 group-hover:scale-105" />
      ) : (
        <div aria-hidden className={`absolute inset-0 bg-gradient-to-br ${PLACEHOLDER_TINTS[index % PLACEHOLDER_TINTS.length]} via-deep to-night`} />
      )}
      {/* Darkened, so the title reads over any photo. */}
      <div aria-hidden className="absolute inset-0 bg-night/45" />
      <span className={`display absolute inset-0 grid place-items-center p-3 text-center text-white drop-shadow-lg ${text}`}>{tile.title}</span>
    </>
  );
}

/** The wide bar under a grid: a big figure, a word in the accent colour, and a link. */
function Bar({ figure, word, href, cta }: { figure: string; word: string; href: string; cta: string }) {
  return (
    <Reveal>
      <Link href={href} className="group mt-3 flex items-center justify-between gap-4 rounded-xl border border-line bg-paper px-6 py-6 transition hover:border-flag sm:px-10">
        <span>
          <span className="display block text-4xl sm:text-5xl">{figure}</span>
          <span className="display block text-3xl text-flag sm:text-4xl">{word}</span>
        </span>
        <span className="display flex items-center gap-2 text-lg text-ink-800 group-hover:text-flag">
          {cta}
          <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </Link>
    </Reveal>
  );
}

function Section({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={label} className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-14">
      {children}
    </section>
  );
}

/** Under the hero: Race. Play. Hang out. — the 2×2 grid, then how many simulators there are. */
export function HighlightTiles({ tiles, simulators }: { tiles: SiteTile[]; simulators: number }) {
  if (tiles.length === 0) return null;
  return (
    <Section label="What Raceground is">
      <Heading lead="More than a" accent="race" sub="Sim racing, billiards and somewhere to hang out, all under one roof in Sydney." />
      <div className="mt-8 grid grid-cols-2 gap-3">
        {tiles.map((tile, i) => (
          <Reveal key={tile.id} delayMs={i * 70}>
            <figure className="group relative aspect-[5/3] overflow-hidden rounded-lg bg-deep">
              <TileFace tile={tile} index={i} sizes="(max-width: 1152px) 50vw, 576px" text="text-3xl sm:text-6xl" />
            </figure>
          </Reveal>
        ))}
      </div>
      {simulators > 0 ? <Bar figure={`${simulators}`} word="Simulators" href="/book" cta="Explore" /> : null}
    </Section>
  );
}

/** #6 — "Book your event": the kinds of session, each one straight to Book now. */
export function EventTiles({ tiles }: { tiles: SiteTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <Section label="Book your event">
      <Heading lead="Book your" accent="event" sub="Pick how you want to race, then choose your time." />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tiles.map((tile, i) => (
          <Reveal key={tile.id} delayMs={i * 60}>
            <Link href="/book" className="group relative block aspect-[5/3] overflow-hidden rounded-lg bg-deep focus-visible:outline-2 focus-visible:outline-flag">
              <TileFace tile={tile} index={i} sizes="(max-width: 1024px) 50vw, 384px" text="text-xl sm:text-3xl" />
            </Link>
          </Reveal>
        ))}
      </div>
      <Bar figure="Ready?" word="Book your session" href="/book" cta="Book now" />
    </Section>
  );
}

/** #7 — "Types of driving": shown only, not links. Where the bottom bar's "Explore" lands. */
export function DrivingTiles({ tiles }: { tiles: SiteTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <Section id={EXPLORE_ID} label="Types of driving">
      <Heading lead="Types of" accent="driving" sub="Open-wheel to off-road: whatever you like to drive, it's on the rigs." />
      <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-4">
        {tiles.map((tile, i) => (
          <Reveal key={tile.id} delayMs={i * 50}>
            <figure className="group relative aspect-square overflow-hidden rounded-md bg-deep">
              <TileFace tile={tile} index={i} sizes="(max-width: 1024px) 33vw, 288px" text="text-lg sm:text-3xl" />
            </figure>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
