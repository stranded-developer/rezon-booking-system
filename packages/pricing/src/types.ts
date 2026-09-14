/** Money is integer cents, percentages are basis points (1000 = 10%), instants are UTC epoch ms. */

export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Local wall-clock time "HH:MM" (00:00–23:59), or "24:00" as an end time. */
export type WallTime = string;

export interface ResourceTypePricing {
  id: string;
  /** Hourly rate in cents, GST-inclusive. */
  baseRateCents: number;
  /** Minimum billable minutes per session. */
  minMinutes: number;
}

export interface RateBand {
  id: string;
  resourceTypeId: string;
  daysOfWeek: IsoDayOfWeek[];
  startTime: WallTime;
  endTime: WallTime;
  rateCents: number;
}

export interface HappyHour {
  id: string;
  name: string;
  /** null applies to every resource type. */
  resourceTypeIds: string[] | null;
  daysOfWeek: IsoDayOfWeek[];
  startTime: WallTime;
  endTime: WallTime;
  discountBp: number;
}

export interface MemberDiscount {
  tierName: string;
  discountBp: number;
}

export type ReferralDiscount =
  | { code: string; type: "percent"; value: number }
  | { code: string; type: "fixed"; value: number };

export interface PriceSessionInput {
  startAt: number;
  endAt: number;
  timeZone: string;
  resourceType: ResourceTypePricing;
  rateBands: RateBand[];
  happyHours: HappyHour[];
  member?: MemberDiscount;
  referral?: ReferralDiscount;
  /** Requested free-play minutes from the member balance. */
  freeMinutes?: number;
  /** Apply resourceType.minMinutes. Default true; false for overstay extensions. */
  applyMinimum?: boolean;
}

export interface PriceSegment {
  startAt: number;
  endAt: number;
  /** "YYYY-MM-DD HH:MM" in the venue timezone. */
  localStart: string;
  localEnd: string;
  minutes: number;
  free: boolean;
  rateCents: number;
  rateBandId: string | null;
  happyHourBp: number;
  happyHourId: string | null;
  happyHourName: string | null;
  /** Display amount; segment amounts always sum exactly to subtotalCents. */
  amountCents: number;
}

export type AppliedDiscount =
  | { kind: "member"; label: string; valueBp: number; amountCents: number }
  | { kind: "referral_percent"; label: string; code: string; valueBp: number; amountCents: number }
  | { kind: "referral_fixed"; label: string; code: string; valueCents: number; amountCents: number };

export interface PriceResult {
  actualMinutes: number;
  billedMinutes: number;
  minimumApplied: boolean;
  freeMinutes: number;
  paidMinutes: number;
  segments: PriceSegment[];
  subtotalCents: number;
  discount: AppliedDiscount | null;
  totalCents: number;
  gstCents: number;
  explanation: string[];
}
