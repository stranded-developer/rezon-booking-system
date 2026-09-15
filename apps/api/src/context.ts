import type { Db } from "@raceground/db";
import type Stripe from "stripe";
import type { EmailSender } from "./services/email.js";
import type { Env } from "./env.js";

export type StaffRole = "superadmin" | "cashier";

export interface StaffIdentity {
  id: string;
  authUserId: string;
  displayName: string;
  role: StaffRole;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface AppDeps {
  env: Env;
  db: Db;
  clock: Clock;
  /** null when STRIPE_SECRET_KEY isn't configured. */
  stripe: Stripe | null;
  email: EmailSender;
}

/** A signed-in booking-site user, linked to their customer record. */
export interface AccountIdentity {
  authUserId: string;
  email: string;
  customerId: string;
}

export interface AppEnv {
  Variables: {
    deps: AppDeps;
    /** Staff account the POS device is signed in as (Supabase JWT). */
    device: StaffIdentity;
    /** Staff member currently operating the POS (PIN-verified). */
    operator: StaffIdentity;
    /** Booking-site account (Supabase JWT, confirmed email); unset for guests on optional routes. */
    account: AccountIdentity | undefined;
  };
}
