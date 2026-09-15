"use client";

import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import { ButtonLink, Wordmark } from "@/components/ui";

export function SiteHeader() {
  const { session, ready } = useAccount();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" aria-label="Raceground home">
          <Wordmark className="text-xl" />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/membership" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-mist sm:block">
            Membership
          </Link>
          {ready ? (
            <Link href={session ? "/account" : "/login"} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-mist">
              {session ? "My account" : "Member log in"}
            </Link>
          ) : null}
          <ButtonLink href="/book" variant="primary">
            Book now
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
