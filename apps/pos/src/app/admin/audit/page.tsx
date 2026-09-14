"use client";

import { Fragment, useState } from "react";
import { Card, PageHeader, Table, Td, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote } from "@/components/ui";

interface Entry {
  id: number;
  action: string;
  entity: string;
  entity_id: string | null;
  actor: string | null;
  approver: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

const ENTITIES = ["", "sessions", "payments", "shifts", "members", "referral_codes", "resource_types", "rate_bands", "happy_hours", "membership_tiers", "opening_hours", "venue_settings", "staff"];

/** Fields that changed between before and after (ignoring timestamps). */
function changes(e: Entry): string {
  if (!e.before || !e.after) return "";
  return Object.keys(e.after)
    .filter((k) => !["updated_at", "created_at"].includes(k) && JSON.stringify(e.before![k]) !== JSON.stringify(e.after![k]))
    .map((k) => `${k}: ${JSON.stringify(e.before![k])} → ${JSON.stringify(e.after![k])}`)
    .join(" · ");
}

export default function AuditPage() {
  const { config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const [entity, setEntity] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const { data, error } = useApiData<{ entries: Entry[]; nextBefore: number | null }>(
    `/admin/audit?limit=50${entity ? `&entity=${entity}` : ""}${before ? `&before=${before}` : ""}`,
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to money, rules and staff, with who did it and why. Entries can't be edited or deleted."
        actions={
          <select
            aria-label="Filter"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setBefore(null);
            }}
            className="h-11 rounded-lg bg-ink-900 px-3 ring-1 ring-ink-700"
          >
            {ENTITIES.map((x) => (
              <option key={x} value={x}>
                {x ? x.replace(/_/g, " ") : "Everything"}
              </option>
            ))}
          </select>
        }
      />
      <ErrorNote error={error} />
      <Card>
        <Table head={["When", "Who", "Action", "Change", "Reason"]} empty={data !== null && data.entries.length === 0}>
          {(data?.entries ?? []).map((e) => (
            <Fragment key={e.id}>
              <tr className="cursor-pointer hover:bg-ink-850" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                <Td className="tnum whitespace-nowrap text-ink-400">{when(e.created_at)}</Td>
                <Td>
                  {e.actor ?? <span className="text-ink-400">System</span>}
                  {e.approver && e.approver !== e.actor ? <span className="text-xs text-ink-400"> · approved by {e.approver}</span> : null}
                </Td>
                <Td className="font-mono text-xs">{e.action}</Td>
                <Td className="max-w-md truncate text-xs text-ink-200">{changes(e)}</Td>
                <Td className="text-ink-200">{e.reason}</Td>
              </tr>
              {expanded === e.id ? (
                <tr>
                  <td colSpan={5} className="bg-ink-950 px-3 py-3">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-ink-200">
                      {JSON.stringify({ entity: e.entity, id: e.entity_id, before: e.before, after: e.after }, null, 2)}
                    </pre>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </Table>
        <div className="mt-4 flex justify-between">
          <Button size="sm" disabled={!before} onClick={() => setBefore(null)}>
            Newest
          </Button>
          <Button size="sm" disabled={!data?.nextBefore} onClick={() => setBefore(data?.nextBefore ?? null)}>
            Older →
          </Button>
        </div>
      </Card>
    </>
  );
}
