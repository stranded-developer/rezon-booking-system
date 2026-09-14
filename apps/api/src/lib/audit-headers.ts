/**
 * Headers read by the database audit trigger (migration …1000_admin): who made a config change and why.
 * Every admin write to an audited table must carry these.
 */
export function auditHeaders<Q extends { setHeader(name: string, value: string): Q }>(
  query: Q,
  actorStaffId: string,
  reason?: string | null,
): Q {
  let q = query.setHeader("x-rg-actor", actorStaffId);
  if (reason && reason.trim()) q = q.setHeader("x-rg-reason-b64", Buffer.from(reason.trim(), "utf8").toString("base64"));
  return q;
}
