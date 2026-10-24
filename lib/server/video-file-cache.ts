import "server-only";
import { queryOne } from "./db";

/**
 * A SMALL in-process cache of finished video files, for HTTP Range requests only (program-17 item 5, review m4).
 *
 * A `<video>` element issues many `Range` requests per playback (seeking, buffering), and the file lives in Postgres as
 * one BYTEA: without a cache every 206 re-reads up to 25 MB. The cache holds at most `MAX_ENTRIES` files for `TTL_MS`
 * each (<= 3 x 25 MB = 75 MB worst case, on a 7.8 GB box), keyed by user + generation + file version.
 *
 * Safety: a hit is still gated by one tiny query (`peek`: the user owns the row, it is COMPLETED, and its file version
 * equals the cached one), so a deleted / replaced / foreign file is never served from memory; the entry key also
 * contains the user id. Only video files are ever stored here.
 */
export const VIDEO_CACHE_MAX_ENTRIES = 3;
export const VIDEO_CACHE_TTL_MS = 60_000;

export type CachedVideo = { bytes: Buffer; fileName: string; mime: string };
type Entry = CachedVideo & { at: number };

type Holder = { entries: Map<string, Entry>; hits: number; misses: number };
const g = globalThis as typeof globalThis & { __slaydxVideoCache?: Holder };
const holder: Holder = (g.__slaydxVideoCache ??= { entries: new Map(), hits: 0, misses: 0 });

type Meta = { file_version: string | number | null };

/** Ownership + readiness + version of the stored file in ONE tiny query (no bytes). */
async function peek(generationId: string, userId: string): Promise<string | null> {
  const row = await queryOne<Meta>(
    `SELECT g.file_version
       FROM generation_files f
       JOIN generations g ON g.id = f.generation_id
      WHERE f.generation_id = $1 AND g.user_id = $2 AND g.status = 'COMPLETED' AND f.mime LIKE 'video/%'`,
    [generationId, userId],
  );
  return row ? String(row.file_version ?? 0) : null;
}

const keyOf = (userId: string, generationId: string, version: string) => `${userId}:${generationId}:${version}`;

/** The cached file for a Range request, or `null` (not cached / expired / changed / not the user's / not a video). */
export async function cachedVideo(generationId: string, userId: string, now: number = Date.now()): Promise<CachedVideo | null> {
  if (holder.entries.size === 0) {
    holder.misses++;
    return null;
  }
  const version = await peek(generationId, userId);
  const e = version === null ? undefined : holder.entries.get(keyOf(userId, generationId, version));
  if (!e || now - e.at > VIDEO_CACHE_TTL_MS) {
    if (e) holder.entries.delete(keyOf(userId, generationId, version!));
    holder.misses++;
    return null;
  }
  // Refresh recency (Map keeps insertion order: the oldest is evicted first).
  holder.entries.delete(keyOf(userId, generationId, version!));
  holder.entries.set(keyOf(userId, generationId, version!), e);
  holder.hits++;
  return { bytes: e.bytes, fileName: e.fileName, mime: e.mime };
}

/** Remembers a file just read from the database (video only). Evicts expired entries, then the oldest beyond the bound. */
export async function rememberVideo(generationId: string, userId: string, file: CachedVideo, now: number = Date.now()): Promise<void> {
  if (!file.mime.startsWith("video/")) return;
  const version = await peek(generationId, userId);
  if (version === null) return;
  for (const [k, v] of holder.entries) if (now - v.at > VIDEO_CACHE_TTL_MS) holder.entries.delete(k);
  holder.entries.set(keyOf(userId, generationId, version), { ...file, at: now });
  while (holder.entries.size > VIDEO_CACHE_MAX_ENTRIES) holder.entries.delete(holder.entries.keys().next().value as string);
}

export function videoCacheStats(): { entries: number; hits: number; misses: number } {
  return { entries: holder.entries.size, hits: holder.hits, misses: holder.misses };
}

/** Test seam. */
export function resetVideoCache(): void {
  holder.entries.clear();
  holder.hits = 0;
  holder.misses = 0;
}
