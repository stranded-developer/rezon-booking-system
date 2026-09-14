import type { Db } from "@raceground/db";
import type { Env } from "./env.js";

export type StaffRole = "superadmin" | "cashier";

export interface StaffIdentity {
  id: string;
  authUserId: string;
  displayName: string;
  role: StaffRole;
}

export interface AppDeps {
  env: Env;
  db: Db;
}

export interface AppEnv {
  Variables: {
    deps: AppDeps;
    /** Staff account the POS device is signed in as (Supabase JWT). */
    device: StaffIdentity;
    /** Staff member currently operating the POS (PIN-verified). */
    operator: StaffIdentity;
  };
}
