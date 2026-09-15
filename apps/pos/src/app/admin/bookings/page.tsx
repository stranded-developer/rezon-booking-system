"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal, Row } from "@/components/ui";
import { formatCents } from "@raceground/pricing";
import { centsToInput, parseDollars } from "@/lib/format";

interface BookingRow {
  id: string;
  ref: string;
  status: string;
  resourceType: string;
  resource: string;
  venueDate: string;
  venueStartTime: string;
  venueEndTime: string;
  totalCents: number | null;
  freeMinutesUsed: number;
  refundCents: number | null;
  customer: { name: string; email: string | null; phone: string | null };
  memberNo: string | null;
  payment: { method: string; amountCents: number } | null;
  holdExpiresAt: string | null;
  cancelledAt: string | null;
}

interface CancelQuote {
  allowed: boolean;
  rule?: string;
  reason?: string;
  refundCents?: number;
  paidCents?: number;
  returnMinutes?: number;
  hoursBefore: number;
}

const STATUS_TONE: Record<string, "green" | "red" | "amber" | "grey" | "blue"> = {
  confirmed: "green",
  arrived: "blue",
  completed: "grey",
  held: "amber",
  cancelled: "red",
  expired: "grey",
  no_show: "red",
};

/** Today in venue time, so the page opens on the day the staff are working. */
function useVenueToday(): string {
  const { config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function BookingsPage() {
  const today = useVenueToday();
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<BookingRow | null>(null);
  const path = `/admin/bookings?date=${date}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const bookings = useApiData<{ bookings: BookingRow[] }>(path);

  const shiftDay = (days: number) => {
    const [y, m, d] = date.split("-").map(Number);
    setDate(new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10));
  };

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Online bookings for a day. Cancel with a refund when the venue has to."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" onClick={() => shiftDay(-1)} aria-label="Previous day">
              ←
            </Button>
            <Input type="date" aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button size="sm" onClick={() => shiftDay(1)} aria-label="Next day">
              →
            </Button>
            <Button size="sm" onClick={() => setDate(today)}>
              Today
            </Button>
          </div>
        }
      />

      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input
            placeholder="Search code, name, email or phone"
            aria-label="Search bookings"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setQuery(search.trim())}
            className="max-w-xs"
          />
          <Button onClick={() => setQuery(search.trim())}>Search</Button>
          {query ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setQuery("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
        <ErrorNote error={bookings.error} />
        <Table head={["Time", "What", "Customer", "Status", "Paid", ""]} empty={bookings.data?.bookings.length === 0}>
          {(bookings.data?.bookings ?? []).map((b) => (
            <tr key={b.id} className="cursor-pointer hover:bg-ink-850" onClick={() => setOpen(b)}>
              <Td className="tnum whitespace-nowrap">
                {b.venueStartTime}–{b.venueEndTime}
              </Td>
              <Td>
                <span className="block">{b.resourceType}</span>
                <span className="text-xs text-ink-400">{b.resource}</span>
              </Td>
              <Td>
                <span className="block">{b.customer.name}</span>
                <span className="text-xs text-ink-400">
                  {b.ref}
                  {b.memberNo ? ` · ${b.memberNo}` : ""}
                </span>
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[b.status] ?? "grey"}>{b.status.replace("_", " ")}</Badge>
              </Td>
              <Td className="tnum">
                {formatCents(b.totalCents ?? 0)}
                {b.refundCents ? <span className="block text-xs text-red-300">−{formatCents(b.refundCents)} refunded</span> : null}
              </Td>
              <Td>
                <span className="text-ink-400">View</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {open ? (
        <BookingDialog
          booking={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            bookings.reload();
          }}
        />
      ) : null}
    </>
  );
}

function BookingDialog({ booking, onClose, onChanged }: { booking: BookingRow; onClose: () => void; onChanged: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [venueFault, setVenueFault] = useState(false);
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState(centsToInput(0));
  const [returnMinutes, setReturnMinutes] = useState(false);
  const [reason, setReason] = useState("");
  const quote = useApiData<{ quote: CancelQuote }>(`/admin/bookings/${booking.id}/cancel-quote?venueFault=${venueFault}`);
  const policy = quote.data?.quote;
  const overrideCents = parseDollars(amount);
  const paidCents = policy?.paidCents ?? booking.payment?.amountCents ?? booking.totalCents ?? 0;
  const cancellable = booking.status === "confirmed" || booking.status === "arrived";
  const refundCents = (override ? overrideCents : policy?.refundCents) ?? 0;

  return (
    <Modal title={`Booking ${booking.ref}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="space-y-1">
          <Row label="What" value={`${booking.resourceType} · ${booking.resource}`} />
          <Row label="When" value={`${booking.venueDate}, ${booking.venueStartTime}–${booking.venueEndTime}`} />
          <Row label="Customer" value={booking.customer.name} />
          {booking.customer.email ? <Row label="Email" value={booking.customer.email} /> : null}
          {booking.customer.phone ? <Row label="Phone" value={booking.customer.phone} /> : null}
          {booking.memberNo ? <Row label="Member" value={booking.memberNo} /> : null}
          <Row label="Status" value={booking.status.replace("_", " ")} />
          {booking.freeMinutesUsed > 0 ? <Row label="Free play used" value={`${booking.freeMinutesUsed} min`} /> : null}
          <Row label="Paid" value={`${formatCents(paidCents)}${booking.payment ? ` (${booking.payment.method})` : ""}`} strong />
          {booking.refundCents ? <Row label="Refunded" value={formatCents(booking.refundCents)} /> : null}
        </div>

        {!cancellable ? (
          <p className="rounded-lg bg-ink-850 px-3 py-2 text-sm text-ink-400">
            {booking.status === "cancelled" ? "This booking is already cancelled." : "Only confirmed bookings can be cancelled here."}
          </p>
        ) : (
          <div className="space-y-3 border-t border-ink-800 pt-4">
            <h3 className="font-semibold">Cancel this booking</h3>
            <ErrorNote error={quote.error} />
            <p className="text-sm text-ink-400" data-testid="policy-refund">
              {policy?.allowed
                ? `The policy refund right now is ${formatCents(policy.refundCents ?? 0)} of ${formatCents(paidCents)} (${policy.rule}, ${Math.floor(policy.hoursBefore)} h before the start).`
                : `Less than 2 hours before the start: no refund applies unless it's the venue's fault or you set an amount.`}
            </p>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={venueFault}
                onChange={(e) => {
                  setVenueFault(e.target.checked);
                  if (e.target.checked) setOverride(false);
                }}
              />
              Our fault (full refund and free minutes back, whenever it is)
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => {
                  setOverride(e.target.checked);
                  if (e.target.checked) setVenueFault(false);
                }}
              />
              Set the refund myself
            </label>

            {override ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Refund amount" hint={`At most ${formatCents(paidCents)}`}>
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <label className="flex items-center gap-2 self-end pb-3 text-sm">
                  <input type="checkbox" checked={returnMinutes} onChange={(e) => setReturnMinutes(e.target.checked)} />
                  Give the free minutes back
                </label>
              </div>
            ) : null}

            <Field label="Reason" hint="Saved in the audit log and emailed to the customer.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Table out of order" />
            </Field>

            <ErrorNote error={action.error} />
            <Button
              variant="danger"
              className="w-full"
              disabled={action.busy || reason.trim().length < 3 || (override && (overrideCents === null || overrideCents > paidCents))}
              onClick={() =>
                void action.run(async () => {
                  await api(`/admin/bookings/${booking.id}/cancel`, {
                    body: {
                      reason: reason.trim(),
                      venueFault,
                      ...(override ? { overrideRefundCents: overrideCents, returnMinutes } : { expectedRefundCents: policy?.refundCents ?? 0 }),
                    },
                  });
                  onChanged();
                })
              }
            >
              {action.busy ? "Cancelling…" : `Cancel booking and refund ${formatCents(refundCents)}`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
