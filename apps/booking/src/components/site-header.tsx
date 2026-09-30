"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { ButtonLink, Wordmark } from "@/components/ui";

const LINKS = [
  { href: "/book", label: "Book" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/membership", label: "Membership" },
  { href: "/contact", label: "Contact" },
];

/**
 * The bar across the top shrinks into a floating pill once you scroll, the way the reference does,
 * so "Book now" is always within reach without the bar taking up the screen (D64).
 *
 * It is deliberately **one** bar that changes shape, not two that cross-fade. Two would mean two
 * "Book now" links and two sets of navigation in the page at the same time — confusing for anyone
 * using a screen reader or the keyboard, whichever one happens to be faded out.
 */
export function SiteHeader() {
  const { session, ready } = useAccount();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const accountHref = session ? "/account" : "/login";
  const accountLabel = session ? "My account" : "Member log in";
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40">
      <div
        className={`transition-all duration-300 ease-out ${
          scrolled
            ? "mx-auto mt-2 w-[calc(100%-1rem)] max-w-3xl rounded-2xl border border-line bg-deep/95 shadow-xl backdrop-blur"
            : "w-full border-b border-line bg-deep/95 backdrop-blur"
        }`}
      >
        <div
          className={`mx-auto flex w-full items-center justify-between gap-3 px-4 transition-all duration-300 ${
            scrolled ? "max-w-3xl py-1.5" : "max-w-6xl py-3"
          }`}
        >
          <Link href="/" aria-label="Raceground home" className="shrink-0">
            <Wordmark className={`transition-all duration-300 ${scrolled ? "text-lg" : "text-2xl"}`} />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent(link.href) ? "page" : undefined}
                className={`display rounded-lg tracking-wide transition-all duration-300 ${scrolled ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"} ${
                  isCurrent(link.href) ? "text-flag" : "text-ink-600 hover:text-ink-950"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {ready ? (
              <Link
                href={accountHref}
                className={`display hidden rounded-lg tracking-wide text-ink-600 transition-all duration-300 hover:text-ink-950 sm:block ${
                  scrolled ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
                }`}
              >
                {accountLabel}
              </Link>
            ) : null}
            <ButtonLink href="/book" variant="primary" size={scrolled ? "sm" : "md"}>
              Book now
            </ButtonLink>
          </div>
        </div>
      </div>

      {/* On a phone the main links do not fit beside the wordmark, so they sit under it. */}
      <nav
        aria-label="Main, small screens"
        className={`border-b border-line bg-night/90 backdrop-blur transition-opacity duration-300 md:hidden ${scrolled ? "opacity-0" : "opacity-100"}`}
        inert={scrolled || undefined}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className={`display shrink-0 rounded-lg px-3 py-1.5 text-xs tracking-wide transition ${
                isCurrent(link.href) ? "bg-flag text-on-flag" : "text-ink-600"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
