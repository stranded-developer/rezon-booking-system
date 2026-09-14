import type { PriceResult } from "@raceground/pricing";

export type Role = "superadmin" | "cashier";

export interface Operator {
  id: string;
  displayName: string;
  role: Role;
}

export interface StaffTile {
  id: string;
  display_name: string;
  role: Role;
}

export interface PosConfig {
  timeZone: string;
  businessName: string;
  noShowHoldMinutes: number;
  resourceTypes: { id: string; key: string; name: string; base_rate_cents: number; min_minutes: number; sort: number }[];
  openingHours: { day_of_week: number; open_time: string; close_time: string; closed: boolean }[];
  happyHours: {
    id: string;
    name: string;
    resource_type_ids: string[] | null;
    days_of_week: number[];
    start_time: string;
    end_time: string;
    discount_bp: number;
  }[];
  rateBands: { id: string; resource_type_id: string; days_of_week: number[]; start_time: string; end_time: string; rate_cents: number }[];
  tiers: { id: string; name: string; discount_bp: number; monthly_free_minutes: number; monthly_price_cents: number; sellable: boolean }[];
}

export type TileState = "free" | "in_use" | "booking" | "overdue" | "awaiting_arrival";

export interface FloorBooking {
  id: string;
  ref: string;
  status: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  memberId: string | null;
}

export interface FloorTile {
  resourceId: string;
  label: string;
  typeKey: string;
  typeName: string;
  state: TileState;
  session: { id: string; kind: string; openedAt: string; openedBy: string; bookingId: string | null; bookingEndsAt: string | null } | null;
  currentBooking: FloorBooking | null;
  nextBooking: FloorBooking | null;
  minutesToNextBooking: number | null;
  bookingWarning: boolean;
  noShowAvailableAt: string | null;
}

export interface Floor {
  now: string;
  venueDate: string;
  timeZone: string;
  opensAt: string | null;
  closesAt: string | null;
  closingSoon: boolean;
  shift: { id: string; openedAt: string; openedBy: string } | null;
  tiles: FloorTile[];
}

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
  eligible: boolean;
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

export interface Quote {
  sessionId: string;
  resourceLabel: string;
  mode: "walk_in" | "prepaid";
  openedAt: string;
  closedAt: string;
  bookingEndsAt: string | null;
  pricing: PriceResult | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  explanation: string[];
  member: MemberSummary | null;
  referral: ReferralSummary | null;
  maxFreeMinutes: number;
}

export interface Receipt {
  title: "Tax Invoice" | "Receipt";
  receiptNo: number | null;
  businessName: string;
  abn: string | null;
  issuedAt: string;
  resource: string;
  resourceType: string;
  openedAt: string;
  closedAt: string;
  lines: string[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  paymentMethod: string | null;
  tenderedCents: number | null;
  changeCents: number | null;
  servedBy: string | null;
  memberNo: string | null;
  override: { originalCents: number; reason: string } | null;
  voided: boolean;
}

export interface ShiftReport {
  shift: { id: string; openedAt: string; closedAt: string | null; openedBy: string | null; closedBy: string | null; flagged: boolean };
  sessionsClosed: number;
  sessionsVoided: number;
  grossCents: number;
  refundsCents: number;
  tender: { cashCents: number; cardCents: number };
  cash: {
    openingFloatCents: number;
    salesCents: number;
    refundsCents: number;
    paidInCents: number;
    paidOutCents: number;
    expectedCents: number;
    countedCents: number | null;
    varianceCents: number | null;
  };
  card: { posTotalCents: number; terminalTotalCents: number | null; varianceCents: number | null };
  discounts: { happyHourCents: number; memberCents: number; referralCents: number; overrideCents: number };
  freeMinutesUsed: number;
  byStaff: { staffId: string; name: string; payments: number; grossCents: number }[];
}

export interface TodayBooking {
  id: string;
  ref: string;
  status: string;
  startsAt: string;
  endsAt: string;
  resource: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  memberId: string | null;
  totalCents: number | null;
}
