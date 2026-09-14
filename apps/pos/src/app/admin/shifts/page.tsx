"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { ReportView } from "@/components/shift-dialog";
import { Button, ErrorNote, Modal } from "@/components/ui";
import { money } from "@/lib/format";
import type { ShiftReport } from "@/lib/types";

interface ShiftRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float_cents: number;
  cash_variance_cents: number | null;
  card_variance_cents: number | null;
  flagged: boolean;
  opener: string | null;
  closer: string | null;
}

export default function ShiftsPage() {
  const { config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const { data, error } = useApiData<{ shifts: ShiftRow[] }>(`/admin/shifts?limit=60${flaggedOnly ? "&flagged=true" : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const variance = (c: number | null) => (c === null ? "—" : <span className={c === 0 ? "text-emerald-300" : "text-red-300"}>{c > 0 ? `+${money(c)}` : money(c)}</span>);

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Till reconciliations. Shifts with a cash or card difference above the threshold are flagged."
        actions={
          <Button variant={flaggedOnly ? "primary" : "secondary"} onClick={() => setFlaggedOnly((v) => !v)}>
            {flaggedOnly ? "Showing flagged" : "Show flagged only"}
          </Button>
        }
      />
      <ErrorNote error={error} />
      <Card>
        <Table head={["Opened", "Closed", "Opened by", "Closed by", "Cash variance", "Card variance", ""]} empty={data !== null && data.shifts.length === 0}>
          {(data?.shifts ?? []).map((s) => (
            <tr key={s.id} className="cursor-pointer hover:bg-ink-850" onClick={() => setOpen(s.id)}>
              <Td>{when(s.opened_at)}</Td>
              <Td>{s.closed_at ? when(s.closed_at) : <Badge tone="green">Open</Badge>}</Td>
              <Td>{s.opener}</Td>
              <Td>{s.closer ?? "—"}</Td>
              <Td className="tnum">{variance(s.cash_variance_cents)}</Td>
              <Td className="tnum">{variance(s.card_variance_cents)}</Td>
              <Td>{s.flagged ? <Badge tone="red">Flagged</Badge> : null}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      {open ? <ShiftReportDialog shiftId={open} tz={tz} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ShiftReportDialog({ shiftId, tz, onClose }: { shiftId: string; tz: string; onClose: () => void }) {
  const { data, error } = useApiData<{ report: ShiftReport }>(`/pos/shifts/${shiftId}/report`);
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "numeric", month: "short" }).format(new Date(iso));
  return (
    <Modal title="Shift report" onClose={onClose} wide>
      <ErrorNote error={error} />
      {data ? <ReportView report={data.report} time={time} /> : <p className="text-ink-400">Loading…</p>}
    </Modal>
  );
}
