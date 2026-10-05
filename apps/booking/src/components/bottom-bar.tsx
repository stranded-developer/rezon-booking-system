"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Where "Explore" lands: the types of driving on the home page (D81). */
export const EXPLORE_ID = "explore";

const ITEMS = [
  {
    href: "/book",
    label: "Book now",
    primary: true,
    icon: <path d="M4 7h16M4 7v12h16V7M4 7l2-3h12l2 3M9 12h6" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    href: "/tournaments",
    label: "Events",
    primary: false,
    icon: <path d="M8 4h8v5a4 4 0 01-8 0V4zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    href: `/#${EXPLORE_ID}`,
    label: "Explore",
    primary: false,
    icon: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5 5-2z" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

/**
 * Three buttons fixed to the bottom of the screen on every page, so booking, events and the
 * showcase are always one tap away however far down someone has scrolled (D81).
 *
 * It sits under the booking panel and the event pop-up (z-30 against their z-50), and the layout
 * pads the page by its height so the footer is never hidden behind it.
 */
export function BottomBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Quick links"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-deep/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-3 gap-2 px-3 py-2">
        {ITEMS.map((item) => {
          const current = item.href === "/book" || item.href === "/tournaments" ? pathname.startsWith(item.href) : false;
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg font-[family-name:var(--font-display)] text-[0.6rem] font-bold uppercase tracking-[0.08em] transition ${
                  item.primary ? "bg-flag text-on-flag hover:bg-flag-bright" : current ? "bg-mist text-ink-950" : "text-ink-600 hover:bg-mist hover:text-ink-950"
                }`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
