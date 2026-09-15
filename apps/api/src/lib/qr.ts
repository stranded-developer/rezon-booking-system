import { createHmac } from "node:crypto";
import type { Db } from "@raceground/db";
import { ApiError, mapDbError } from "../errors.js";
import { hashQrToken } from "../services/lookup.js";

/**
 * Member QR tokens are derived, not stored: HMAC(secret, member id + version). The database keeps only the
 * sha256 of the token and bumps members.qr_version whenever that hash changes, so the account page can show
 * the current QR again and a reissue makes every older QR stop working.
 */
export function memberQrToken(secret: string, memberId: string, version: number): string {
  return createHmac("sha256", secret).update(`raceground-member-qr:${memberId}:${version}`).digest("base64url");
}

/** The token for the next card of this member (the version the database will move to when the hash is saved). */
export async function nextMemberCard(db: Db, secret: string, memberId: string) {
  const { data, error } = await db.from("members").select("qr_version").eq("id", memberId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Member not found");
  const token = memberQrToken(secret, memberId, data.qr_version + 1);
  return { token, qr: `rg:m:${token}`, hash: hashQrToken(token) };
}

/** The member's current QR, or null if they have no card or it was issued before derived tokens. */
export function currentMemberQr(secret: string, member: { id: string; qr_version: number; qr_token_hash: string | null }): string | null {
  if (!member.qr_token_hash) return null;
  const token = memberQrToken(secret, member.id, member.qr_version);
  return hashQrToken(token) === member.qr_token_hash ? `rg:m:${token}` : null;
}
