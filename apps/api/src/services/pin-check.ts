import type { Db } from "@raceground/db";
import type { Env } from "../env.js";
import { ApiError, mapDbError } from "../errors.js";
import { writeAudit } from "../lib/audit.js";
import { verifyPin } from "../lib/pin.js";

export interface VerifiedStaff {
  id: string;
  displayName: string;
  role: "superadmin" | "cashier";
}

/**
 * Verify a staff PIN with lockout bookkeeping (register_pin_attempt).
 * Used for operator sign-in and for superadmin approval of overrides.
 */
export async function checkStaffPin(
  db: Db,
  env: Env,
  staffId: string,
  pin: string,
  audit: { actorStaffId: string; ip: string | null },
): Promise<VerifiedStaff> {
  const { data: staff, error } = await db
    .from("staff")
    .select("id, display_name, role, active, pin_hash, pin_locked_until")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  // Unknown and inactive staff get the same answer as a wrong PIN.
  if (!staff || !staff.active) throw new ApiError(401, "pin_invalid", "Incorrect PIN");

  // Fast path: skip hashing while locked. register_pin_attempt enforces the lock regardless.
  if (staff.pin_locked_until && new Date(staff.pin_locked_until) > new Date()) {
    throw new ApiError(423, "pin_locked", "Too many attempts. Try again later.", { lockedUntil: staff.pin_locked_until });
  }

  const correct = await verifyPin(pin, staff.pin_hash);
  const { data: attempt, error: attemptError } = await db
    .rpc("register_pin_attempt", {
      p_staff_id: staffId,
      p_success: correct,
      p_max_attempts: env.PIN_MAX_ATTEMPTS,
      p_lock_minutes: env.PIN_LOCK_MINUTES,
    })
    .single();
  if (attemptError || !attempt) throw attemptError ? mapDbError(attemptError) : new ApiError(500, "internal", "PIN check failed");

  if (attempt.just_locked) {
    await writeAudit(db, {
      actorStaffId: audit.actorStaffId,
      action: "staff.pin_locked",
      entity: "staff",
      entityId: staffId,
      after: { locked_until: attempt.locked_until },
      ip: audit.ip,
    });
  }

  if (!attempt.accepted) {
    if (attempt.locked_until) {
      throw new ApiError(423, "pin_locked", "Too many attempts. Try again later.", { lockedUntil: attempt.locked_until });
    }
    throw new ApiError(401, "pin_invalid", "Incorrect PIN", { attemptsRemaining: env.PIN_MAX_ATTEMPTS - attempt.failed_count });
  }

  return { id: staff.id, displayName: staff.display_name, role: staff.role as VerifiedStaff["role"] };
}
