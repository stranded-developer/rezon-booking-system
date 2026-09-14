import { isIP } from "node:net";
import type { Context } from "hono";
import type { Db, Json } from "@raceground/db";
import { mapDbError } from "../errors.js";

export interface AuditEntry {
  actorStaffId: string | null;
  approverStaffId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Json | null;
  after?: Json | null;
  reason?: string | null;
  ip?: string | null;
}

/** First valid IP from proxy headers (Vercel sets x-forwarded-for), else null. */
export function requestIp(c: Context): string | null {
  const candidates = [
    ...(c.req.header("x-forwarded-for")?.split(",") ?? []),
    c.req.header("x-real-ip") ?? "",
  ].map((s) => s.trim());
  return candidates.find((ip) => isIP(ip) !== 0) ?? null;
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    actor_staff_id: entry.actorStaffId,
    approver_staff_id: entry.approverStaffId ?? null,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip: entry.ip ?? null,
  });
  if (error) throw mapDbError(error);
}
