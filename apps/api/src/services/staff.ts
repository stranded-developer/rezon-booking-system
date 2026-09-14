import type { Db, Tables } from "@raceground/db";
import type { StaffRole } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { writeAudit } from "../lib/audit.js";
import { hashPin } from "../lib/pin.js";

export type PublicStaff = Pick<Tables<"staff">, "id" | "display_name" | "role" | "active" | "created_at" | "updated_at"> & {
  email: string | null;
};

const PUBLIC_COLUMNS = "id, auth_user_id, display_name, role, active, created_at, updated_at" as const;

/** Staff row without secrets, safe for API responses and audit before/after. */
function publicStaff(row: Omit<Tables<"staff">, "pin_hash" | "pin_failed_count" | "pin_locked_until">, email: string | null): PublicStaff {
  return {
    id: row.id,
    display_name: row.display_name,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    email,
  };
}

export interface CreateStaffInput {
  email: string;
  password: string;
  displayName: string;
  role: StaffRole;
  pin: string;
}

export interface AuditContext {
  actorStaffId: string | null;
  ip?: string | null;
  reason?: string | null;
}

export async function createStaff(db: Db, input: CreateStaffInput, audit: AuditContext): Promise<PublicStaff> {
  const pinHash = await hashPin(input.pin);

  const { data: created, error: authError } = await db.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (authError || !created.user) {
    if (authError?.code === "email_exists" || authError?.status === 422) {
      throw new ApiError(409, "conflict", "A user with that email already exists");
    }
    throw new ApiError(500, "internal", "Could not create the sign-in account");
  }

  const { data: row, error } = await db
    .from("staff")
    .insert({
      auth_user_id: created.user.id,
      display_name: input.displayName,
      role: input.role,
      pin_hash: pinHash,
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error || !row) {
    // Compensate so a failed staff insert never leaves an orphan login behind.
    await db.auth.admin.deleteUser(created.user.id);
    throw error ? mapDbError(error) : new ApiError(500, "internal", "Could not create staff");
  }

  const result = publicStaff(row, input.email);
  await writeAudit(db, {
    actorStaffId: audit.actorStaffId,
    action: "staff.create",
    entity: "staff",
    entityId: row.id,
    after: result,
    reason: audit.reason ?? null,
    ip: audit.ip ?? null,
  });
  return result;
}

export interface UpdateStaffInput {
  displayName?: string | undefined;
  role?: StaffRole | undefined;
  active?: boolean | undefined;
  pin?: string | undefined;
}

export async function updateStaff(db: Db, staffId: string, input: UpdateStaffInput, audit: AuditContext): Promise<PublicStaff> {
  const { data: before, error: readError } = await db.from("staff").select(PUBLIC_COLUMNS).eq("id", staffId).maybeSingle();
  if (readError) throw mapDbError(readError);
  if (!before) throw new ApiError(404, "not_found", "Staff member not found");

  const patch: { display_name?: string; role?: string; active?: boolean; pin_hash?: string; pin_failed_count?: number; pin_locked_until?: null } = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.role !== undefined) patch.role = input.role;
  if (input.active !== undefined) patch.active = input.active;
  if (input.pin !== undefined) {
    patch.pin_hash = await hashPin(input.pin);
    patch.pin_failed_count = 0;
    patch.pin_locked_until = null;
  }
  if (Object.keys(patch).length === 0) throw new ApiError(422, "validation_failed", "Nothing to update");

  const { data: after, error } = await db.from("staff").update(patch).eq("id", staffId).select(PUBLIC_COLUMNS).single();
  if (error || !after) throw error ? mapDbError(error) : new ApiError(500, "internal", "Could not update staff");

  const email = await authEmail(db, after.auth_user_id);
  const result = publicStaff(after, email);
  await writeAudit(db, {
    actorStaffId: audit.actorStaffId,
    action: input.pin !== undefined ? "staff.update_with_pin_reset" : "staff.update",
    entity: "staff",
    entityId: staffId,
    before: publicStaff(before, email),
    after: result,
    reason: audit.reason ?? null,
    ip: audit.ip ?? null,
  });
  return result;
}

export async function listStaff(db: Db): Promise<PublicStaff[]> {
  const { data, error } = await db.from("staff").select(PUBLIC_COLUMNS).order("display_name");
  if (error) throw mapDbError(error);
  const emails = await authEmails(db);
  return data.map((row) => publicStaff(row, emails.get(row.auth_user_id) ?? null));
}

/**
 * All sign-in emails in a few paged calls. Looking each staff member up separately made the Staff
 * page take ~4.4 s for 117 accounts (vs ~0.26 s), long enough to time out on a cold start.
 */
async function authEmails(db: Db): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new ApiError(500, "internal", "Could not load staff emails");
    for (const u of data.users) if (u.email) emails.set(u.id, u.email);
    if (data.users.length < 1000) return emails;
  }
}

async function authEmail(db: Db, authUserId: string): Promise<string | null> {
  const { data } = await db.auth.admin.getUserById(authUserId);
  return data.user?.email ?? null;
}
