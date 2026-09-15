"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { errorMessage } from "@/lib/api";
import { formatCents } from "@/lib/format";
import type { PublicConfig } from "@/lib/types";
import { Button, ButtonLink, Card, Notice, Spinner } from "@/components/ui";

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
  const cap = config.tiers[0]?.maxBalanceMinutes ?? 600;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black sm:text-3xl">Membership</h1>
        <p className="mt-1 text-ink-600">A discount on every session and free play minutes each month. Cancel any time.</p>
      </div>

      {search.get("cancelled") === "1" ? <Notice tone="warn">No payment was taken, so no membership was started.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {member?.eligible ? (
        <Notice tone="good">
          You&apos;re a {member.tier.name} member.{" "}
          <a href="/account" className="underline">
            Manage it in your account
          </a>
          .
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {config.tiers.map((tier) => (
          <Card key={tier.id} title={tier.name}>
            <p className="text-2xl font-black tnum">
              {formatCents(tier.monthlyPriceCents)}
              <span className="text-sm font-medium text-ink-500">/month</span>
            </p>
            <ul className="mt-3 space-y-1 text-sm text-ink-600">
              <li>{tier.discountBp / 100}% off every session</li>
              <li>{tier.monthlyFreeMinutes} free minutes a month</li>
              <li>Unused minutes roll over, up to {cap}</li>
            </ul>
            <div className="mt-5">
              {member?.eligible ? (
                <ButtonLink href="/account">Manage membership</ButtonLink>
              ) : tier.sellable ? (
                <Button variant="primary" className="w-full" disabled={busy !== null || !ready} onClick={() => void join(tier.id)}>
                  {busy === tier.id ? "Taking you to payment…" : session ? `Join ${tier.name}` : `Join ${tier.name}`}
                </Button>
              ) : (
                <p className="text-sm text-ink-500">Ask at the counter to join this tier.</p>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card title="How joining works">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-600">
          <li>Create an account and confirm your email — that keeps your membership yours.</li>
          <li>Pay securely on Stripe. Your card is stored by Stripe, never by us.</li>
          <li>Your discount, free minutes and member QR appear in your account straight away.</li>
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
    </div>
  );
}
