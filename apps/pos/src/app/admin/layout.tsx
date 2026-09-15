"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { usePos } from "@/components/pos-provider";
import { Button } from "@/components/ui";
import { Wordmark } from "@/components/wordmark";

const NAV = [
  { href: "/admin/sales", label: "Sales" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/shifts", label: "Shifts" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/referrals", label: "Referral codes" },
  { href: "/admin/pricing", label: "Rates & happy hours" },
  { href: "/admin/tiers", label: "Membership tiers" },
  { href: "/admin/venue", label: "Venue & hours" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/audit", label: "Audit log" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { operator, lock } = usePos();
  const pathname = usePathname();

  if (operator?.role !== "superadmin") {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">The back office is for superadmins</h1>
          <p className="text-ink-400">Lock the POS and sign in with a superadmin PIN.</p>
          <div className="flex justify-center gap-2">
            <Link href="/" className="inline-flex h-11 items-center rounded-lg bg-ink-800 px-4 text-sm font-semibold ring-1 ring-ink-700">
              Back to the floor
            </Link>
            <Button variant="primary" onClick={lock}>
              Lock
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 p-4 md:flex">
        <Wordmark className="px-2 text-lg" />
        <p className="mb-6 px-2 text-xs uppercase tracking-widest text-ink-400">Back office</p>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm ${pathname.startsWith(item.href) ? "bg-ink-800 font-semibold text-ink-50" : "text-ink-200 hover:bg-ink-900"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t border-ink-800 pt-4">
          <Link href="/" className="block rounded-lg px-3 py-2 text-sm text-ink-200 hover:bg-ink-900">
            ← Back to the floor
          </Link>
          <div className="px-3 text-sm">
            <span className="font-semibold">{operator.displayName}</span>
          </div>
          <Button variant="primary" size="sm" className="w-full" onClick={lock}>
            Lock
          </Button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="flex gap-2 overflow-x-auto border-b border-ink-800 p-3 md:hidden">
          <Link href="/" className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-ink-200">
            ← Floor
          </Link>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${pathname.startsWith(item.href) ? "bg-ink-800" : "text-ink-200"}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="mx-auto max-w-6xl p-6">{children}</main>
      </div>
    </div>
  );
}
