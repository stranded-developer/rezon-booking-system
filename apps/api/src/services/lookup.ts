import { createHash } from "node:crypto";
import type { Db } from "@raceground/db";
import { ApiError, mapDbError } from "../errors.js";

export interface MemberSummary {
  id: string;
  memberNo: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  tierName: string;
  discountBp: number;
  balanceMinutes: number;
  /** Discount and balance may be used (active, or cancelling until period end). */
  eligible: boolean;
}

const MEMBER_SELECT =
  "id, member_no, status, customers!inner(name, email, phone), membership_tiers!members_tier_id_fkey(name, discount_bp)" as const;

type MemberRow = {
  id: string;
  member_no: string;
  status: string;
  customers: { name: string; email: string | null; phone: string | null };
  membership_tiers: { name: string; discount_bp: number };
};

async function withBalances(db: Db, rows: MemberRow[]): Promise<MemberSummary[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("member_balances")
    .select("member_id, balance_minutes")
    .in(
      "member_id",
      rows.map((r) => r.id),
    );
  if (error) throw mapDbError(error);
  const balance = new Map(data.map((b) => [b.member_id, b.balance_minutes ?? 0]));
  return rows.map((r) => ({
    id: r.id,
    memberNo: r.member_no,
    name: r.customers.name,
    email: r.customers.email,
    phone: r.customers.phone,
    status: r.status,
    tierName: r.membership_tiers.name,
    discountBp: r.membership_tiers.discount_bp,
    balanceMinutes: balance.get(r.id) ?? 0,
    eligible: r.status === "active" || r.status === "cancelling",
  }));
}

export async function getMember(db: Db, memberId: string): Promise<MemberSummary> {
  const { data, error } = await db.from("members").select(MEMBER_SELECT).eq("id", memberId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Member not found");
  return (await withBalances(db, [data as unknown as MemberRow]))[0]!;
}

export const hashQrToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Member QR payload: rg:m:<token>. */
export async function findMemberByQr(db: Db, code: string): Promise<MemberSummary> {
  const m = /^rg:m:([A-Za-z0-9_-]{20,128})$/.exec(code.trim());
  if (!m) throw new ApiError(422, "invalid_qr", "That is not a Raceground member code");
  const { data, error } = await db.from("members").select(MEMBER_SELECT).eq("qr_token_hash", hashQrToken(m[1]!)).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Member card not recognised");
  return (await withBalances(db, [data as unknown as MemberRow]))[0]!;
}

export async function searchMembers(db: Db, query: string): Promise<MemberSummary[]> {
  const q = query.replace(/[,()%*\\]/g, " ").trim();
  if (q.length < 3) throw new ApiError(422, "validation_failed", "Type at least 3 characters");
  const { data, error } = await db
    .from("members")
    .select(MEMBER_SELECT)
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`, { referencedTable: "customers" })
    .order("member_no")
    .limit(10);
  if (error) throw mapDbError(error);
  return withBalances(db, data as unknown as MemberRow[]);
}

export interface ReferralSummary {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  usesCount: number;
  maxUses: number;
  validUntil: string | null;
  usable: boolean;
  reason: "inactive" | "expired" | "used_up" | null;
}

/** Accepts a typed code (any case) or a scanned rg:r:<code>. */
export async function getReferral(db: Db, input: string, now: Date): Promise<ReferralSummary> {
  const code = input.trim().replace(/^rg:r:/i, "").toUpperCase();
  if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(code)) throw new ApiError(404, "not_found", "Referral code not found");
  const { data, error } = await db.from("referral_codes").select("*").eq("code", code).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Referral code not found");
  const reason = !data.active
    ? "inactive"
    : data.valid_until && new Date(data.valid_until) <= now
      ? "expired"
      : data.uses_count >= data.max_uses
        ? "used_up"
        : null;
  return {
    id: data.id,
    code: data.code,
    type: data.discount_type as "percent" | "fixed",
    value: data.discount_value,
    usesCount: data.uses_count,
    maxUses: data.max_uses,
    validUntil: data.valid_until,
    usable: reason === null,
    reason,
  };
}
