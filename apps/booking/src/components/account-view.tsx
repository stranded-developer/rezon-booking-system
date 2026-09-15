"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useAccount } from "@/components/account-provider";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { formatCents, formatMinutes, formatVenueDate } from "@/lib/format";
import type { BookingSummary, LedgerEntry, PublicConfig } from "@/lib/types";
import { Button, ButtonLink, Card, Notice, Row, Spinner } from "@/components/ui";

const STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for your first payment",
  active: "Active",
  past_due: "Payment failed — benefits paused",
  cancelling: "Active until the end of this period",
  ended: "Ended",
};

export function AccountView() {
  const router = useRouter();
  const search = useSearchParams();
  const { session, ready, account, accountError, reloadAccount, request, signOut } = useAccount();
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [bookings, setBookings] = useState<BookingSummary[] | null>(null);
  const [tiers, setTiers] = useState<PublicConfig["tiers"]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !session) router.replace("/login?next=/account");
  }, [ready, session, router]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void request<{ bookings: BookingSummary[] }>("/me/bookings")
      .then((r) => !cancelled && setBookings(r.bookings))
      .catch(() => !cancelled && setBookings([]));
    if (account.member) {
      void request<{ entries: LedgerEntry[] }>("/me/ledger")
        .then((r) => !cancelled && setLedger(r.entries))
        .catch(() => !cancelled && setLedger([]));
    }
    return () => {
      cancelled = true;
    };
  }, [account, request]);

  useEffect(() => {
    let cancelled = false;
    void request<PublicConfig>("/public/config")
      .then((c) => !cancelled && setTiers(c.tiers))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [request]);

  async function run(label: string, fn: () => Promise<string | null>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const done = await fn();
      if (done) setNote(done);
      reloadAccount();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!ready || (session && !account && !accountError)) return <Spinner label="Loading your account…" />;
  if (!session) return <Spinner label="Taking you to the log in page…" />;
  if (accountError) return <Notice tone="error">{accountError}</Notice>;
  if (!account) return <Spinner label="Loading your account…" />;

  const member = account.member;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Hi {account.customer.name || "there"}</h1>
          <p className="text-sm text-ink-500">{account.customer.email}</p>
        </div>
        <Button
          onClick={() =>
            void signOut().then(() => router.replace("/"))
          }
        >
          Log out
        </Button>
      </div>

      {search.get("membership") === "started" ? <Notice tone="good">Thanks! Your membership starts as soon as Stripe confirms the payment.</Notice> : null}
      {note ? <Notice tone="good">{note}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {member ? (
        <Card title={`${member.tier.name} membership`}>
          <div className="space-y-1">
            <Row label="Member number" value={member.memberNo} />
            <Row label="Status" value={STATUS_TEXT[member.status] ?? member.status} />
            <Row label="Discount" value={`${member.tier.discountBp / 100}% off every session`} />
            {member.currentPeriodEnd ? (
              <Row label={member.status === "cancelling" ? "Benefits end" : "Renews"} value={formatVenueDate(member.currentPeriodEnd.slice(0, 10))} />
            ) : null}
            {member.pendingTier ? <Row label="Changing to" value={`${member.pendingTier.name} at the next renewal`} /> : null}
            <Row label="Free play" value={formatMinutes(member.balanceMinutes)} strong />
          </div>

          {member.qr ? (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-xl bg-mist p-5">
              <div data-testid="member-qr">
                <QRCodeSVG value={member.qr} size={160} level="M" />
              </div>
              <p className="text-center text-sm text-ink-600">Show this at the counter. It&apos;s the same code every time.</p>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void run("qr", async () => {
                    if (!window.confirm("Get a new QR code? Any printed card or screenshot stops working.")) return null;
                    await request("/me/qr/reissue", { body: {} });
                    return "Your new QR code is ready. Older codes no longer work.";
                  })
                }
              >
                Get a new code
              </Button>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
            {member.billedOnline ? (
              <>
                {member.status === "cancelling" ? (
                  <Button
                    variant="primary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("resume", async () => {
                        await request("/me/membership/resume", { body: {} });
                        return "Your membership will keep going.";
                      })
                    }
                  >
                    Keep my membership
                  </Button>
                ) : (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run("cancel", async () => {
                        if (!window.confirm("Cancel at the end of this period? You keep your benefits until then.")) return null;
                        await request("/me/membership/cancel", { body: {} });
                        return "Your membership ends at the end of this period.";
                      })
                    }
                  >
                    Cancel membership
                  </Button>
                )}
                {account.canManageBilling ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run("portal", async () => {
                        const r = await request<{ url: string }>("/me/portal", { body: {} });
                        window.location.assign(r.url);
                        return null;
                      })
                    }
                  >
                    Card and invoices
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-500">Your membership is managed by the venue. Ask at the counter to change it.</p>
            )}
          </div>

          {member.billedOnline && tiers.length > 1 ? (
            <div className="mt-5 border-t border-line pt-5">
              <p className="text-sm font-medium">Change tier</p>
              <p className="text-sm text-ink-500">The new price applies from your next renewal.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {tiers
                  .filter((t) => t.id !== member.tier.id && t.sellable)
                  .map((t) => (
                    <Button
                      key={t.id}
                      disabled={busy !== null}
                      onClick={() =>
                        void run("tier", async () => {
                          await request("/me/membership/tier", { body: { tierId: t.id } });
                          return `You're moving to ${t.name} at your next renewal.`;
                        })
                      }
                    >
                      {t.name} · {formatCents(t.monthlyPriceCents)}/mo
                    </Button>
                  ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card title="No membership yet">
          <p className="text-sm text-ink-600">Members get a discount on every session and free play minutes each month.</p>
          <div className="mt-4">
            <ButtonLink href="/membership" variant="primary">
              See the tiers
            </ButtonLink>
          </div>
        </Card>
      )}

      {member ? (
        <Card title="Free play history">
          {ledger === null ? (
            <Spinner label="Loading…" />
          ) : ledger.length === 0 ? (
            <p className="text-sm text-ink-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {ledger.map((entry, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2">
                  <span>
                    <span className="block">{entry.reason ?? entry.kind}</span>
                    <span className="text-ink-500">
                      {formatVenueDate(entry.at.slice(0, 10))}
                      {entry.bookingRef ? ` · booking ${entry.bookingRef}` : ""}
                    </span>
                  </span>
                  <span className={`tnum font-semibold ${entry.minutes < 0 ? "text-ink-600" : "text-emerald-700"}`}>
                    {entry.minutes > 0 ? "+" : ""}
                    {entry.minutes} min
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title="Your bookings">
        {bookings === null ? (
          <Spinner label="Loading…" />
        ) : bookings.length === 0 ? (
          <p className="text-sm text-ink-500">
            No bookings yet.{" "}
            <Link href="/book" className="underline">
              Book a time
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="block font-medium">
                    {b.resourceType} · {b.resource}
                  </span>
                  <span className="text-ink-500">
                    {b.venueDate}, {b.venueStartTime}–{b.venueEndTime} · {b.ref}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tnum">{formatCents(b.totalCents ?? 0)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.status === "confirmed" ? "bg-emerald-50 text-emerald-800" : "bg-mist text-ink-600"}`}>
                    {b.status === "confirmed" ? "Confirmed" : b.status === "cancelled" ? "Cancelled" : b.status}
                  </span>
                  {b.status === "confirmed" ? (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`cancel-${b.ref}`, async () => {
                          const view = await request<{ booking: { cancellation: { allowed: boolean; refundCents: number } | null } }>(`/me/bookings/${b.ref}`);
                          const quote = view.booking.cancellation;
                          if (!quote?.allowed) {
                            throw new ApiRequestError(409, "too_late", "It's too close to the start to cancel online. Please call the venue.");
                          }
                          if (!window.confirm(`Cancel booking ${b.ref}? You'll get ${formatCents(quote.refundCents)} back.`)) return null;
                          const r = await request<{ refundCents: number; minutesReturned: number }>(`/me/bookings/${b.ref}/cancel`, {
                            body: { expectedRefundCents: quote.refundCents },
                          });
                          setBookings(null);
                          void request<{ bookings: BookingSummary[] }>("/me/bookings").then((res) => setBookings(res.bookings));
                          return `Booking ${b.ref} is cancelled. ${r.refundCents > 0 ? `${formatCents(r.refundCents)} is on its way back to your card.` : "No refund applied."}${
                            r.minutesReturned > 0 ? ` ${r.minutesReturned} free minutes are back.` : ""
                          }`;
                        })
                      }
                    >
                      Cancel
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
