import Image from "next/image";
import { connection } from "next/server";
import { api } from "@/lib/api";
import { dayName, formatCents, formatRate, formatWallTime } from "@/lib/format";
import type { PublicConfig } from "@/lib/types";
import { ButtonLink, Card, Notice } from "@/components/ui";

/** The venue's own details and photos come from the back office (D58). */
export default async function HomePage() {
  // Render per request: a change in the back office should show on the site straight away.
  await connection();
  let config: PublicConfig | null = null;
  try {
    config = await api<PublicConfig>("/public/config");
  } catch {
    config = null;
  }

  if (!config) {
    return (
      <div className="space-y-6">
        <Hero intro={null} />
        <Notice tone="warn">Our booking system is having a moment. Please try again shortly, or call the venue.</Notice>
      </div>
    );
  }

  const { venue, photos, resourceTypes, openingHours, happyHours, tiers } = config;
  const happyHour = happyHours[0];

  return (
    <div className="space-y-10">
      <Hero intro={venue.intro} />

      {photos.length > 0 ? (
        <section aria-label="Photos of the venue" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <figure key={photo.url} className="overflow-hidden rounded-2xl border border-line bg-paper">
              <Image
                src={photo.url}
                alt={photo.caption ?? "Raceground"}
                width={640}
                height={420}
                sizes="(max-width: 640px) 50vw, 33vw"
                className="h-40 w-full object-cover sm:h-48"
              />
              {photo.caption ? <figcaption className="px-3 py-2 text-xs text-ink-500">{photo.caption}</figcaption> : null}
            </figure>
          ))}
        </section>
      ) : null}

      <Card title="What you can book" className="scroll-mt-20">
        <div id="rates" className="grid gap-4 sm:grid-cols-3">
          {resourceTypes.map((type) => (
            <div key={type.id} className="rounded-xl border border-line p-4">
              <h3 className="font-bold">{type.name}</h3>
              <p className="mt-1 text-2xl font-black tnum">{formatRate(type.baseRateCents)}</p>
              <p className="text-sm text-ink-500">incl. GST · from {type.minMinutes} min</p>
              <p className="mt-2 text-sm text-ink-600">{type.resources.length} available</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-500">
          Time is billed per minute after the first {resourceTypes[0]?.minMinutes ?? 15} minutes. Every price shown includes GST.
        </p>
        {happyHour ? (
          <p className="mt-3 rounded-xl bg-flag/40 px-4 py-3 text-sm font-medium">
            {happyHour.name}: {happyHour.discountBp / 100}% off {happyHour.daysOfWeek.map((d) => dayName(d).slice(0, 3)).join(", ")}{" "}
            {formatWallTime(happyHour.startTime)}–{formatWallTime(happyHour.endTime)}.
          </p>
        ) : null}
        <div className="mt-5">
          <ButtonLink href="/book" variant="primary" size="lg">
            See what&apos;s free
          </ButtonLink>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Opening hours">
          <ul className="space-y-1 text-sm">
            {openingHours.map((day) => (
              <li key={day.dayOfWeek} className="flex justify-between gap-4">
                <span className="text-ink-600">{dayName(day.dayOfWeek)}</span>
                <span className="tnum font-medium">{day.closed ? "Closed" : `${formatWallTime(day.open)} – ${formatWallTime(day.close)}`}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-ink-500">All times are Sydney time. You can book up to {config.bookingWindowDays} days ahead.</p>
        </Card>

        <Card title="Find us">
          <ul className="space-y-3 text-sm">
            {venue.address ? (
              <li>
                <span className="block text-ink-500">Address</span>
                <a className="font-medium underline-offset-2 hover:underline" href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`} target="_blank" rel="noreferrer">
                  {venue.address}
                </a>
              </li>
            ) : null}
            {venue.phone ? (
              <li>
                <span className="block text-ink-500">Phone</span>
                <a className="font-medium" href={`tel:${venue.phone.replace(/\s/g, "")}`}>
                  {venue.phone}
                </a>
              </li>
            ) : null}
            {venue.email ? (
              <li>
                <span className="block text-ink-500">Email</span>
                <a className="font-medium" href={`mailto:${venue.email}`}>
                  {venue.email}
                </a>
              </li>
            ) : null}
            {venue.instagramUrl ? (
              <li>
                <a className="font-medium underline-offset-2 hover:underline" href={venue.instagramUrl} target="_blank" rel="noreferrer">
                  Instagram
                </a>
              </li>
            ) : null}
            {!venue.address && !venue.phone && !venue.email ? <li className="text-ink-500">Contact details are coming soon.</li> : null}
          </ul>
        </Card>
      </div>

      {tiers.length > 0 ? (
        <Card title="Membership" className="scroll-mt-20">
          <div id="membership" className="grid gap-4 sm:grid-cols-3">
            {tiers.map((tier) => (
              <div key={tier.id} className="rounded-xl border border-line p-4">
                <h3 className="font-bold">{tier.name}</h3>
                <p className="mt-1 text-xl font-black tnum">{formatCents(tier.monthlyPriceCents)}<span className="text-sm font-medium text-ink-500">/month</span></p>
                <ul className="mt-2 space-y-1 text-sm text-ink-600">
                  <li>{tier.discountBp / 100}% off every session</li>
                  <li>{tier.monthlyFreeMinutes} free minutes a month</li>
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink-500">Unused free minutes roll over, up to {tiers[0]?.maxBalanceMinutes ?? 600} minutes.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/membership" variant="primary">
              Join online
            </ButtonLink>
            <ButtonLink href="/login">Member log in</ButtonLink>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Hero({ intro }: { intro: string | null }) {
  return (
    <section className="rounded-3xl border border-line bg-paper p-6 sm:p-10">
      <p className="text-sm font-semibold uppercase tracking-widest text-ink-500">Sydney</p>
      <h1 className="mt-2 text-3xl font-black leading-tight sm:text-5xl">
        Billiards, driving sims and VR.
        <br />
        Booked in a minute.
      </h1>
      <p className="mt-4 max-w-2xl text-ink-600">{intro ?? "Pick a time, pay online and show your booking code at the counter."}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/book" variant="primary" size="lg">
          Book now
        </ButtonLink>
        <ButtonLink href="/#rates" size="lg">
          See rates
        </ButtonLink>
      </div>
    </section>
  );
}
