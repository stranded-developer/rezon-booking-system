"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { Reveal } from "@/components/reveal";
import { errorMessage } from "@/lib/api";
import { formatCents, formatMinutes } from "@/lib/format";
import type { Experience, PublicConfig } from "@/lib/types";
import { Badge, Button, ButtonLink, Card, Checkers, Notice, SectionTitle, Spinner } from "@/components/ui";

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
        <h1 className="display text-4xl sm:text-6xl">
          Become a <span className="text-flag">member</span> and take your Raceground further
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

        <Reveal>
          <SectionTitle kicker="Pick your level">
            Choose your <span className="text-gold">membership tier</span>
          </SectionTitle>
          <p className="mx-auto mt-4 max-w-xl text-center text-sm text-ink-600">
            Ready, set, go. Every tier takes a percentage off every booking and gives you free play each month. Cancel any time.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {tiers.map((tier, i) => {
            const sessions = Math.floor(tier.monthlyFreeMinutes / config.sessionMinutes);
            const mostPopular = i === 1;
            return (
              <Reveal key={tier.id} delayMs={i * 90}>
                <article
                  className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-paper/80 ${
                    mostPopular ? "border-gold/60 shadow-[0_0_40px_-20px_var(--color-gold)]" : "border-line"
                  }`}
                >
                  <div aria-hidden className="checkers-thin" />
                  <div className="flex flex-1 flex-col p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="display text-2xl text-gold">{tier.name}</h3>
                      {mostPopular ? <Badge tone="gold">Most popular</Badge> : null}
                    </div>
                    <p className="display tnum mt-3 text-4xl">
                      {formatCents(tier.monthlyPriceCents)}
                      <span className="text-base text-ink-500">/mo</span>
                    </p>

                    {/* What the system actually enforces (D67). */}
                    <ul className="mt-5 space-y-2 text-sm text-ink-600">
                      <li className="flex gap-2">
                        <span aria-hidden className="text-flag">
                          ✓
                        </span>
                        <span className="text-ink-950">{tier.discountBp / 100}% off every booking</span>
                      </li>
                      <li className="flex gap-2">
                        <span aria-hidden className="text-flag">
                          ✓
                        </span>
                        {sessions > 0 ? `${sessions} free ${sessions === 1 ? "race" : "races"} a month` : `${formatMinutes(tier.monthlyFreeMinutes)} free play a month`}
                      </li>
                      <li className="flex gap-2">
                        <span aria-hidden className="text-flag">
                          ✓
                        </span>
                        Unused free play rolls over, up to {formatMinutes(tier.maxBalanceMinutes)}
                      </li>
                      {/* Listed, honoured by staff at the counter rather than enforced (D67). */}
                      {tier.perks.map((perk) => (
                        <li key={perk} className="flex gap-2">
                          <span aria-hidden className="text-gold">
                            ★
                          </span>
                          {perk}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-6 flex-1" />
                    {member?.eligible ? (
                      <ButtonLink href="/account" className="w-full">
                        Manage membership
                      </ButtonLink>
                    ) : tier.sellable ? (
                      <Button variant={mostPopular ? "gold" : "primary"} className="w-full" disabled={busy !== null || !ready} onClick={() => void join(tier.id)}>
                        {busy === tier.id ? "Taking you to payment…" : `Join ${tier.name}`}
                      </Button>
                    ) : (
                      <p className="rounded-xl border border-line px-4 py-3 text-center text-sm text-ink-500">Ask at the counter to join this tier</p>
                    )}
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-ink-500">
          Perks marked ★ are honoured by our staff at the counter. Everything else is applied automatically.
        </p>
      </section>

      <MemberPrices config={config} tiers={tiers} />

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

/**
 * What each tier actually pays for the experiences.
 *
 * Worked out from the tier's own percentage and the experience's own price, so it is the price the
 * customer will really be charged — not a rounded figure typed into the page (D67).
 */
function MemberPrices({ config, tiers }: { config: PublicConfig; tiers: PublicConfig["tiers"] }) {
  const experiences: Experience[] = config.experiences;
  if (experiences.length === 0 || tiers.length === 0) return null;
  const memberPrice = (cents: number, discountBp: number) => Math.round((cents * (10_000 - discountBp)) / 10_000);

  return (
    <section className="bg-night/60 py-14">
      <div className="mx-auto w-full max-w-4xl px-4">
        <Reveal>
          <SectionTitle kicker="What you'd pay">
            Member <span className="text-flag">prices</span>
          </SectionTitle>
        </Reveal>
        <Reveal className="mt-8 overflow-x-auto">
          <table className="w-full min-w-md border-collapse text-sm">
            <caption className="sr-only">What each membership tier pays for each experience</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="display px-3 py-3 text-left text-ink-600">
                  Experience
                </th>
                <th scope="col" className="display px-3 py-3 text-right text-ink-600">
                  Normal
                </th>
                {tiers.map((tier) => (
                  <th key={tier.id} scope="col" className="display px-3 py-3 text-right text-gold">
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {experiences.map((exp) => (
                <tr key={exp.id} className="border-b border-line/60">
                  <th scope="row" className="px-3 py-3 text-left font-medium text-ink-950">
                    {exp.name}
                    <span className="block text-xs font-normal text-ink-500">{formatMinutes(exp.minutes)}</span>
                  </th>
                  <td className="tnum px-3 py-3 text-right text-ink-600">{formatCents(exp.priceCents)}</td>
                  {tiers.map((tier) => (
                    <td key={tier.id} className="tnum px-3 py-3 text-right text-ink-950">
                      {formatCents(memberPrice(exp.priceCents, tier.discountBp))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
        <p className="mt-4 text-center text-xs text-ink-500">
          Member prices apply on top of any promotion, so during happy hour you pay less again.
        </p>
      </div>
    </section>
  );
}
