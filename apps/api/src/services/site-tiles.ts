import { randomUUID } from "node:crypto";
import type { Db } from "@raceground/db";
import { ApiError, mapDbError } from "../errors.js";
import { auditHeaders } from "../lib/audit-headers.js";
import { detectImageType, MAX_PHOTO_BYTES, PHOTO_BUCKET, photoUrl } from "./venue-photos.js";

/** The home page's image tiles (D87). Images share the website photos' bucket, under `tiles/`. */
export const TILE_SECTIONS = ["highlights", "events", "driving"] as const;
export type TileSection = (typeof TILE_SECTIONS)[number];

interface TileRow {
  id: string;
  section: string;
  title: string;
  image_path: string | null;
  sort: number;
  active: boolean;
}

const view = (db: Db, t: TileRow) => ({
  id: t.id,
  section: t.section as TileSection,
  title: t.title,
  imageUrl: t.image_path ? photoUrl(db, t.image_path) : null,
  sort: t.sort,
  active: t.active,
});

export async function listTiles(db: Db, { activeOnly }: { activeOnly: boolean }) {
  let query = db.from("site_tiles").select("id, section, title, image_path, sort, active").order("section").order("sort").order("title");
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw mapDbError(error);
  return data.map((t) => view(db, t));
}

async function tileById(db: Db, id: string): Promise<TileRow> {
  const { data, error } = await db.from("site_tiles").select("id, section, title, image_path, sort, active").eq("id", id).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Tile not found");
  return data;
}

export async function addTile(db: Db, actor: string, section: TileSection, title: string, reason?: string) {
  const { data: existing, error: sortError } = await db.from("site_tiles").select("sort").eq("section", section);
  if (sortError) throw mapDbError(sortError);
  const sort = Math.max(0, ...existing.map((t) => t.sort)) + 1;
  const { data, error } = await auditHeaders(db.from("site_tiles").insert({ section, title, sort }), actor, reason)
    .select("id, section, title, image_path, sort, active")
    .single();
  if (error) throw mapDbError(error);
  return view(db, data);
}

export async function updateTile(
  db: Db,
  actor: string,
  id: string,
  changes: { title?: string | undefined; sort?: number | undefined; active?: boolean | undefined },
  reason?: string,
) {
  const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as { title?: string; sort?: number; active?: boolean };
  if (Object.keys(patch).length === 0) throw new ApiError(422, "validation_failed", "Nothing to change");
  const { data, error } = await auditHeaders(db.from("site_tiles").update(patch).eq("id", id), actor, reason)
    .select("id, section, title, image_path, sort, active")
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(404, "not_found", "Tile not found");
  return view(db, data);
}

/** Puts a new image on a tile. The old file is removed only after the tile points at the new one. */
export async function setTileImage(db: Db, actor: string, id: string, file: File) {
  const tile = await tileById(db, id);
  if (file.size === 0) throw new ApiError(422, "validation_failed", "The file is empty");
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError(422, "validation_failed", "Images can be at most 5 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) throw new ApiError(422, "validation_failed", "Upload a JPEG, PNG or WebP image");

  const path = `tiles/${randomUUID()}.${type.ext}`;
  const { error: uploadError } = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: type.contentType, upsert: false, cacheControl: "31536000" });
  if (uploadError) {
    console.error("Tile image upload failed", uploadError);
    throw new ApiError(502, "storage_failed", "The image couldn't be saved. Please try again.");
  }
  const { data, error } = await auditHeaders(db.from("site_tiles").update({ image_path: path }).eq("id", id), actor, "Tile image changed")
    .select("id, section, title, image_path, sort, active")
    .single();
  if (error) {
    await db.storage.from(PHOTO_BUCKET).remove([path]);
    throw mapDbError(error);
  }
  if (tile.image_path) await removeFile(db, tile.image_path);
  return view(db, data);
}

/** Back to the placeholder. */
export async function clearTileImage(db: Db, actor: string, id: string) {
  const tile = await tileById(db, id);
  const { data, error } = await auditHeaders(db.from("site_tiles").update({ image_path: null }).eq("id", id), actor, "Tile image removed")
    .select("id, section, title, image_path, sort, active")
    .single();
  if (error) throw mapDbError(error);
  if (tile.image_path) await removeFile(db, tile.image_path);
  return view(db, data);
}

export async function removeTile(db: Db, actor: string, id: string, reason?: string) {
  const tile = await tileById(db, id);
  const { error } = await auditHeaders(db.from("site_tiles").delete().eq("id", id), actor, reason);
  if (error) throw mapDbError(error);
  if (tile.image_path) await removeFile(db, tile.image_path);
  return { removed: true };
}

/** A file left behind by a failure is harmless; a tile pointing at a missing file is not. */
async function removeFile(db: Db, path: string) {
  const { error } = await db.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) console.error("Tile image file not removed", path, error);
}
