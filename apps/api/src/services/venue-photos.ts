import { randomUUID } from "node:crypto";
import type { Db } from "@raceground/db";
import { ApiError, mapDbError } from "../errors.js";
import { auditHeaders } from "../lib/audit-headers.js";

/** Booking site photos (D58). Files live in the public `venue-photos` bucket; only the API writes them. */
export const PHOTO_BUCKET = "venue-photos";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 12;

const TYPES = [
  { ext: "jpg", contentType: "image/jpeg", matches: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", contentType: "image/png", matches: (b: Uint8Array) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  {
    ext: "webp",
    contentType: "image/webp",
    matches: (b: Uint8Array) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
] as const;

/** The file's real type from its first bytes; the browser's content type and file name aren't trusted. */
export function detectImageType(bytes: Uint8Array) {
  return TYPES.find((t) => t.matches(bytes)) ?? null;
}

export const photoUrl = (db: Db, path: string) => db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

export async function listPhotos(db: Db) {
  const { data, error } = await db.from("venue_photos").select("id, storage_path, caption, sort").order("sort").order("created_at");
  if (error) throw mapDbError(error);
  return data.map((p) => ({ id: p.id, url: photoUrl(db, p.storage_path), caption: p.caption, sort: p.sort }));
}

export async function addPhoto(db: Db, actorStaffId: string, file: File, caption: string | null) {
  if (file.size === 0) throw new ApiError(422, "validation_failed", "The file is empty");
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError(422, "validation_failed", "Photos can be at most 5 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) throw new ApiError(422, "validation_failed", "Upload a JPEG, PNG or WebP photo");

  const { data: existing, error: countError } = await db.from("venue_photos").select("sort");
  if (countError) throw mapDbError(countError);
  if (existing.length >= MAX_PHOTOS) throw new ApiError(409, "too_many_photos", `The website shows at most ${MAX_PHOTOS} photos. Remove one first.`);

  const id = randomUUID();
  const path = `${id}.${type.ext}`;
  const { error: uploadError } = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: type.contentType, upsert: false, cacheControl: "31536000" });
  if (uploadError) {
    console.error("Photo upload failed", uploadError);
    throw new ApiError(502, "storage_failed", "The photo couldn't be saved. Please try again.");
  }
  const sort = Math.max(0, ...existing.map((p) => p.sort)) + 1;
  const { data, error } = await auditHeaders(db.from("venue_photos").insert({ id, storage_path: path, caption, sort }), actorStaffId, "Photo added")
    .select("id, storage_path, caption, sort")
    .single();
  if (error) {
    await db.storage.from(PHOTO_BUCKET).remove([path]);
    throw mapDbError(error);
  }
  return { id: data.id, url: photoUrl(db, data.storage_path), caption: data.caption, sort: data.sort };
}

export async function updatePhotoCaption(db: Db, actorStaffId: string, id: string, caption: string | null) {
  const { data, error } = await auditHeaders(db.from("venue_photos").update({ caption }).eq("id", id), actorStaffId).select("id, storage_path, caption, sort").maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Photo not found");
  return { id: data.id, url: photoUrl(db, data.storage_path), caption: data.caption, sort: data.sort };
}

/** Saves the order shown on the website. Every current photo must be listed exactly once. */
export async function reorderPhotos(db: Db, actorStaffId: string, ids: string[]) {
  const { data, error } = await db.from("venue_photos").select("id, sort");
  if (error) throw mapDbError(error);
  const current = new Set(data.map((p) => p.id));
  if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) {
    throw new ApiError(409, "photos_changed", "The photos have changed. Reload the page and try again.");
  }
  const sortOf = new Map(data.map((p) => [p.id, p.sort]));
  for (const [i, id] of ids.entries()) {
    if (sortOf.get(id) === i + 1) continue;
    const { error: updateError } = await auditHeaders(db.from("venue_photos").update({ sort: i + 1 }).eq("id", id), actorStaffId, "Photos reordered");
    if (updateError) throw mapDbError(updateError);
  }
  return listPhotos(db);
}

/** Removes the photo from the website first, then its file. A file left behind by a failure is harmless. */
export async function removePhoto(db: Db, actorStaffId: string, id: string) {
  const { data, error } = await auditHeaders(db.from("venue_photos").delete().eq("id", id), actorStaffId, "Photo removed").select("storage_path").maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Photo not found");
  const { error: removeError } = await db.storage.from(PHOTO_BUCKET).remove([data.storage_path]);
  if (removeError) console.error("Photo file not removed", data.storage_path, removeError);
  return { removed: true };
}
