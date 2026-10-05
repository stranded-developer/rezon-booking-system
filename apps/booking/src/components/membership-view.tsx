"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { Reveal } from "@/components/reveal";
import { errorMessage } from "@/lib/api";
import { formatCents } from "@/lib/format";
import type { Experience, PublicConfig } from "@/lib/types";
import { Badge, Button, ButtonLink, Card, Checkers, Notice, Spinner } from "@/components/ui";

/** Joining online is account first (D60): the membership needs a login for the QR, balance and billing. */
export function MembershipView() {
  const router = useRouter();
  const search = useSearchParams();
  const { session, ready, account, request } = useAccount();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void request<PublicConfig>("/public/config")
      .then((c) => !cancelled && setConfig(c))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [request]);

  async function join(tierId: string) {
    if (!session) {
      router.push(`/signup?join=1`);
      return;
    }
    setBusy(tierId);
    setError(null);
    try {
      const r = await request<{ checkoutUrl: string }>("/me/membership/checkout", { body: { tierId } });
      window.location.assign(r.checkoutUrl);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  if (!config) return error ? <Notice tone="error">{error}</Notice> : <Spinner label="Loading memberships…" />;

  const member = account?.member ?? null;
  const tiers = config.tiers;
  const cheapest = tiers.reduce<number | null>((min, t) => (min === null || t.monthlyPriceCents < min ? t.monthlyPriceCents : min), null);

  return (
    <>
      <section className="mx-auto w-full max-w-4xl px-4 py-14 text-center">
        <h1 className="display text-3xl sm:text-5xl">
          Become a <span className="text-flag">member</span> and take your Racegrounds further
        </h1>
        {cheapest !== null ? (
          <p className="display mx-auto mt-6 inline-block rounded-xl border border-line bg-paper/70 px-5 py-3 text-lg">
            Memberships start at {formatCents(cheapest)} a month
          </p>
        ) : null}

        <div className="mx-auto mt-8 max-w-md rounded-2xl border border-line bg-paper/70 p-6">
          <p className="display text-xs tracking-[0.2em] text-flag">Member access</p>
          <p className="display mt-2 text-xl">Already a member?</p>
          <p className="mt-1 text-sm text-ink-600">Sign in to book with your discount and manage your membership.</p>
          <ButtonLink href={session ? "/account" : "/login"} variant="primary" className="mt-4">
            {session ? "My account" : "Member log in"}
          </ButtonLink>
        </div>
      </section>

      <Checkers />

      <section className="mx-auto w-full max-w-6xl px-4 py-14">
        {search.get("cancelled") === "1" ? (
          <div className="mb-6">
            <Notice tone="warn">No payment was taken, so no membership was started.</Notice>
          </div>
        ) : null}
        {error ? (
          <div className="mb-6">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
        {member?.eligible ? (
          <div className="mb-6">
            <Notice tone="good">
              You&apos;re a {member.tier.name} member.{" "}
              <a href="/account" className="underline">
                Manage it in your account
              </a>
              .
            </Notice>
          </div>
        ) : null}

        {/* The membership poster (D84): its layout, its words, and the venue's own numbers. */}
        <Reveal>
          <h2 className="display text-[2.1rem] leading-none sm:text-6xl">
            Membership
            <span className="block font-light">Promo price</span>
          </h2>
          <div aria-hidden className="mt-4 h-1 w-24 rounded-full bg-gold" />
        </Reveal>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {tiers.map((tier, i) => (
            <Reveal key={tier.id} delayMs={i * 90}>
              <TierCard
                tier={tier}
                config={config}
                mostPopular={i === 1}
                action={
                  member?.eligible ? (
                    <ButtonLink href="/account" className="w-full">
                      Manage membership
                    </ButtonLink>
                  ) : tier.sellable ? (
                    <Button variant={i === 1 ? "gold" : "primary"} className="w-full" disabled={busy !== null || !ready} onClick={() => void join(tier.id)}>
                      {busy === tier.id ? "Taking you to payment…" : `Join ${tier.name}`}
                    </Button>
                  ) : (
                    <p className="rounded-xl border border-line px-4 py-3 text-center text-sm text-ink-500">Ask at the counter to join this tier</p>
                  )
                }
              />
            </Reveal>
          ))}
        </div>
      </section>


      <section className="mx-auto w-full max-w-3xl px-4 pb-16">
        <Reveal>
          <Card title="How joining works">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-600">
              <li>Create an account and confirm your email — that keeps your membership yours.</li>
              <li>Pay securely on Stripe. Your card is stored by Stripe, never by us.</li>
              <li>Your discount, free play and member QR appear in your account straight away.</li>
            </ol>
            <p className="mt-4 text-sm text-ink-500">
              Already a member from the counter? Sign up with the email you gave us and your membership joins the account.
            </p>
            {!session ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <ButtonLink href="/signup?join=1" variant="primary">
                  Create an account
                </ButtonLink>
                <ButtonLink href="/login">Log in</ButtonLink>
              </div>
            ) : null}
          </Card>
        </Reveal>
      </section>
    </>
  );
}

/** Each tier's colour on the poster: silver, gold, and an icy blue for Diamond. */
const TIER_COLOURS = ["#c9ced6", "#d9a441", "#8fd3f4"];

/** "$48", "$19.50": whole dollars without cents, as the poster writes them. */
const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : formatCents(cents));

function TierCard({ tier, config, mostPopular, action }: { tier: PublicConfig["tiers"][number]; config: PublicConfig; mostPopular: boolean; action: ReactNode }) {
  const index = config.tiers.indexOf(tier);
  const colour = TIER_COLOURS[Math.min(index, TIER_COLOURS.length - 1)]!;
  const races = Math.floor(tier.monthlyFreeMinutes / config.sessionMinutes);
  // The race price block shows what this tier really pays: the experiences with a flat member price (D82).
  const racePrices = config.experiences
    .map((exp) => ({ exp, price: exp.memberPrices?.find((m) => m.tierId === tier.id)?.priceCents }))
    .filter((r): r is { exp: Experience; price: number } => r.price !== undefined);

  return (
    <article
      className="relative flex h-full flex-col rounded-2xl border-2 bg-night/80 px-6 pb-6 pt-10"
      style={{ borderColor: colour, boxShadow: mostPopular ? `0 0 48px -20px ${colour}` : undefined }}
    >
      {/* The RG badge sits on the top edge, as on the poster. */}
      <svg aria-hidden viewBox="0 0 64 72" className="absolute -top-8 left-1/2 h-16 w-14 -translate-x-1/2">
        <polygon points="32,2 62,19 62,53 32,70 2,53 2,19" fill="var(--color-night)" stroke={colour} strokeWidth="3" />
        <text x="32" y="43" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize="20" fill={colour}>
          RG
        </text>
      </svg>
      {mostPopular ? (
        <span className="absolute right-4 top-3">
          <Badge tone="gold">Most popular</Badge>
        </span>
      ) : null}

      <h3 className="display mt-2 text-center text-3xl">
        <span className="font-bold">{tier.name}</span> <span className="font-light">Tier</span>
      </h3>
      <p className="tnum mt-2 text-center">
        <span className="display text-5xl font-bold">{dollars(tier.monthlyPriceCents)}</span>
        <span className="ml-2 font-[family-name:var(--font-display)] text-2xl font-light text-ink-600">/ Month</span>
      </p>

      <div aria-hidden className="my-5 h-px" style={{ background: colour }} />

      <ul className="space-y-3 text-sm text-ink-800">
        {races > 0 ? (
          <li className="flex gap-3">
            <span aria-hidden>–</span>
            <span>
              <strong className="text-base font-extrabold text-ink-950">
                {races} {races === 1 ? "race" : "races"} per month
              </strong>
              <span className="block text-ink-600">(Only {dollars(Math.round(tier.monthlyPriceCents / races))} per race)</span>
            </span>
          </li>
        ) : null}
        {tier.perks.map((perk) => (
          <li key={perk} className="flex gap-3">
            <span aria-hidden>–</span>
            {perk}
          </li>
        ))}
        {tier.discountBp > 0 ? (
          <li className="flex gap-3">
            <span aria-hidden>–</span>
            {tier.discountBp / 100}% off next bookings
          </li>
        ) : null}
      </ul>

      <div className="flex-1" />

      {racePrices.length > 0 ? (
        <div className="mt-6 border-t pt-4" style={{ borderColor: colour }}>
          <p className="display text-xs tracking-[0.2em] text-ink-600">Race price</p>
          <ul className="mt-2 divide-y divide-line">
            {racePrices.map(({ exp, price }) => (
              <li key={exp.id} className="flex items-center justify-between gap-3 py-3">
                <span className="flex gap-3 text-sm text-ink-800">
                  <span aria-hidden>–</span>
                  <span>
                    {exp.name} <span className="text-xs text-ink-500">({exp.minutes % 60 === 0 ? `${exp.minutes / 60} hour` : `${exp.minutes} mins`})</span>
                  </span>
                </span>
                <span className="display tnum text-3xl font-bold">{dollars(price)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6">{action}</div>
    </article>
  );
}
