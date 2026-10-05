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
  { href: "/clothing", label: "Clothing" },
];

/**
 * The mockup's header (D88): one rounded, bordered bar inset from the edges, with the wordmark,
 * "Book now" and — on a phone — a menu button that opens the links underneath. On a wide screen
 * the links sit in the bar itself.
 *
 * It stays one bar, never two cross-fading copies: two would put two "Book now" links and two
 * navigations in the page at once for anyone on a screen reader or a keyboard.
 */
export function SiteHeader() {
  const { session, ready } = useAccount();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The menu closes when the page changes, so a tap on a link doesn't leave it hanging open.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const accountHref = session ? "/account" : "/login";
  const accountLabel = session ? "My account" : "Member log in";
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 px-3 pt-3">
      <div className="mx-auto max-w-6xl rounded-xl border border-line bg-deep/85 shadow-lg shadow-black/30 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link href="/" aria-label="Racegrounds home" className="shrink-0">
            <Wordmark className="text-xs sm:text-sm" />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent(link.href) ? "page" : undefined}
                className={`kicker rounded-lg px-3 py-2 transition ${isCurrent(link.href) ? "" : "text-ink-600! hover:text-ink-950!"}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {ready ? (
              <Link href={accountHref} className="kicker hidden px-2 py-2 text-ink-600! transition hover:text-ink-950! lg:block">
                {accountLabel}
              </Link>
            ) : null}
            <ButtonLink href="/book" variant="primary" size="sm">
              Book now
            </ButtonLink>
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((v) => !v)}
              className="grid size-9 place-items-center rounded-lg text-ink-800 transition hover:bg-mist lg:hidden"
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <path d="M4 9h16M8 15h12" strokeLinecap="round" />}
              </svg>
            </button>
          </div>
        </div>

        {open ? (
          <nav id="site-menu" aria-label="Main, small screens" className="animate-fade border-t border-line px-2 pb-3 pt-2 lg:hidden">
            <ul>
              {[...LINKS, ...(ready ? [{ href: accountHref, label: accountLabel }] : [])].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isCurrent(link.href) ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`display flex items-center justify-between rounded-lg px-3 py-3 text-base transition hover:bg-mist ${isCurrent(link.href) ? "text-flag" : ""}`}
                  >
                    {link.label}
                    <span aria-hidden className="text-ink-500">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
