/** Shapes returned by the public API (apps/api/src/services/bookings.ts). */

export interface PublicConfig {
  businessName: string;
  venue: { address: string | null; phone: string | null; email: string | null; intro: string | null; instagramUrl: string | null };
  photos: { url: string; caption: string | null }[];
  timeZone: string;
  today: string;
  bookingWindowDays: number;
  onlineCutoffMinutes: number;
  holdMinutes: number;
  noShowHoldMinutes: number;
  refundPolicy: { fullRefundHoursBefore: number; halfRefundHoursBefore: number };
  resourceTypes: ResourceType[];
  openingHours: { dayOfWeek: number; open: string; close: string; closed: boolean }[];
  happyHours: { name: string; resourceTypeIds: string[] | null; daysOfWeek: number[]; startTime: string; endTime: string; discountBp: number }[];
  rateBands: { resourceTypeId: string; daysOfWeek: number[]; startTime: string; endTime: string; rateCents: number }[];
  tiers: {
    id: string;
    name: string;
    discountBp: number;
    monthlyPriceCents: number;
    monthlyFreeMinutes: number;
    maxBalanceMinutes: number;
    sellable: boolean;
  }[];
}

export interface ResourceType {
  id: string;
  key: string;
  name: string;
  baseRateCents: number;
  minMinutes: number;
  resources: { id: string; label: string }[];
}

export interface Availability {
  date: string;
  timeZone: string;
  today: string;
  lastDate: string;
  resourceType: { id: string; key: string; name: string; minMinutes: number; baseRateCents: number };
  resources: { id: string; label: string }[];
  open: string | null;
  close: string | null;
  closed: boolean;
  inWindow: boolean;
  slots: Slot[];
}

export interface Slot {
  time: string;
  startsAt: string;
  availableResources: number;
  maxMinutes: number;
  resourceMaxMinutes: Record<string, number>;
}

export interface Quote {
  resourceTypeId: string;
  resourceTypeName: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  gstCents: number;
  explanation: string[];
  referral: { id: string; code: string; type: "percent" | "fixed"; value: number } | null;
  member: { id: string; memberNo: string; tierName: string; discountBp: number; balanceMinutes: number } | null;
  maxFreeMinutes: number;
  pricing: { freeMinutes: number; billedMinutes: number };
}

export interface QuoteResponse {
  quote: Quote;
  memberNotice: { status: string; message: string } | null;
}

export type HoldResult =
  | { status: "confirmed"; bookingId: string; ref: string; token: string }
  | { status: "pending_payment"; bookingId: string; ref: string; token: string; checkoutUrl: string; holdExpiresAt: string };

export interface Booking {
  ref: string;
  status: "held" | "confirmed" | "arrived" | "completed" | "cancelled" | "expired" | "no_show";
  resourceType: string;
  resource: string;
  startsAt: string;
  endsAt: string;
  venueDate: string;
  venueStartTime: string;
  venueEndTime: string;
  timeZone: string;
  durationMinutes: number;
  customerName: string;
  totalCents: number | null;
  gstCents: number | null;
  freeMinutesUsed: number;
  explanation: string[];
  holdExpiresAt: string | null;
  cancelledAt: string | null;
  refundCents: number | null;
  checkInCode: string;
  cancellation: {
    allowed: boolean;
    rule: string | null;
    reason: string | null;
    refundCents: number;
    paidCents: number;
    returnMinutes: number;
  } | null;
}

export interface ReferralCheck {
  valid: boolean;
  code?: string;
  type?: "percent" | "fixed";
  value?: number;
  reason?: string;
}

/** GET /me — the signed-in customer and their membership, if any. */
export interface Account {
  customer: { name: string; email: string | null; phone: string | null };
  member: {
    memberNo: string;
    status: "pending" | "active" | "past_due" | "cancelling" | "ended";
    eligible: boolean;
    tier: { id: string; name: string; discountBp: number; monthlyPriceCents: number; monthlyFreeMinutes: number; maxBalanceMinutes: number };
    pendingTier: { id: string; name: string; monthlyPriceCents: number } | null;
    currentPeriodEnd: string | null;
    endedAt: string | null;
    billedOnline: boolean;
    balanceMinutes: number;
    qr: string | null;
  } | null;
  canManageBilling: boolean;
}

export interface LedgerEntry {
  minutes: number;
  kind: string;
  reason: string | null;
  at: string;
  bookingRef: string | null;
}

export interface BookingSummary {
  id: string;
  ref: string;
  status: Booking["status"];
  resourceType: string;
  resource: string;
  startsAt: string;
  venueDate: string;
  venueStartTime: string;
  venueEndTime: string;
  endsAt: string;
  totalCents: number | null;
  freeMinutesUsed: number;
  refundCents: number | null;
}
