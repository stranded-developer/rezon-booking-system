import Link from "next/link";
import { Wordmark } from "@/components/ui";
import type { PublicConfig } from "@/lib/types";

/** Contact details come from the back office (D58); with none set, those lines simply aren't there. */
export function SiteFooter({ venue }: { venue: PublicConfig["venue"] | null }) {
  return (
    <footer>
      <div className="border-t border-line bg-night">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-4 py-14 lg:grid-cols-4">
          <div className="col-span-2 lg:col-span-1">
            <Wordmark className="text-base" />
            <p className="mt-3 max-w-xs text-sm text-ink-600">Billiards, driving simulators and VR in Sydney.</p>
          </div>

          <div>
            <h2 className="kicker text-ink-950!">Find us</h2>
            <ul className="mt-4 space-y-2 text-sm text-ink-600">
              {venue?.address ? (
                <li>
                  <a
                    className="transition hover:text-ink-950"
                    href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {venue.address}
                  </a>
                </li>
              ) : null}
              {venue?.phone ? (
                <li>
                  <a className="transition hover:text-ink-950" href={`tel:${venue.phone.replace(/\s/g, "")}`}>
                    {venue.phone}
                  </a>
                </li>
              ) : null}
              {venue?.email ? (
                <li>
                  <a className="transition hover:text-ink-950" href={`mailto:${venue.email}`}>
                    {venue.email}
                  </a>
                </li>
              ) : null}
              {!venue?.address && !venue?.phone && !venue?.email ? <li>Contact details are coming soon.</li> : null}
            </ul>
          </div>

          <div>
            <h2 className="kicker text-ink-950!">Quick links</h2>
            <ul className="mt-4 space-y-2 text-sm text-ink-600">
              {[
                { href: "/book", label: "Book a session" },
                { href: "/tournaments", label: "Tournaments" },
                { href: "/membership", label: "Membership" },
                { href: "/contact", label: "Hours and contact" },
                { href: "/clothing", label: "Clothing" },
                { href: "/login", label: "Member log in" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition hover:text-ink-950">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-2 lg:col-span-1">
            <h2 className="kicker text-ink-950!">The small print</h2>
            <ul className="mt-4 space-y-2 text-sm text-ink-600">
              <li>
                <Link href="/terms" className="transition hover:text-ink-950">
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/refund-policy" className="transition hover:text-ink-950">
                  Cancellations &amp; refunds
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="transition hover:text-ink-950">
                  Privacy
                </Link>
              </li>
            </ul>
            {venue?.instagramUrl ? (
              <a
                href={venue.instagramUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-600 transition hover:text-ink-950"
              >
                Instagram
              </a>
            ) : null}
          </div>
        </div>

        <div className="border-t border-line">
          <p className="mx-auto w-full max-w-6xl px-4 py-5 text-xs text-ink-500">
            © {new Date().getFullYear()} Racegrounds, Sydney. All prices include GST. All times are Sydney time.
          </p>
        </div>
      </div>
    </footer>
  );
}
