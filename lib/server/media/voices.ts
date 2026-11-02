import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../api";
import { query, queryOne, transaction } from "../db";
import { env } from "../env";
import { getSetting } from "../settings";
import { readUploadForm } from "../upload-body";
import { uploadAssetId } from "../upload-quota";
import { availableModels } from "./availability";
import { getProviderKey } from "../providers/resolve";
import { MEDIA_CATALOG } from "../../media/catalog";
import { STUDIO_CLONE_PURPOSE, STUDIO_SPEECH_PURPOSE } from "../../media/catalog-speech";
import {
  CLONE_CONSENT_VERSION,
  CLONE_SAMPLE_MAX_BYTES,
  CLONE_SAMPLE_MAX_SECONDS,
  CLONE_SAMPLE_MIN_SECONDS,
  CLONE_UNUSED_DAYS,
  CLONE_WARN_DAYS,
  cloneIdsOf,
  studioSpeechEntry,
} from "../../media/studio-speech";
import { geminiTtsModel } from "../../generation/tts/gemini";
import { mp3Frames, mp3Seconds, wavInfo, wavSeconds } from "../../generation/tts/mp3";
import { ELEVENLABS_SUBSCRIPTION_URL, elevenLabsFetch, elevenLabsSlotsOf, elevenLabsVoiceUrl } from "../../generation/tts/elevenlabs";
import { TtsError } from "../../generation/tts/types";
import type { FormValues } from "../../types";

/**
 * Studio «Ovoz» server side (docs/studio/P5-SPEC.md): which voice models are offered, the user's samples and clones,
 * the checks that run BEFORE anything is charged, and the housekeeping of clones (30-day unused purge, provider deletes).
 *
 * Money and likeness rules (owner 2026-11-02):
 *   - one active clone per user (also a partial unique index, migration 068); a delete frees the slot at once;
 *   - the consent checkbox is mandatory and recorded with the sample (user, time, HMAC of the IP, wording version);
 *   - a clone is refused BEFORE charging when the ElevenLabs account has no free voice slot (or the slots cannot be read);
 *   - samples: WAV / MP3 only (sniffed, never the browser's type), 30–180 s measured, ≤ 10 MB; uploads rate-limited.
 * Ownership is always in SQL (`user_id = $n`).
 */

/* ───────────────────────── availability ───────────────────────── */

/** Gemini speech needs the operator's TTS model on top of the key (`TTS_GEMINI_MODEL`, the podcast rule). */
function routeConfigured(modelId: string): boolean {
  const entry = MEDIA_CATALOG.byId(modelId);
  if (!entry) return false;
  return entry.routes.some((r) => r.provider !== "gemini" || Boolean(geminiTtsModel()));
}

/** The «Ovoz» models available now; none while `studio.voice.enabled` is off (the tab ships dark). */
export async function studioSpeechModels(): Promise<string[]> {
  if (!(await getSetting("studio.voice.enabled"))) return [];
  return (await availableModels(STUDIO_SPEECH_PURPOSE)).filter(routeConfigured);
}

/** Cloning is offered now: the tab is on and the ElevenLabs clone model is available. */
export async function cloneAvailable(): Promise<boolean> {
  if (!(await getSetting("studio.voice.enabled"))) return false;
  return (await availableModels(STUDIO_CLONE_PURPOSE)).length > 0;
}

/** Why the speech request cannot be sold now (Uzbek, a 400 before charging), `null` when it can. */
export async function speechModelUnavailable(values: FormValues): Promise<string | null> {
  if (!(await getSetting("studio.voice.enabled"))) return "Ovoz bo‘limi hozircha mavjud emas.";
  const entry = studioSpeechEntry(values);
  if (!entry) return "Noma'lum ovoz modeli — boshqa modelni tanlang.";
  return (await studioSpeechModels()).includes(entry.id) ? null : "Tanlangan model hozir mavjud emas — boshqa modelni tanlang.";
}

/* ───────────────────────── samples ───────────────────────── */

/** HMAC of the client IP with the session secret: proves «from where» without storing the IP itself. */
export function consentIpHash(ip: string): string {
  return createHmac("sha256", env.sessionSecret).update(`studio-consent:${ip}`).digest("hex");
}

export type SniffedAudio = { mime: "audio/wav" | "audio/mpeg"; seconds: number };

/**
 * The sample's real type and length from its bytes (the browser's type is never trusted): a PCM WAV (RIFF/WAVE with a
 * `fmt ` + `data` chunk) or an MP3 (frames that `mp3Seconds` can count). Anything else → `null`.
 */
export function sniffAudio(bytes: Uint8Array): SniffedAudio | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (bytes.length > 44 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") {
    const info = wavInfo(bytes);
    const seconds = info ? wavSeconds(bytes) : 0;
    return info && seconds > 0 ? { mime: "audio/wav", seconds } : null;
  }
  const frames = mp3Frames(bytes);
  // A real MP3 has many frames; a stray 0xFFE sync in random bytes does not make a voice.
  if (frames.length >= 10) {
    const seconds = mp3Seconds(bytes);
    return seconds > 0 ? { mime: "audio/mpeg", seconds } : null;
  }
  return null;
}

/** Uzbek reason the sample cannot be used (400 / 415 / 422), `null` when it is fine. */
export function sampleError(s: SniffedAudio | null): { message: string; status: number } | null {
  if (!s) return { message: "Faqat WAV yoki MP3 yozuv qabul qilinadi.", status: 415 };
  if (s.seconds < CLONE_SAMPLE_MIN_SECONDS) return { message: `Yozuv kamida ${CLONE_SAMPLE_MIN_SECONDS} soniya bo‘lsin (hozir ${Math.floor(s.seconds)} s).`, status: 422 };
  if (s.seconds > CLONE_SAMPLE_MAX_SECONDS) return { message: `Yozuv ${CLONE_SAMPLE_MAX_SECONDS / 60} daqiqadan oshmasin.`, status: 422 };
  return null;
}

/** Per user: sample uploads (= clone attempts) per hour and per day. */
export const SAMPLE_UPLOADS_PER_HOUR = 5;
export const SAMPLE_UPLOADS_PER_DAY = 10;

export type SampleResult = { sampleId: string; seconds: number; mime: string; size: number };

/**
 * `POST /api/media/voices/samples` body: `file` (the recording) + `consent` = "1" (the checkbox). The consent is stored
 * with the sample; without it nothing is stored.
 */
export async function uploadVoiceSample(req: Request, userId: string, ip: string): Promise<SampleResult> {
  const form = await readUploadForm(req, CLONE_SAMPLE_MAX_BYTES + 64 * 1024, "Yozuv 10 MB dan katta");
  if (String(form?.get("consent") ?? "") !== "1") throw new ApiError("«Bu ovozdan foydalanishga haqqim bor» belgisini qo‘ying.", 400, { code: "consent_required" });
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Yozuv yuborilmadi", 400);
  if (file.size === 0) throw new ApiError("Yozuv bo‘sh", 400);
  if (file.size > CLONE_SAMPLE_MAX_BYTES) throw new ApiError("Yozuv 10 MB dan katta", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffAudio(new Uint8Array(bytes));
  const bad = sampleError(sniffed);
  if (bad) throw new ApiError(bad.message, bad.status, { code: "sample_invalid" });
  const id = uploadAssetId(bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await query(
    `INSERT INTO studio_voice_samples (id, user_id, mime, size_bytes, seconds, sha256, bytes, consent_at, consent_ip_hash, consent_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)
     ON CONFLICT (id) DO UPDATE SET consent_at = now(), consent_ip_hash = EXCLUDED.consent_ip_hash, consent_version = EXCLUDED.consent_version,
       bytes = EXCLUDED.bytes, cleared_at = NULL
     WHERE studio_voice_samples.user_id = EXCLUDED.user_id`,
    [id, userId, sniffed!.mime, bytes.byteLength, Math.round(sniffed!.seconds * 100) / 100, sha, bytes, consentIpHash(ip), CLONE_CONSENT_VERSION],
  );
  // Same bytes uploaded by ANOTHER user: the id collides and the row stays theirs — refuse instead of sharing it.
  const own = await queryOne<{ ok: number }>("SELECT 1 AS ok FROM studio_voice_samples WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!own) throw new ApiError("Bu yozuvdan foydalanib bo‘lmaydi — boshqa yozuv yuklang.", 409);
  return { sampleId: id, seconds: Math.round(sniffed!.seconds * 10) / 10, mime: sniffed!.mime, size: bytes.byteLength };
}

type SampleRow = { id: string; mime: string; seconds: string; sha256: string; bytes: Buffer | null; consent_at: Date; consent_ip_hash: string; consent_version: string };

async function ownSample(c: PoolClient | null, userId: string, sampleId: string): Promise<SampleRow | null> {
  if (!/^[0-9a-f]{24}$/.test(sampleId)) return null;
  const sql = `SELECT id, mime, seconds::text AS seconds, sha256, bytes, consent_at, consent_ip_hash, consent_version
                 FROM studio_voice_samples WHERE id = $1 AND user_id = $2 AND cleared_at IS NULL AND bytes IS NOT NULL`;
  const rows = c ? (await c.query<SampleRow>(sql, [sampleId, userId])).rows : await query<SampleRow>(sql, [sampleId, userId]);
  return rows[0] ?? null;
}

/* ───────────────────────── voice slots ───────────────────────── */

export type VoiceSlots = { used: number; limit: number; canClone: boolean };
export type SlotDeps = { fetchImpl?: typeof fetch; key?: () => string; now?: () => number };

let slotCache: { at: number; value: VoiceSlots | null } | null = null;
const SLOT_TTL_MS = 30_000;

/** Drops the cached slot count (after a clone / delete, and in tests). */
export function resetSlotCache(): void {
  slotCache = null;
}

/** The ElevenLabs account's voice slots (`GET /v1/user/subscription`), cached 30 s; `null` when they cannot be read. */
export async function elevenLabsSlots(deps: SlotDeps = {}): Promise<VoiceSlots | null> {
  const now = (deps.now ?? Date.now)();
  if (slotCache && now - slotCache.at < SLOT_TTL_MS) return slotCache.value;
  const key = (deps.key ?? (() => getProviderKey("elevenlabs")))();
  let value: VoiceSlots | null = null;
  if (key) {
    try {
      const res = await elevenLabsFetch({ url: ELEVENLABS_SUBSCRIPTION_URL, method: "GET" }, { key, fetchImpl: deps.fetchImpl, timeoutMs: 10_000 });
      value = elevenLabsSlotsOf(await res.json().catch(() => null));
    } catch (e) {
      console.warn("[studio-voices] slots not read:", e instanceof Error ? e.message : e);
    }
  }
  slotCache = { at: now, value };
  return value;
}

/* ───────────────────────── clones ───────────────────────── */

export type UserVoice = {
  id: string;
  /** Voice value the forms send (`clone:<id>`). */
  voice: string;
  name: string;
  status: "creating" | "ready";
  createdAt: string;
  lastUsedAt: string;
  /** When the 30-day unused purge deletes it (the in-app notice), `null` while it is still being made. */
  expiresAt: string | null;
};

type VoiceRow = { id: string; name: string; status: "creating" | "ready"; created_at: Date; last_used_at: Date; provider_voice_id: string | null };

function toUserVoice(r: VoiceRow): UserVoice {
  return {
    id: r.id,
    voice: `clone:${r.id}`,
    name: r.name,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: new Date(r.last_used_at).toISOString(),
    expiresAt: r.status === "ready" ? new Date(new Date(r.last_used_at).getTime() + CLONE_UNUSED_DAYS * 86_400_000).toISOString() : null,
  };
}

/** The user's active clone (at most one), newest first. */
export async function listUserVoices(userId: string): Promise<UserVoice[]> {
  const rows = await query<VoiceRow>(
    `SELECT id::text AS id, name, status, created_at, last_used_at, provider_voice_id
       FROM studio_voices WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toUserVoice);
}

/** A clone job of this user still waiting / running (its row may not exist yet). */
async function cloneJobInFlight(userId: string): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    "SELECT 1 AS n FROM generations WHERE user_id = $1 AND tool_id = 'studio-voice' AND status IN ('QUEUED', 'IN_PROGRESS') LIMIT 1",
    [userId],
  );
  return row !== null;
}

/**
 * Why a clone purchase must be refused BEFORE charging (an `ApiError`), in this order: the tab is off / ElevenLabs is
 * not available; the sample is not the user's own (or already used); the user already has a clone (or one is being
 * made); the account has no free voice slot (or the slots cannot be read — never charge blind).
 */
export async function assertCloneAllowed(userId: string, values: FormValues, deps: SlotDeps = {}): Promise<void> {
  if (!(await cloneAvailable())) throw new ApiError("Ovoz klonlash hozircha mavjud emas.", 400, { code: "clone_unavailable" });
  const sample = await ownSample(null, userId, String(values.sampleId ?? "").trim());
  if (!sample) throw new ApiError("Yozuv topilmadi — qayta yozib yoki yuklab ko‘ring.", 400, { code: "sample_missing" });
  const active = await queryOne<{ n: number }>("SELECT 1 AS n FROM studio_voices WHERE user_id = $1 AND deleted_at IS NULL", [userId]);
  if (active || (await cloneJobInFlight(userId))) {
    throw new ApiError("Sizda allaqachon klon ovoz bor. Yangisini yaratish uchun avval eskisini o‘chiring.", 409, { code: "clone_exists" });
  }
  const slots = await elevenLabsSlots(deps);
  if (!slots) throw new ApiError("Ovoz xizmatini hozir tekshirib bo‘lmadi. Birozdan keyin urinib ko‘ring — pul yechilmadi.", 503, { code: "slots_unknown" });
  if (!slots.canClone || slots.used >= slots.limit) {
    throw new ApiError("Hozir yangi ovoz klonlash uchun bo‘sh joy yo‘q. Birozdan keyin urinib ko‘ring — pul yechilmadi.", 409, { code: "no_voice_slot" });
  }
}

/** The clone voices of a speech request must be the user's own READY clones (400 before charging). */
export async function assertOwnClones(userId: string, values: FormValues): Promise<void> {
  const entry = studioSpeechEntry(values);
  const ids = entry ? cloneIdsOf(entry, values) : [];
  if (!ids.length) return;
  const rows = await query<{ id: string }>(
    "SELECT id::text AS id FROM studio_voices WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND status = 'ready'",
    [userId, ids],
  );
  if (rows.length !== ids.length) throw new ApiError("Tanlangan ovoz topilmadi — qayta tanlang.", 400, { code: "voice_missing" });
}

/** The worker's view of a speech job: the owner's ready clones it names (provider ids stay server-side). */
export async function studioSpeechJobCtx(userId: string, values: FormValues) {
  const entry = studioSpeechEntry(values);
  const ids = entry ? cloneIdsOf(entry, values) : [];
  const rows = ids.length
    ? await query<{ id: string; provider_voice_id: string; name: string }>(
        "SELECT id::text AS id, provider_voice_id, name FROM studio_voices WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND status = 'ready'",
        [userId, ids],
      )
    : [];
  return {
    clones: Object.fromEntries(rows.map((r) => [r.id, { providerVoiceId: r.provider_voice_id, name: r.name }])),
    touch: async (cloneIds: readonly string[]) => {
      await query("UPDATE studio_voices SET last_used_at = now(), warned_at = NULL WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL", [userId, [...cloneIds]]);
    },
  };
}

export type ProviderDeleteDeps = { fetchImpl?: typeof fetch; key?: () => string };

/** DELETE /v1/voices/{id}: `true` when the voice is gone at ElevenLabs (deleted now, or already absent — 404). */
export async function providerDeleteVoice(providerVoiceId: string, deps: ProviderDeleteDeps = {}): Promise<boolean> {
  const key = (deps.key ?? (() => getProviderKey("elevenlabs")))();
  if (!key) return false;
  try {
    await elevenLabsFetch({ url: elevenLabsVoiceUrl(providerVoiceId), method: "DELETE" }, { key, fetchImpl: deps.fetchImpl, timeoutMs: 15_000 });
    return true;
  } catch (e) {
    if (e instanceof TtsError && e.status === 404) return true;
    console.warn("[studio-voices] provider delete failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * The user deletes their clone: hidden at once (a new clone may be made right away), the ElevenLabs voice deleted now
 * when possible, else by housekeeping. Another user's id / an unknown id is a 404; a clone still being made is a 409.
 */
export async function deleteUserVoice(userId: string, id: string, deps: ProviderDeleteDeps = {}): Promise<{ deleted: true; providerDeleted: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("Ovoz topilmadi", 404);
  const row = await queryOne<{ provider_voice_id: string | null; status: string }>(
    "SELECT provider_voice_id, status FROM studio_voices WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [id, userId],
  );
  if (!row) throw new ApiError("Ovoz topilmadi", 404);
  if (row.status !== "ready") throw new ApiError("Ovoz hali tayyorlanmoqda — biroz kuting.", 409, { code: "clone_creating" });
  await query("UPDATE studio_voices SET deleted_at = now(), delete_reason = 'user' WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [id, userId]);
  await query("DELETE FROM studio_voice_previews WHERE voice_key = $1", [`clone:${id}`]);
  const providerDeleted = row.provider_voice_id ? await providerDeleteVoice(row.provider_voice_id, deps) : true;
  if (providerDeleted) await query("UPDATE studio_voices SET provider_deleted_at = now() WHERE id = $1", [id]);
  resetSlotCache();
  return { deleted: true, providerDeleted };
}

/* ───────────────────────── the clone job (worker) ───────────────────────── */

export type CloneRow = { id: string };

/**
 * Starts a clone inside the worker: the row is written in status 'creating' BEFORE any provider call, so the partial
 * unique index refuses a second active clone even for two concurrent jobs (→ the job fails, full refund, no provider
 * call). Returns the row id and the sample to upload; the sample must still be the user's own.
 */
export async function beginClone(userId: string, generationId: string, values: FormValues): Promise<{ voiceId: string; name: string; sample: { mime: string; base64: string } }> {
  const name = String(values.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) throw new CloneRefused("Ovoz nomini yozing.");
  return transaction(async (c) => {
    const sample = await ownSample(c, userId, String(values.sampleId ?? "").trim());
    if (!sample?.bytes) throw new CloneRefused("Yozuv topilmadi — qayta yozib ko‘ring.");
    let id: string;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO studio_voices (user_id, generation_id, name, status, sample_id, sample_sha256, sample_seconds, consent_at, consent_ip_hash, consent_version)
         VALUES ($1, $2, $3, 'creating', $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
        [userId, generationId, name, sample.id, sample.sha256, sample.seconds, sample.consent_at, sample.consent_ip_hash, sample.consent_version],
      );
      id = r.rows[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new CloneRefused("Sizda allaqachon klon ovoz bor.");
      throw e;
    }
    return { voiceId: id, name, sample: { mime: sample.mime, base64: sample.bytes.toString("base64") } };
  });
}

/** The clone answered: the row is ready, the sample's bytes are cleared (the consent stays on both rows). */
export async function finishClone(voiceId: string, providerVoiceId: string, sampleId: string): Promise<void> {
  await transaction(async (c) => {
    await c.query("UPDATE studio_voices SET status = 'ready', provider_voice_id = $2, last_used_at = now() WHERE id = $1", [voiceId, providerVoiceId]);
    await c.query("UPDATE studio_voice_samples SET bytes = NULL, cleared_at = now() WHERE id = $1", [sampleId]);
  });
  resetSlotCache();
}

/**
 * The clone job failed: no clone left behind. Before the provider answered the row is simply removed; after it (the
 * preview failed) the row is marked deleted ('failed') and the ElevenLabs voice deleted now or by housekeeping.
 */
export async function abortClone(voiceId: string, providerVoiceId: string | null, deps: ProviderDeleteDeps = {}): Promise<void> {
  if (!providerVoiceId) {
    await query("DELETE FROM studio_voices WHERE id = $1 AND status = 'creating'", [voiceId]);
    return;
  }
  await query("UPDATE studio_voices SET status = 'ready', provider_voice_id = $2, deleted_at = now(), delete_reason = 'failed' WHERE id = $1 AND deleted_at IS NULL", [voiceId, providerVoiceId]);
  if (await providerDeleteVoice(providerVoiceId, deps)) await query("UPDATE studio_voices SET provider_deleted_at = now() WHERE id = $1", [voiceId]);
  resetSlotCache();
}

/** A refusal the user reads as is (the job fails, the worker refunds in full). */
export class CloneRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneRefused";
  }
}

/* ───────────────────────── previews ───────────────────────── */

export async function readPreview(key: string): Promise<Buffer | null> {
  const row = await queryOne<{ bytes: Buffer }>("SELECT bytes FROM studio_voice_previews WHERE voice_key = $1", [key]);
  return row?.bytes ?? null;
}

export async function storePreview(key: string, bytes: Uint8Array): Promise<void> {
  await query(
    "INSERT INTO studio_voice_previews (voice_key, mime, size_bytes, bytes) VALUES ($1, 'audio/mpeg', $2, $3) ON CONFLICT (voice_key) DO NOTHING",
    [key, bytes.byteLength, Buffer.from(bytes)],
  );
}

/* ───────────────────────── housekeeping ───────────────────────── */

export type HousekeepingDeps = ProviderDeleteDeps & {
  /** Sends the «your clone will be deleted» notice; default = the bot DM (`sendUserDm`). */
  notify?: (t: { userId: string; telegramId: string | null; language: string | null; name: string; days: number }) => Promise<void>;
  batch?: number;
};

export const CLONE_WARN_TEXT = (name: string, days: number) =>
  `«${name}» klon ovozingiz ${CLONE_UNUSED_DAYS} kun ishlatilmadi va ${days} kundan keyin o‘chiriladi. Saqlab qolish uchun Studio «Ovoz» bo‘limida u bilan biror matnni ovozlang.`;

async function botNotify(t: { userId: string; telegramId: string | null; language: string | null; name: string; days: number }): Promise<void> {
  if (!t.telegramId) return;
  const { sendUserDm } = await import("../bot-dm");
  await sendUserDm({ userId: t.userId, telegramId: t.telegramId, language: t.language }, () => ({ text: CLONE_WARN_TEXT(t.name, t.days) }));
}

/**
 * Leader housekeeping (one pass): warn the owners of clones unused for (30 − 3) days (once per idle period: claimed by
 * `warned_at` before sending), delete clones unused for 30 days, retry the provider deletes still owed, close 'creating'
 * rows a dead worker left (> 1 h), drop samples older than a day. Returns what it did.
 */
export async function studioVoicesHousekeeping(deps: HousekeepingDeps = {}): Promise<{ warned: number; purged: number; providerDeleted: number; stale: number; samples: number }> {
  const batch = deps.batch ?? 50;
  const notify = deps.notify ?? botNotify;
  const warned = await query<{ id: string; user_id: string; name: string; telegram_id: string | null; language: string | null }>(
    `UPDATE studio_voices v SET warned_at = now()
       FROM users u
      WHERE v.id IN (SELECT id FROM studio_voices
                      WHERE deleted_at IS NULL AND status = 'ready' AND warned_at IS NULL
                        AND last_used_at < now() - $1::int * interval '1 day'
                      ORDER BY last_used_at LIMIT $2)
        AND u.id = v.user_id
      RETURNING v.id::text AS id, v.user_id::text AS user_id, v.name, u.telegram_id::text AS telegram_id, u.language`,
    [CLONE_UNUSED_DAYS - CLONE_WARN_DAYS, batch],
  );
  for (const w of warned) {
    try {
      await notify({ userId: w.user_id, telegramId: w.telegram_id, language: w.language, name: w.name, days: CLONE_WARN_DAYS });
    } catch (e) {
      console.warn("[studio-voices] warn not sent:", e instanceof Error ? e.message : e);
    }
  }
  const purged = await query<{ id: string }>(
    `UPDATE studio_voices SET deleted_at = now(), delete_reason = 'unused'
      WHERE id IN (SELECT id FROM studio_voices WHERE deleted_at IS NULL AND status = 'ready'
                     AND last_used_at < now() - $1::int * interval '1 day' ORDER BY last_used_at LIMIT $2)
      RETURNING id::text AS id`,
    [CLONE_UNUSED_DAYS, batch],
  );
  if (purged.length) await query("DELETE FROM studio_voice_previews WHERE voice_key = ANY($1::text[])", [purged.map((p) => `clone:${p.id}`)]);
  const stale = await query<{ id: string }>(
    "DELETE FROM studio_voices WHERE status = 'creating' AND deleted_at IS NULL AND created_at < now() - interval '1 hour' RETURNING id::text AS id",
  );
  const owed = await query<{ id: string; provider_voice_id: string }>(
    `SELECT id::text AS id, provider_voice_id FROM studio_voices
      WHERE deleted_at IS NOT NULL AND provider_deleted_at IS NULL AND provider_voice_id IS NOT NULL
      ORDER BY deleted_at LIMIT $1`,
    [batch],
  );
  let providerDeleted = 0;
  for (const o of owed) {
    if (await providerDeleteVoice(o.provider_voice_id, deps)) {
      await query("UPDATE studio_voices SET provider_deleted_at = now() WHERE id = $1", [o.id]);
      providerDeleted++;
    }
  }
  if (providerDeleted) resetSlotCache();
  const samples = await query("DELETE FROM studio_voice_samples WHERE created_at < now() - interval '1 day' RETURNING id");
  return { warned: warned.length, purged: purged.length, providerDeleted, stale: stale.length, samples: samples.length };
}
