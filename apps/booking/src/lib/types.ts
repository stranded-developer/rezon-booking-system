/** Shapes returned by the public API (apps/api/src/services/bookings.ts). */

export interface PublicConfig {
  businessName: string;
  venue: { address: string | null; phone: string | null; email: string | null; intro: string | null; instagramUrl: string | null };
  photos: { url: string; caption: string | null }[];
  timeZone: string;
  today: string;
  /** A session: the smallest block that can be booked (D63). */
  sessionMinutes: number;
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
    /** Listed on the membership page but not enforced by the system (D67). */
    perks: string[];
    sellable: boolean;
  }[];
  /** Named packages sold at a flat price (D65). */
  experiences: Experience[];
  /** What's on: the pop-up and the banner (D69). */
  events: SiteEvent[];
  /** Games a customer can ask for, with their tracks and cars (D80). Optional: an older API has none. */
  games?: Game[];
}

export interface Game {
  id: string;
  name: string;
  resourceTypeId: string;
  tracks: { id: string; name: string }[];
  cars: { id: string; name: string }[];
}

export interface Experience {
  id: string;
  key: string;
  name: string;
  resourceTypeId: string;
  tagline: string | null;
  bullets: string[];
  badges: string[];
  minutes: number;
  priceCents: number;
  /** The cheapest price anyone could pay without asking for it. */
  fromPriceCents: number;
  promos: ExperiencePromo[];
}

export interface ExperiencePromo {
  id: string;
  name: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  priceCents: number;
  /** Only applies when the customer asks for it, e.g. a student price. */
  claimed: boolean;
}

export interface SiteEvent {
  id: string;
  title: string;
  body: string | null;
  detail: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  asPopup: boolean;
  asBanner: boolean;
}

export interface Tournament {
  id: string;
  name: string;
  blurb: string | null;
  startsAt: string;
  venueDate: string;
  venueTime: string;
  spots: number;
  spotsLeft: number;
  entryFeeCents: number;
  full: boolean;
}

export interface TournamentEntry {
  ref: string;
  status: "held" | "confirmed" | "cancelled" | "expired";
  freeEntry: boolean;
  totalCents: number | null;
  gstCents: number | null;
  explanation: string[];
  holdExpiresAt: string | null;
  customerName: string;
  checkInCode: string;
  tournament: { name: string; blurb: string | null; venueDate: string; venueTime: string; timeZone: string };
}

export type TournamentSignUpResult =
  | { status: "confirmed"; entryId: string; ref: string; token: string; freeEntry: boolean }
  | { status: "pending_payment"; entryId: string; ref: string; token: string; checkoutUrl: string; holdExpiresAt: string };

export interface ResourceType {
  id: string;
  key: string;
  name: string;
  baseRateCents: number;
  /** The cheapest hourly rate anyone could pay, e.g. during happy hour (D74). */
  fromRateCents: number;
  minMinutes: number;
  resources: { id: string; label: string }[];
}

export interface Availability {
  date: string;
  timeZone: string;
  today: string;
  lastDate: string;
  sessionMinutes: number;
  /** The length every start time is checked against: the experience's, or one session. */
  requiredMinutes: number;
  experience: { id: string; key: string; name: string; minutes: number } | null;
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
  experience: { id: string; key: string; name: string; minutes: number; listPriceCents: number } | null;
  /** Promotional prices the customer could still ask for at this start time (D66). */
  claimablePromos: { id: string; name: string; priceCents: number }[];
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
  /** What was bought: the experience's name if there was one, otherwise the kind of resource. */
  what: string;
  experience: { name: string; key: string } | null;
  resourceType: string;
  resource: string;
  /** What they asked to drive (D80). */
  simSetup: { game: string; track?: string; car?: string } | null;
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
  what: string;
  experience: { name: string; key: string } | null;
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
