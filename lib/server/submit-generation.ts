import "server-only";
import { ApiError } from "./api";
import { budgetFor } from "../generation/budget";
import { isAudioToolId } from "../generation/audio/types";
import { normalizeVoiceChoice, normalizeVoiceProvider } from "../generation/tts/types";
import { enqueueGeneration, IDEMPOTENCY_WINDOW_HOURS } from "./jobs";
import { sourceCharsForRequest } from "./source-upload";
import { missingRequired, preflightError, topicOf } from "../tools";
import { env, imageModelUnavailable, videoProviderUnavailable, voiceProviderUnavailable } from "./env";
import { ensureProviderKeys } from "./providers/store";
import { queueLimits } from "./queue-limits";
import { queryOne } from "./db";
import { effectivePrice } from "./pricing";
import { getSetting } from "./settings";
import { assertCanCreate } from "./mandatory-channels";
import { assertOfferAccepted } from "./oferta";
import { photoExists } from "./photo";
import { portraitInputFromValues } from "../generation/portrait/registry";
import { videoInputFromValues } from "../generation/video/registry";
import type { FormValues, ToolConfig, ToolId } from "../types";
import { modelUnavailable } from "./media/availability";
import { STUDIO_IMAGE_PURPOSE, studioPurposeOf } from "../media/catalog";
import { studioInputsError, studioVideoInputsError } from "./media/inputs";
import { studioModelOf } from "../media/studio-pricing";
import { STUDIO_VIDEO_PURPOSE } from "../media/catalog-video";
import { studioVideoImageParams, studioVideoModelOf } from "../media/studio-video-pricing";
import { isPaidOnlyTool } from "../tool-kinds";
import { normalize } from "../studio-core";
import { MEDIA_CATALOG } from "../media/catalog";
import { assertCloneAllowed, assertOwnClones, speechModelUnavailable } from "./media/voices";
import { audioModelUnavailable, prepareAudioRequest } from "./media/audio-inputs";
import { prepareMixRequest } from "./media/mix-sources";
import { prepareAvatarRequest } from "./media/avatar-audio";
import { prepareSpeechToolRequest, speechToolUnavailable } from "./media/speech-sources";

/**
 * The paid-generation pipeline behind `POST /api/generations`, shared with the AI chat's confirmation.
 *
 * Everything after the request is parsed and the form values are sanitized lives here, in the same order as
 * before the move: voice / translation normalization, required fields, preflight, idempotent replay, image
 * model and portrait checks, mandatory channels, the offer gate, the admin pause, the SERVER price (and the
 * client's `expectedPrice` guard), then `enqueueGeneration` (charge + queue in one transaction). The caller
 * only authenticates, rate limits and sanitizes. Errors are `ApiError`s (400/402/403/409/422/503); the one
 * non-error refusal is the queue admission (`kind: "admission"`, an HTTP 429 with `Retry-After`).
 */

export type SubmitInput = {
  userId: string;
  tool: ToolConfig;
  /** Already passed through `sanitizeValues`. */
  values: FormValues;
  idempotencyKey?: string;
  /** The price the caller displayed; a different server price is a 409 `price_changed`. */
  expectedPrice?: number;
};

export type SubmitResult =
  | { kind: "queued"; id: string; price: number; replayed: boolean }
  | { kind: "admission"; error: string; code: string; retryAfterSec: number };

/** What `prepareGeneration` decided; nothing is charged or queued yet. */
export type PreparedGeneration = {
  /** The key is already one of this user's jobs: the enqueue answers with it (the gates below were skipped for it). */
  replay: boolean;
  /** The SERVER price (base formula + `tool_pricing`), already checked against `expectedPrice`. */
  price: number;
  topic: string;
  budgetMs: number;
};

export async function submitGeneration(input: SubmitInput): Promise<SubmitResult> {
  const { userId, tool, values, idempotencyKey } = input;
  const { price, topic, budgetMs } = await prepareGeneration(input);

  const result = await enqueueGeneration({
    idempotencyKey,
    userId: userId,
    toolId: tool.id,
    topic,
    price,
    format: tool.output,
    values,
    budgetMs,
    /*
     * Qabul qarori (C22, `audit/designs/capacity.md`) — tranzaksiya ichida,
     * PUL YECHISHDAN OLDIN: foydalanuvchida QUEUED+IN_PROGRESS ≥
     * `queue.user_max_inflight` yoki navbatdagi kutish > `queue.max_wait_sec` (Sozlamalar)
     * bo'lsa 429 — pul ham, qator ham yo'q.
     */
    admission: await queueLimits(),
    // Bonus so'm cannot pay for video (program-17 D5): only the paid balance is charged.
    paidOnly: isPaidOnlyTool(tool.id),
  });

  if (!result.ok && result.reason === "idempotency_conflict") {
    throw new ApiError("Bu Idempotency-Key boshqa so'rov uchun ishlatilgan — yangi kalit bilan yuboring", 422);
  }
  if (!result.ok && result.reason === "admission") {
    const { code, retryAfterSec, error } = result.decision;
    return { kind: "admission", error, code, retryAfterSec };
  }
  if (!result.ok) throw insufficientError(result);

  return { kind: "queued", id: result.id, price: result.price, replayed: result.replayed };
}

/** The 402 of a balance below the price (`paidOnly`: the video wording — bonus so'm never pays for video). */
export function insufficientError(r: { required: number; available: number; paidOnly?: true; bonus?: number }): ApiError {
  if (r.paidOnly) {
    const bonusNote = r.bonus ? ` Bonus so'mingiz (${r.bonus.toLocaleString("uz-UZ")}) video uchun ishlamaydi.` : "";
    return new ApiError(
      `Video faqat to'langan balans bilan yaratiladi. Kerak: ${r.required.toLocaleString("uz-UZ")} so'm, to'langan balansingizda: ${r.available.toLocaleString("uz-UZ")} so'm.${bonusNote} Balansni to'ldiring: /uz/wallet`,
      402,
      { required: r.required, available: r.available, bonus: r.bonus ?? 0, code: "paid_balance_required", topUp: "/uz/wallet" },
    );
  }
  return new ApiError(
    `Balans yetarli emas. Kerak: ${r.required.toLocaleString("uz-UZ")} so'm, mavjud: ${r.available.toLocaleString("uz-UZ")}.`,
    402,
    { required: r.required, available: r.available },
  );
}

/**
 * Every check of the pipeline up to and including the price guard — nothing is charged or queued. `submitGeneration`
 * enqueues its answer; the Studio compare batch (`studio-compare.ts`) runs it for EVERY model before charging any.
 */
export async function prepareGeneration(input: SubmitInput): Promise<PreparedGeneration> {
  const { userId, tool, values, idempotencyKey, expectedPrice } = input;
  /*
   * Podcast / greeting voice choice: `female` | `male`. A missing field (an old cached
   * client) or an unknown value becomes `female` — the audio params normalize, never
   * reject (like `mode`, `podcastType`, `durationMin`). The NORMALIZED value is what the
   * job stores in `values_json`, so the worker and a later look at the job agree on
   * which voice was asked for.
   */
  if (isAudioToolId(tool.id)) {
    values.voice = normalizeVoiceChoice(values.voice);
    values.voiceProvider = normalizeVoiceProvider(values.voiceProvider);
  }

  /*
   * Tarjima hajmi — SERVERDA aniqlanadi (Tarjimon 2, WP1).
   *
   * Narx endi hajmga bog'liq, ya'ni `sourceChars` PUL maydoni. Klient
   * uni yuborishi mumkin (formada narxni ko'rsatish uchun), lekin bu
   * yerda U USTIDAN YOZILADI:
   *
   *   fayl rejimi — `source_uploads.chars` (yuklashda o'lchangan);
   *   matn rejimi — `sourceText` ning haqiqiy uzunligi.
   *
   * Aks holda 200 000 belgilik hujjatni `sourceChars: 1` bilan yuborib,
   * 3 000 tangaga tarjima qildirish mumkin bo'lardi.
   */
  if (tool.id === "translation") {
    const assetId = typeof values.sourceAssetId === "string" ? values.sourceAssetId.trim() : "";
    if (assetId) {
      const row = /^[0-9a-f]{24}$/i.test(assetId)
        ? await sourceCharsForRequest(userId, assetId)
        : null;
      // Qator yo'q — eski/o'chirilgan/begona `assetId`. Bu YIQILISH emas,
      // aniq ko'rsatma: forma faylni qayta yuklaydi.
      if (!row) throw new ApiError("Yuklangan fayl topilmadi — qayta yuklang", 400);
      // Matn bazada — so'rov tanasida takrorlanmaydi (200 000 belgi
      // JSON'da 400 KB+ bo'lardi va har generatsiyada qayta yuborilardi).
      values.sourceText = "";
      values.sourceChars = row.chars;
      values.fileName = row.name;
      values.sourceKind = row.kind;
    } else {
      values.sourceChars = String(values.sourceText ?? "").length;
      // Matn rejimida bu ikkisi ma'nosiz — qolib ketsa `priceFor` va
      // dvigatel «fayl bor» deb o'ylardi.
      delete values.sourceKind;
      delete values.sourceAssetId;
    }
  }

  /**
   * Majburiy maydonlar SERVERDA tekshiriladi.
   *
   * Ilgari tekshiruv faqat formada edi: to'g'ridan-to'g'ri yuborilgan
   * so'rov universitetsiz yoki mavzusiz o'tib ketardi, ish navbatga
   * tushardi va puli yechilardi — natija esa yaroqsiz hujjat bo'lardi.
   */
  const missing = missingRequired(tool, values);
  if (missing.length) {
    throw new ApiError(`To'ldirilmagan maydon: ${missing.join(", ")}`, 400, { missing });
  }

  // «To'ldirilgan, lekin biz uddalay olmaymiz» — pul yechilishidan oldin.
  const blocked = preflightError(tool, values);
  if (blocked) throw new ApiError(blocked, 400);

  /*
   * Idempotent replay (docs/admin/02-plan.md §17.2). A retry of a request
   * whose response was lost carries the same Idempotency-Key and the same
   * form, but its `expectedPrice` may be stale (an admin changed the price
   * in between, or the client re-rendered with fresh pricing), and the
   * service may have been paused since. `enqueueGeneration` answers such a
   * request with the ORIGINAL job and charges nothing, so the pause and the
   * price guard below must not run for it: a 409/503 here would hide a job
   * the user already paid for, and the "confirm the new price" retry (a new
   * key) would buy it a second time. When the key is already taken the
   * request cannot create or charge anything: `enqueueGeneration` either
   * replays (same tool and values) or rejects with 422 (different ones).
   */
  const replay = idempotencyKey ? await idempotencyKeyTaken(userId, idempotencyKey) : false;

  /*
   * `rasm` model choice (program-17 item 5): the chosen model's provider must be enabled AND keyed RIGHT NOW --
   * checked again here, whatever the form offered (a stale page, a direct POST). 400 before anything is priced
   * or charged. A replay is a job that already exists; it is answered, not re-checked.
   */
  if (tool.id === "image" && !replay) {
    await ensureProviderKeys();
    const unavailable = imageModelUnavailable(values);
    if (unavailable) throw new ApiError(unavailable, 400);
  }

  /*
   * Premium voice (podcast / greeting): the provider must be enabled AND keyed RIGHT NOW -- 400 before anything is priced or
   * charged, whatever the form offered (a stale page, a direct POST). A replay is a job that already exists.
   */
  if (isAudioToolId(tool.id) && !replay) {
    await ensureProviderKeys();
    const unavailable = voiceProviderUnavailable(values);
    if (unavailable) throw new ApiError(unavailable, 400);
  }

  /*
   * Video: the tool switch, the provider (enabled AND keyed RIGHT NOW) and the start image (the user's own upload) are
   * checked before anything is priced or charged. A replay is a job that already exists.
   */
  if (tool.id === "video" && !replay) {
    // Ships DARK: `video.enabled` defaults to false, so a deploy with a keyed provider (prod has a Gemini key) offers nothing until the owner switches it on.
    if (!(await getSetting("video.enabled"))) throw new ApiError("Video yaratish hozircha mavjud emas.", 400, { code: "video_disabled" });
    await ensureProviderKeys();
    const unavailable = videoProviderUnavailable(values);
    if (unavailable) throw new ApiError(unavailable, 400);
    const image = videoInputFromValues(values).imageAssetId;
    if (image && !(await photoExists(userId, image))) throw new ApiError("Boshlang'ich surat topilmadi — suratni qayta yuklang", 400);
  }

  /*
   * Studio pictures (docs/studio/P1-SPEC.md): the chosen catalog model must be sold by the Studio AND available RIGHT
   * NOW (provider on + keyed + not switched off by the admin) — the same function the catalog endpoint lists with.
   * 400 before anything is priced or charged; a replay is a job that already exists.
   */
  if (tool.id === "studio-image" && !replay) {
    // P2b: an edit / upscale / background-removal model is checked against ITS purpose (docs/studio/P2B-SPEC.md).
    const modelId = studioModelOf(values);
    const unavailable = await modelUnavailable(studioPurposeOf(modelId) ?? STUDIO_IMAGE_PURPOSE, modelId);
    if (unavailable) throw new ApiError(unavailable, 400, { code: "model_unavailable" });
    // The input pictures must be the user's own (SQL), of the right type / size, before anything is charged.
    const inputs = await studioInputsError(userId, values);
    if (inputs) throw new ApiError(inputs, 400, { code: "input_invalid" });
  }

  /*
   * Studio clips (docs/studio/P3-SPEC.md): the paid-video switch `video.enabled` (one switch with «Video»), then the
   * chosen model must be sold by the Video tab AND available RIGHT NOW (provider on + keyed + not switched off in «Media
   * modellari»), and the start / effect photo must be the user's own upload. 400 before anything is priced or charged.
   */
  if (tool.id === "studio-video" && !replay) {
    if (!(await getSetting("video.enabled"))) throw new ApiError("Video yaratish hozircha mavjud emas.", 400, { code: "video_disabled" });
    const modelId = studioVideoModelOf(values);
    const unavailable = await modelUnavailable(STUDIO_VIDEO_PURPOSE, modelId);
    if (unavailable) throw new ApiError(unavailable, 400, { code: "model_unavailable" });
    const entry = MEDIA_CATALOG.byId(modelId)!;
    // Every photo the job sends (start, P4 end frame, the second photo of a two-photo effect): the user's own (SQL).
    const params = normalize(entry.params, values);
    for (const name of studioVideoImageParams(entry, values)) {
      const ids = params[name];
      const imageId = Array.isArray(ids) ? ids[0] : undefined;
      if (imageId && !(await photoExists(userId, imageId))) throw new ApiError("Surat topilmadi — suratni qayta yuklang", 400);
    }
    // P4 review N2: the Rasm tab's input checks (type, per-photo size, the job's total) before anything is charged.
    const inputs = await studioVideoInputsError(userId, entry, values, studioVideoImageParams(entry, values));
    if (inputs) throw new ApiError(inputs, 400, { code: "input_invalid" });
    // P9 HeyGen avatar: the own speech is the user's own finished result (SQL); `seconds` is set from the script / the
    // speech before pricing, never taken from the request (docs/studio/P9-HEYGEN.md).
    await prepareAvatarRequest(userId, values);
  }

  /*
   * Studio «Ovoz» (docs/studio/P5-SPEC.md): the tab's switch + the model available now, and every clone voice the
   * request names must be the user's own ready clone (SQL) — 400 before anything is priced or charged. The voice clone:
   * the tab / ElevenLabs on, the sample is the user's own (with its recorded consent), no active clone, a free voice slot
   * at ElevenLabs. A replay is a job that already exists.
   */
  if (tool.id === "studio-speech" && !replay) {
    const unavailable = await speechModelUnavailable(values);
    if (unavailable) throw new ApiError(unavailable, 400, { code: "model_unavailable" });
    await assertOwnClones(userId, values);
  }
  if (tool.id === "studio-voice" && !replay) await assertCloneAllowed(userId, values);

  /*
   * Studio «Audio» (docs/studio/P6-SPEC.md): the tab's switch + the mode's model available now; the voice changer /
   * isolator input must be the user's own upload, and its SERVER-measured billed seconds replace the request's
   * `inputSeconds` before pricing (the translation `sourceChars` rule: the price follows the file, never the client);
   * a clone voice must be the user's own ready clone. 400 before anything is priced or charged. A replay is a job that
   * already exists (its values were overwritten the same way when it was bought).
   */
  if (tool.id === "studio-audio" && !replay) {
    const unavailable = await audioModelUnavailable(values);
    if (unavailable) throw new ApiError(unavailable, 400, { code: "model_unavailable" });
    await prepareAudioRequest(userId, values);
  }

  /*
   * Studio «Montaj» (docs/studio/P8-SPEC.md «P8c»): both picked results must be the user's OWN finished generations of
   * the right kind (SQL), within the length limits (video ≤ 3 min, audio ≤ 10 min), the start offset inside the video —
   * 400 before anything is priced or charged. A replay is a job that already exists.
   */
  if (tool.id === "studio-mix" && !replay) await prepareMixRequest(userId, values);

  /*
   * Studio P10 «Transkripsiya» / «Dublyaj» (docs/studio/P10-SPEC.md): the tool's switch (default off) + ElevenLabs
   * available now; the source must be the user's OWN upload / finished result of a kind the tool takes, within its
   * length limit, a burn / a video dub must fit 25 MB — and the SERVER's billed seconds replace the request's
   * `sourceSeconds` before pricing. 400 before anything is priced or charged. A replay is a job that already exists.
   */
  if ((tool.id === "studio-transcribe" || tool.id === "studio-dub") && !replay) {
    const unavailable = await speechToolUnavailable(tool.id);
    if (unavailable) throw new ApiError(unavailable, 400, { code: "model_unavailable" });
    await prepareSpeechToolRequest(userId, tool.id, values);
  }

  // Graduation portrait: the selfie must exist and be the user's own BEFORE anything is priced or charged.
  // (A replay is a job already created; its selfie may be deleted by now.)
  if (tool.id === "portrait" && !replay && !(await photoExists(userId, portraitInputFromValues(values).photoAssetId))) {
    throw new ApiError("Surat topilmadi — suratni qayta yuklang", 400);
  }

  /*
   * Mandatory channels (docs/bonus/BONUS3.md C-Q2/C-Q3): 403 `channel_required` /
   * `telegram_required` before anything is priced, charged or queued. A replay is a job the
   * user already created (and paid for) — it is answered, never blocked. Users with an admin
   * account are exempt (`mandatory-channels.ts`).
   */
  if (!replay) await assertCanCreate(userId);

  // Public offer (D6): 403 `offer_required` until the user accepts the current version (gate off = no-op; admins exempt).
  if (!replay) await assertOfferAccepted(userId);

  // Admin pause (§6.10): checked before pricing and charging, so nothing is charged or queued.
  if (!replay) await assertGenerationOpen(tool.id);

  // Base formula + admin adjustment (`tool_pricing`, 15 s cache); never the client's number.
  const price = await effectivePrice(tool, values);

  /*
   * No silent charge mismatch (§17.2, §17.8): the client sends the price it
   * displayed. If ours differs, refuse BEFORE any charge or enqueue and tell
   * the client the new price; it asks the user to confirm and retries with a
   * new key. Absent `expectedPrice` (an old cached client) = old behavior.
   */
  if (!replay && expectedPrice !== undefined && expectedPrice !== price) {
    throw new ApiError(`Narx o'zgardi. Yangi narx: ${price.toLocaleString("uz-UZ")} so'm.`, 409, {
      code: "price_changed",
      price,
    });
  }

  const topic = topicOf(values, tool);
  // Byudjet ish HAJMIDAN hisoblanadi: 1 varaqlik insho 285 s lik
  // slotni band qilmasin, 45 betlik kurs ishi esa unga sig'may
  // yiqilmasin. `WORKER_JOB_TIMEOUT_MS` yuqori chegara bo'lib qoladi.
  return { replay, price, topic, budgetMs: budgetFor(tool, values, env.worker.jobTimeoutMs) };
}

/** 503 when an admin paused all generations or this tool (§6.10). Settings reads never throw. */
async function assertGenerationOpen(toolId: ToolId): Promise<void> {
  const [paused, pausedTools] = await Promise.all([getSetting("generation.paused"), getSetting("generation.paused_tools")]);
  if (paused || pausedTools.includes(toolId)) {
    throw new ApiError("Xizmat vaqtincha to'xtatilgan. Birozdan keyin urinib ko'ring.", 503, { code: "paused" });
  }
}

/**
 * Whether this user already has a job under `key` that `enqueueGeneration`
 * will find (its lookup window is IDEMPOTENCY_WINDOW_HOURS). The window here
 * is 5 minutes SHORTER on purpose: a key about to expire counts as free, so
 * a "taken" answer cannot turn into a new, unguarded charge a moment later
 * at enqueue time. A concurrent first request that has not committed yet is
 * not seen; that request is a new purchase and is guarded like any other.
 */
async function idempotencyKeyTaken(userId: string, key: string): Promise<boolean> {
  const row = await queryOne<{ taken: number }>(
    `SELECT 1 AS taken FROM generations
      WHERE user_id = $1 AND idempotency_key = $2
        AND created_at >= now() - $3::int * interval '1 hour' + interval '5 minutes'
      LIMIT 1`,
    [userId, key, IDEMPOTENCY_WINDOW_HOURS],
  );
  return row !== null;
}
