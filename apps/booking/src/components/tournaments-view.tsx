"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { Reveal } from "@/components/reveal";
import { Badge, Button, ButtonLink, Field, Input, Notice, Spinner } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatCents, formatWallTime } from "@/lib/format";
import type { Tournament, TournamentSignUpResult } from "@/lib/types";

interface TournamentList {
  timeZone: string;
  tournaments: Tournament[];
}

/**
 * Signing up for a tournament (D68).
 *
 * With nothing published and upcoming, the page says so rather than showing an empty list. A member
 * with a free entry left is signed up on the spot; everyone else goes to payment. The API decides
 * which, so this never has to know a tier's allowance.
 */
export function TournamentsView() {
  const router = useRouter();
  const { session, account, request } = useAccount();
  const member = account?.member?.eligible ? account.member : null;

  const [list, setList] = useState<TournamentList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<TournamentList>("/public/tournaments")
      .then((data) => !cancelled && setList(data))
      .catch((err: unknown) => !cancelled && setLoadError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [request]);

  const open = useMemo(() => list?.tournaments.find((t) => t.id === openId) ?? null, [list, openId]);

  /** A member's percentage applies to the entry fee, exactly as it does to a booking. */
  const entryTotal = (t: Tournament) => (member ? Math.round((t.entryFeeCents * (10_000 - member.tier.discountBp)) / 10_000) : t.entryFeeCents);

  const contactGiven = session ? true : customer.name.trim() !== "" && (customer.email.trim() !== "" || customer.phone.trim() !== "");

  async function signUp(tournament: Tournament) {
    setSigningUp(true);
    setSignUpError(null);
    try {
      const result = await request<TournamentSignUpResult>("/tournaments/signup", {
        body: {
          tournamentId: tournament.id,
          ...(session
            ? {}
            : {
                customer: {
                  name: customer.name.trim(),
                  ...(customer.email.trim() ? { email: customer.email.trim() } : {}),
                  ...(customer.phone.trim() ? { phone: customer.phone.trim() } : {}),
                },
              }),
          expectedTotalCents: entryTotal(tournament),
          acceptTerms: true,
        },
      });
      if (result.status === "pending_payment") {
        window.location.assign(result.checkoutUrl);
        return;
      }
      router.push(`/tournaments/${result.ref}?token=${encodeURIComponent(result.token)}`);
    } catch (err) {
      setSigningUp(false);
      setSignUpError(errorMessage(err));
    }
  }

  if (loadError) return <Notice tone="error">{loadError}</Notice>;
  if (!list) return <Spinner label="Looking for tournaments…" />;

  if (list.tournaments.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-paper/70 p-10 text-center">
        <span aria-hidden className="text-5xl">
          🏁
        </span>
        <h2 className="display mt-4 text-2xl">No tournament available</h2>
        <p className="mx-auto mt-3 max-w-md text-ink-600">
          There&apos;s nothing on the calendar right now. Check back soon, or book a session in the meantime.
        </p>
        <ButtonLink href="/book" variant="primary" className="mt-6">
          Book a session
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {list.tournaments.map((tournament, i) => {
        const total = entryTotal(tournament);
        const isOpen = open?.id === tournament.id;
        return (
          <Reveal key={tournament.id} delayMs={i * 80}>
            <article className="overflow-hidden rounded-2xl border border-line bg-paper/80">
              <div aria-hidden className="checkers-thin" />
              <div className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="display text-2xl">{tournament.name}</h2>
                    <p className="mt-1 text-sm text-gold">
                      {tournament.venueDate} · {formatWallTime(tournament.venueTime)}
                    </p>
                    {tournament.blurb ? <p className="mt-3 max-w-xl text-sm text-ink-600">{tournament.blurb}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="display tnum text-3xl text-flag">{total === 0 ? "Free" : formatCents(total)}</p>
                    {member && total !== tournament.entryFeeCents ? (
                      <p className="tnum text-xs text-ink-500 line-through">{formatCents(tournament.entryFeeCents)}</p>
                    ) : null}
                    <p className="mt-2">
                      {tournament.full ? (
                        <Badge tone="quiet">Full</Badge>
                      ) : (
                        <Badge tone={tournament.spotsLeft <= 3 ? "flag" : "quiet"}>
                          {tournament.spotsLeft} {tournament.spotsLeft === 1 ? "spot" : "spots"} left
                        </Badge>
                      )}
                    </p>
                  </div>
                </div>

                {tournament.full ? (
                  <p className="mt-5 text-sm text-ink-500">This one is full. Keep an eye out for the next.</p>
                ) : isOpen ? (
                  <div className="mt-6 space-y-4 border-t border-line pt-6">
                    {member ? (
                      <Notice tone="good">
                        Signing up as {account!.customer.name} · {member.tier.name} member
                      </Notice>
                    ) : session ? (
                      <Notice>Signing up as {account?.customer.name}.</Notice>
                    ) : (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <Field label="Name">
                              <Input autoComplete="name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                            </Field>
                          </div>
                          <Field label="Email" hint="For your entry confirmation.">
                            <Input type="email" autoComplete="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
                          </Field>
                          <Field label="Phone" hint="Either email or phone is enough.">
                            <Input type="tel" autoComplete="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                          </Field>
                        </div>
                        <p className="text-sm text-ink-500">
                          Members:{" "}
                          <Link href="/login?next=/tournaments" className="underline">
                            log in
                          </Link>{" "}
                          for your discount.
                        </p>
                      </>
                    )}

                    <label className="flex items-start gap-3 text-sm">
                      <input type="checkbox" className="mt-1 size-4 accent-[var(--color-flag)]" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
                      <span>
                        I accept the{" "}
                        <a href="/terms" className="underline" target="_blank" rel="noreferrer">
                          terms
                        </a>
                        . Entry fees are not refundable once the tournament starts.
                      </span>
                    </label>

                    {signUpError ? <Notice tone="error">{signUpError}</Notice> : null}
                    {!contactGiven ? <p className="text-sm text-ink-500">Add your name and an email or phone number to continue.</p> : null}

                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" size="lg" disabled={!contactGiven || !acceptTerms || signingUp} onClick={() => void signUp(tournament)}>
                        {signingUp ? "One moment…" : total === 0 ? "Confirm my spot" : `Pay ${formatCents(total)}`}
                      </Button>
                      <Button onClick={() => setOpenId(null)}>Not now</Button>
                    </div>
                    {total > 0 ? <p className="text-xs text-ink-500">You&apos;ll pay securely on Stripe. We never see your card details.</p> : null}
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    className="mt-6"
                    onClick={() => {
                      setOpenId(tournament.id);
                      setSignUpError(null);
                    }}
                  >
                    Sign up
                  </Button>
                )}
              </div>
            </article>
          </Reveal>
        );
      })}
    </div>
  );
}
