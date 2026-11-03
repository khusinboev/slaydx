/**
 * HeyGen avatar video adapter of the media core (Studio P9, docs/studio/P9-HEYGEN.md). ASYNC like the fal / Kling video
 * adapters: `submit` creates the video and returns `heygen:<video_id>`; the host parks it in `media_jobs` and THE shared
 * video poll loop (`lib/server/video-ops.ts`) calls `poll`, `fetchOutput` and, when it gives up, `cancel`.
 *
 * Protocol (HeyGen API v3, https://developers.heygen.com, read 2026-11-03):
 *   auth     `x-api-key: <HEYGEN_API_KEY>` on `api.heygen.com` only; no call follows a redirect (`redirect: "manual"`);
 *   voice    `GET /v3/voices?type=public&language=<Uzbek|Russian|English>&gender=<female|male>&limit=100` → `data[]
 *            { voice_id, language, gender }`: the first voice of the script's language and the chosen gender (cached for
 *            `VOICE_CACHE_MS`; a read endpoint, no charge). None found = refused before any video exists;
 *   audio    an own speech: `POST /v3/assets` (multipart, field `file`, mp3 / wav ≤ 50 MB) → `data.asset_id`, then the
 *            video takes `audio_asset_id` (mutually exclusive with `script`, docs «Create Video»);
 *   create   `POST /v3/videos` `{ type: "avatar", avatar_id, script + voice_id | audio_asset_id, resolution: "720p",
 *            aspect_ratio, engine: { type } }` with `Idempotency-Key` (24 h replay, docs) = the media job's key, so a
 *            retried submit never starts a second paid clip → `data.video_id`;
 *   status   `GET /v3/videos/{id}` → `data.status` pending | processing | completed | failed (+ cancelled in one doc page),
 *            `video_url` (presigned) when completed, `failure_code` / `failure_message` when failed;
 *   cancel   `DELETE /v3/videos/{id}` (best effort; whether a delete stops a running render's bill is not documented);
 *   output   `video_url` downloaded WITHOUT the key through `safeFetchUrl` (https + public host on every hop, capped at
 *            `VIDEO_MAX_BYTES`), its first host in `HEYGEN_FILE_HOSTS`, then checked to be an MP4.
 *
 * Failure mapping (`MediaError`): before the create call answers, nothing is billed — voice lookup / asset upload errors
 * and a create 4xx are `accepted: false` (400 `content_policy_violation` = safety, 429 / 5xx retryable); a 3xx is
 * refused; a create network drop or an answer without `video_id` is `accepted: true` (the clip may exist: never sent to
 * a second route, refunded by the host). After acceptance every poll / download error is `accepted: true`; 429 / 5xx /
 * network / a missing key retry later (the job's deadline ends it); 404 or `failed` = the clip will not come.
 * Error texts never contain the key (`scrub`).
 */
import { MediaError, isRetryableStatus, type AdapterAsset, type AdapterDeps, type AdapterInput, type MediaAdapter, type NormalizedParams, type PollResult } from "../../studio-core";
import { safeFetchUrl, UnsafeUrlError, type LookupFn } from "../../generation/safe-fetch";
import { isMp4 } from "../../generation/video/mp4";
import { VIDEO_MAX_BYTES, looksLikeSafetyRefusal } from "../../generation/video/types";
import { getProviderKey } from "../../server/providers/resolve";
import { HEYGEN_ASPECTS, HEYGEN_AVATARS, HEYGEN_SCRIPT_MAX, HEYGEN_USD_PER_SECOND, HEYGEN_VOICE_LANGUAGES, OWN_AUDIO_PARAM } from "../catalog-video";
import { scrub } from "./fal";

export const HEYGEN_PROVIDER = "heygen";
export const HEYGEN_ADAPTER_ID = "heygen-video";
export const HEYGEN_API_HOST = "api.heygen.com";
const API = `https://${HEYGEN_API_HOST}`;

/** Where a finished clip may be downloaded from (first hop): HeyGen's own file hosts and its CDN (UNVERIFIED live). */
export const HEYGEN_FILE_HOSTS: readonly string[] = ["heygen.ai", "heygen.com", "cloudfront.net"];

const CALL_MS = 30_000;
const UPLOAD_MS = 60_000;
const DOWNLOAD_MS = 60_000;
const CANCEL_MS = 5_000;
/** A voice id per language + gender is reused this long (the voice list changes rarely). */
export const VOICE_CACHE_MS = 6 * 60 * 60_000;
/** JSON answers larger than this are refused (a status / voice page is a few KB). */
const JSON_MAX_CHARS = 1_000_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{4,80}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_:.-]{1,255}$/;
/** HeyGen's codes for a refused text / avatar (docs «Error codes»). */
const SAFETY_CODES: ReadonlySet<string> = new Set(["content_policy_violation", "avatar_not_usable"]);

type Fail = { status?: number; retryable?: boolean; safety?: boolean; accepted?: boolean };

const str = (p: NormalizedParams, name: string, allowed: readonly string[], fallback: string) => {
  const v = typeof p[name] === "string" ? String(p[name]) : "";
  return allowed.includes(v) ? v : fallback;
};

/** What a job asks HeyGen for, from the normalized params (pure). `own` = the avatar speaks an own speech. */
export function heygenPlan(p: NormalizedParams): { own: boolean; avatar: string; language: keyof typeof HEYGEN_VOICE_LANGUAGES; gender: "female" | "male"; engine: string; aspect: string; script: string } {
  const own = typeof p[OWN_AUDIO_PARAM] === "string" && Boolean(String(p[OWN_AUDIO_PARAM]).trim());
  return {
    own,
    avatar: str(p, "avatar", HEYGEN_AVATARS.map((a) => a.id), HEYGEN_AVATARS[0]!.id),
    language: str(p, "language", Object.keys(HEYGEN_VOICE_LANGUAGES), "uz") as keyof typeof HEYGEN_VOICE_LANGUAGES,
    gender: str(p, "voice", ["female", "male"], "female") as "female" | "male",
    engine: str(p, "engine", Object.keys(HEYGEN_USD_PER_SECOND), "avatar_iv"),
    aspect: str(p, "aspect", HEYGEN_ASPECTS, HEYGEN_ASPECTS[0]),
    script: own ? "" : String(p.prompt ?? "").slice(0, HEYGEN_SCRIPT_MAX),
  };
}

/** The `POST /v3/videos` body (pure): a script with its voice, or an uploaded audio asset. */
export function heygenVideoBody(p: NormalizedParams, speech: { voiceId: string } | { audioAssetId: string }): Record<string, unknown> {
  const plan = heygenPlan(p);
  return {
    type: "avatar",
    avatar_id: plan.avatar,
    ...("audioAssetId" in speech ? { audio_asset_id: speech.audioAssetId } : { script: plan.script, voice_id: speech.voiceId }),
    // 720p always: the price does not depend on it (HeyGen's 720p / 1080p rate is one) and a minute fits the 25 MB cap.
    resolution: "720p",
    aspect_ratio: plan.aspect,
    engine: { type: plan.engine },
  };
}

/** `heygen:<video_id>` → the id; `null` for anything this adapter did not issue. */
export function parseHeygenOp(opId: string): string | null {
  if (!opId.startsWith("heygen:")) return null;
  const id = opId.slice("heygen:".length);
  return VIDEO_ID.test(id) ? id : null;
}

/** The first download hop must be a HeyGen file host (the presigned URL comes from HeyGen's answer, never the user). */
export function isHeygenFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return HEYGEN_FILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

async function readJson(res: Response, tooLarge: (n: number) => Error): Promise<unknown> {
  const declared = Number(res.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > JSON_MAX_CHARS) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge(declared);
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (text.length > JSON_MAX_CHARS) throw tooLarge(text.length);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `{ error: { code, message } }` (v3 error bodies) → its parts. */
function errorOf(body: unknown): { code: string; text: string } {
  const e = (body && typeof body === "object" ? (body as { error?: unknown }).error : null) as { code?: unknown; message?: unknown } | string | null | undefined;
  if (typeof e === "string") return { code: "", text: e };
  return { code: typeof e?.code === "string" ? e.code : "", text: typeof e?.message === "string" ? e.message : "" };
}

export type HeygenDeps = {
  /** The key (tests); absent = the provider store / env (`getProviderKey("heygen")`). */
  key?: () => string | null;
  /** DNS seam of `safeFetchUrl` for the download (tests). */
  lookup?: LookupFn;
  /** Voice id cache (tests pass a fresh one); absent = the module's. */
  voiceCache?: Map<string, { id: string; at: number }>;
  now?: () => number;
};

const MODULE_VOICE_CACHE = new Map<string, { id: string; at: number }>();

export function heygenVideoAdapter(o: HeygenDeps = {}): MediaAdapter {
  const keyOf = o.key ?? (() => getProviderKey(HEYGEN_PROVIDER));
  const cache = o.voiceCache ?? MODULE_VOICE_CACHE;
  const now = o.now ?? Date.now;
  const failOf = (key: string | null) => (msg: string, f: Fail) => new MediaError(HEYGEN_PROVIDER, scrub(msg, key), f);
  const fetchOf = (deps: AdapterDeps) => deps.fetchImpl ?? globalThis.fetch;

  /** A pre-acceptance call (voice list, asset upload): nothing is billed, so every failure is `accepted: false`. */
  async function before(key: string, deps: AdapterDeps, where: string, url: string, init: RequestInit, ms: number): Promise<unknown> {
    const fail = failOf(key);
    let res: Response;
    try {
      res = await fetchOf(deps)(url, { ...init, headers: { ...(init.headers as Record<string, string>), "x-api-key": key }, redirect: "manual", signal: AbortSignal.timeout(ms) });
    } catch (e) {
      throw fail(`${where}: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: false });
    }
    if (res.status >= 300 && res.status < 400) throw fail(`${where}: ${res.status} redirect rad etildi`, { status: res.status, accepted: false });
    const body = await readJson(res, (n) => fail(`${where}: javob juda katta (${n} belgi)`, { accepted: false }));
    if (!res.ok) {
      const err = errorOf(body);
      throw fail(`${where} ${res.status} ${err.code} ${err.text}`, { status: res.status, retryable: isRetryableStatus(res.status), safety: SAFETY_CODES.has(err.code), accepted: false });
    }
    return body;
  }

  async function voiceId(key: string, deps: AdapterDeps, language: keyof typeof HEYGEN_VOICE_LANGUAGES, gender: string): Promise<string> {
    const lang = HEYGEN_VOICE_LANGUAGES[language];
    const ck = `${lang}:${gender}`;
    const hit = cache.get(ck);
    if (hit && now() - hit.at < VOICE_CACHE_MS) return hit.id;
    const q = new URLSearchParams({ type: "public", language: lang, gender, limit: "100" });
    const body = (await before(key, deps, "voices", `${API}/v3/voices?${q}`, { method: "GET" }, CALL_MS)) as { data?: unknown } | null;
    const list = Array.isArray(body?.data) ? (body.data as { voice_id?: unknown; language?: unknown; gender?: unknown }[]) : [];
    // The filter is HeyGen's; the answer is checked again so a loose filter cannot hand an English voice to Uzbek text.
    const pick = list.find((v) => typeof v?.voice_id === "string" && VIDEO_ID.test(v.voice_id) && typeof v.language === "string" && v.language.toLowerCase().startsWith(lang.toLowerCase()) && (typeof v.gender !== "string" || v.gender.toLowerCase() === gender));
    if (!pick) throw failOf(key)(`voices: ${lang} ${gender} ovozi topilmadi`, { accepted: false });
    const id = String(pick.voice_id);
    cache.set(ck, { id, at: now() });
    return id;
  }

  async function uploadAudio(key: string, deps: AdapterDeps, audio: AdapterAsset): Promise<string> {
    const form = new FormData();
    const ext = audio.mime === "audio/wav" ? "wav" : "mp3";
    form.append("file", new Blob([Buffer.from(audio.base64, "base64")], { type: audio.mime }), `voice.${ext}`);
    const body = (await before(key, deps, "asset", `${API}/v3/assets`, { method: "POST", body: form }, UPLOAD_MS)) as { data?: { asset_id?: unknown } } | null;
    const id = body?.data?.asset_id;
    if (typeof id !== "string" || !VIDEO_ID.test(id)) throw failOf(key)("asset: javobda asset_id yo'q", { accepted: false });
    return id;
  }

  return {
    id: HEYGEN_ADAPTER_ID,
    configured: () => Boolean(keyOf()),

    /**
     * Pure: the create call this job makes. The voice id / the uploaded asset id are known only at submit (a voice-list
     * read, an upload), so the body names what will be looked up: `voice_id: "lookup:<Language>:<gender>"` or
     * `audio_asset_id: "upload:<generation id>"`. No key inside.
     */
    buildRequest(input) {
      const plan = heygenPlan(input.params);
      const speech = plan.own ? { audioAssetId: `upload:${String(input.params[OWN_AUDIO_PARAM])}` } : { voiceId: `lookup:${HEYGEN_VOICE_LANGUAGES[plan.language]}:${plan.gender}` };
      return { url: `${API}/v3/videos`, headers: { "Content-Type": "application/json" }, body: heygenVideoBody(input.params, speech) };
    },

    async submit(input: AdapterInput, deps: AdapterDeps = {}) {
      const key = keyOf();
      // Nothing was sent: HeyGen holds no job of ours.
      if (!key) throw new MediaError(HEYGEN_PROVIDER, "HEYGEN_API_KEY yo'q", { accepted: false });
      const fail = failOf(key);
      const plan = heygenPlan(input.params);
      let speech: { voiceId: string } | { audioAssetId: string };
      if (plan.own) {
        const audio = input.assets?.[OWN_AUDIO_PARAM]?.[0];
        if (!audio) throw fail("o'z ovozi topilmadi", { accepted: false });
        speech = { audioAssetId: await uploadAudio(key, deps, audio) };
      } else {
        speech = { voiceId: await voiceId(key, deps, plan.language, plan.gender) };
      }
      const headers: Record<string, string> = { "Content-Type": "application/json", "x-api-key": key };
      if (IDEMPOTENCY.test(input.idempotencyKey)) headers["Idempotency-Key"] = input.idempotencyKey;
      let res: Response;
      try {
        res = await fetchOf(deps)(`${API}/v3/videos`, { method: "POST", headers, body: JSON.stringify(heygenVideoBody(input.params, speech)), redirect: "manual", signal: AbortSignal.timeout(CALL_MS) });
      } catch (e) {
        // No answer: the clip may have been created (and billed) — never resubmitted elsewhere.
        throw fail(`create: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (res.status >= 300 && res.status < 400) throw fail(`create: ${res.status} redirect rad etildi`, { status: res.status });
      const body = await readJson(res, (n) => fail(`create: javob juda katta (${n} belgi)`, { accepted: res.ok }));
      if (!res.ok) {
        const err = errorOf(body);
        // 409 `request_in_progress`: the same Idempotency-Key is still running at HeyGen — a clip exists.
        const inProgress = res.status === 409 && err.code === "request_in_progress";
        throw fail(`create ${res.status} ${err.code} ${err.text}`, { status: res.status, retryable: !inProgress && isRetryableStatus(res.status), safety: SAFETY_CODES.has(err.code), accepted: inProgress });
      }
      const id = (body as { data?: { video_id?: unknown } } | null)?.data?.video_id;
      if (typeof id !== "string" || !VIDEO_ID.test(id)) throw fail("create: javobda video_id yo'q", { accepted: true });
      return { opId: `heygen:${id}` };
    },

    async poll(opId, deps: AdapterDeps = {}): Promise<PollResult> {
      const key = keyOf();
      const fail = failOf(key);
      const id = parseHeygenOp(opId);
      if (!id) throw fail("noto'g'ri operatsiya id", { accepted: true });
      // The key was removed after the submit: wait (the admin may put it back) until the job's deadline refunds it.
      if (!key) throw fail("HEYGEN_API_KEY yo'q", { accepted: true, retryable: true });
      let res: Response;
      try {
        res = await fetchOf(deps)(`${API}/v3/videos/${encodeURIComponent(id)}`, { method: "GET", headers: { "x-api-key": key }, redirect: "manual", signal: AbortSignal.timeout(CALL_MS) });
      } catch (e) {
        throw fail(`status: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (res.status >= 300 && res.status < 400) throw fail(`status: ${res.status} redirect rad etildi`, { status: res.status, accepted: true });
      if (res.status === 404) return { state: "failed", message: "heygen: video topilmadi", safety: false };
      const body = await readJson(res, (n) => fail(`status: javob juda katta (${n} belgi)`, { accepted: true, retryable: true }));
      if (!res.ok) {
        const err = errorOf(body);
        // 401 / 403: the key changed after the submit — transient (retry until the deadline), like a missing key.
        throw fail(`status ${res.status} ${err.code} ${err.text}`, { status: res.status, retryable: isRetryableStatus(res.status) || res.status === 401 || res.status === 403, accepted: true });
      }
      const d = ((body as { data?: unknown } | null)?.data ?? {}) as { status?: unknown; video_url?: unknown; failure_code?: unknown; failure_message?: unknown };
      if (d.status === "pending" || d.status === "processing" || d.status === "waiting") return { state: "running" };
      if (d.status === "failed" || d.status === "cancelled") {
        const code = typeof d.failure_code === "string" ? d.failure_code : "";
        const text = typeof d.failure_message === "string" ? d.failure_message : "";
        return { state: "failed", message: scrub(`heygen ${String(d.status)}${code ? ` ${code}` : ""}${text ? `: ${text}` : ""}`, key), safety: SAFETY_CODES.has(code) || looksLikeSafetyRefusal(text) };
      }
      if (d.status !== "completed") throw fail(`status: ${String(d.status ?? "?")}`, { retryable: true, accepted: true });
      const url = typeof d.video_url === "string" ? d.video_url : "";
      if (!url) return { state: "failed", message: "heygen: javobda video yo'q", safety: false };
      return { state: "done", outputs: [{ kind: "url", url, mime: "video/mp4" }] };
    },

    async cancel(opId, deps: AdapterDeps = {}) {
      const key = keyOf();
      const fail = failOf(key);
      const id = parseHeygenOp(opId);
      if (!id) throw fail("noto'g'ri operatsiya id", { accepted: true });
      if (!key) throw fail("HEYGEN_API_KEY yo'q", { accepted: true });
      let res: Response;
      try {
        res = await fetchOf(deps)(`${API}/v3/videos/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-api-key": key }, redirect: "manual", signal: AbortSignal.timeout(CANCEL_MS) });
      } catch (e) {
        throw fail(`cancel: ${e instanceof Error ? e.message : String(e)}`, { accepted: true });
      }
      await res.body?.cancel().catch(() => {});
      if (!res.ok) throw fail(`cancel ${res.status}`, { status: res.status, accepted: true });
      return "cancelled";
    },

    async fetchOutput(output, deps: AdapterDeps = {}) {
      const fail = failOf(keyOf());
      if (output.kind === "inline") {
        if (!isMp4(output.bytes)) throw fail("video: MP4 emas", { accepted: true });
        return output.bytes;
      }
      if (!isHeygenFileUrl(output.url)) throw fail("video URL rad etildi (host)", { accepted: true });
      let res: Response;
      try {
        // WITHOUT the key: a presigned file URL, checked host by host, capped.
        res = await safeFetchUrl(output.url, { timeoutMs: DOWNLOAD_MS, maxBytes: VIDEO_MAX_BYTES, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(o.lookup ? { lookup: o.lookup } : {}) });
      } catch (e) {
        if (e instanceof UnsafeUrlError) throw fail(e.reason === "size" ? "video fayli juda katta" : `video URL rad etildi (${e.reason})`, { accepted: true });
        throw fail(`download: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (!res.ok) throw fail(`download ${res.status}`, { status: res.status, retryable: isRetryableStatus(res.status), accepted: true });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!isMp4(bytes)) throw fail("yuklangan fayl MP4 emas", { retryable: true, accepted: true });
      return bytes;
    },
  };
}
