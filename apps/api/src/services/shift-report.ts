import type { PriceResult } from "@raceground/pricing";
import type { Db } from "@raceground/db";
import { ApiError, mapDbError } from "../errors.js";

export async function shiftReport(db: Db, shiftId: string) {
  const { data: shift, error } = await db
    .from("shifts")
    .select("*, opener:staff!shifts_staff_id_fkey(display_name), closer:staff!shifts_closed_by_fkey(display_name)")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!shift) throw new ApiError(404, "not_found", "Shift not found");

  const [totalsRes, movementsRes, paymentsRes, refundsRes, sessionsRes] = await Promise.all([
    db.rpc("pos_shift_totals", { p_shift: shiftId }).single(),
    db.from("cash_movements").select("kind, amount_cents").eq("shift_id", shiftId),
    db.from("payments").select("method, amount_cents, staff_id, staff:staff!payments_staff_id_fkey(display_name)").eq("shift_id", shiftId),
    db.from("refunds").select("amount_cents, payments!inner(method)").eq("shift_id", shiftId),
    db
      .from("sessions")
      .select("id, status, total_cents, free_minutes_used, pricing_snapshot, price_overrides(original_cents, new_cents)")
      .in("status", ["closed", "voided"])
      .eq("closed_in_shift_id", shiftId),
  ]);
  for (const r of [totalsRes, movementsRes, paymentsRes, refundsRes, sessionsRes]) if (r.error) throw mapDbError(r.error);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const movements = movementsRes.data ?? [];
  const byKind = (k: string) => sum(movements.filter((m) => m.kind === k).map((m) => m.amount_cents));
  const payments = paymentsRes.data ?? [];
  const refunds = refundsRes.data ?? [];

  const closedSessions = (sessionsRes.data ?? []).filter((s) => s.status === "closed");
  let happyHourCents = 0;
  let memberCents = 0;
  let referralCents = 0;
  let overrideCents = 0;
  for (const s of closedSessions) {
    const pricing = (s.pricing_snapshot as { pricing?: PriceResult | null } | null)?.pricing;
    if (pricing) {
      for (const seg of pricing.segments) {
        if (!seg.free && seg.happyHourBp > 0) happyHourCents += Math.round((seg.minutes * seg.rateCents) / 60) - seg.amountCents;
      }
      const d = pricing.discount;
      if (d?.kind === "member") memberCents += d.amountCents;
      if (d?.kind === "referral_percent" || d?.kind === "referral_fixed") referralCents += d.amountCents;
    }
    for (const o of (s.price_overrides as { original_cents: number; new_cents: number }[]) ?? []) {
      overrideCents += o.original_cents - o.new_cents;
    }
  }

  const staff = new Map<string, { staffId: string; name: string; payments: number; grossCents: number }>();
  for (const p of payments) {
    const key = p.staff_id ?? "unknown";
    const row = staff.get(key) ?? { staffId: key, name: (p.staff as { display_name: string } | null)?.display_name ?? "—", payments: 0, grossCents: 0 };
    row.payments += 1;
    row.grossCents += p.amount_cents;
    staff.set(key, row);
  }

  return {
    shift: {
      id: shift.id,
      openedAt: shift.opened_at,
      closedAt: shift.closed_at,
      openedBy: (shift.opener as { display_name: string } | null)?.display_name ?? null,
      closedBy: (shift.closer as { display_name: string } | null)?.display_name ?? null,
      flagged: shift.flagged,
    },
    sessionsClosed: closedSessions.length,
    sessionsVoided: (sessionsRes.data ?? []).length - closedSessions.length,
    grossCents: sum(payments.map((p) => p.amount_cents)),
    refundsCents: sum(refunds.map((r) => r.amount_cents)),
    tender: {
      cashCents: sum(payments.filter((p) => p.method === "cash").map((p) => p.amount_cents)),
      cardCents: sum(payments.filter((p) => p.method === "card_terminal").map((p) => p.amount_cents)),
    },
    cash: {
      openingFloatCents: shift.opening_float_cents,
      salesCents: byKind("sale"),
      refundsCents: -byKind("refund"),
      paidInCents: byKind("paid_in"),
      paidOutCents: -byKind("paid_out"),
      expectedCents: shift.expected_cash_cents ?? totalsRes.data!.expected_cash_cents,
      countedCents: shift.counted_cash_cents,
      varianceCents: shift.cash_variance_cents,
    },
    card: {
      posTotalCents: shift.pos_card_total_cents ?? totalsRes.data!.pos_card_total_cents,
      terminalTotalCents: shift.terminal_card_total_cents,
      varianceCents: shift.card_variance_cents,
    },
    discounts: { happyHourCents, memberCents, referralCents, overrideCents },
    freeMinutesUsed: sum(closedSessions.map((s) => s.free_minutes_used)),
    byStaff: [...staff.values()],
  };
}
