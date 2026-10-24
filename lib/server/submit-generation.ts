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

export async function submitGeneration(input: SubmitInput): Promise<SubmitResult> {
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

  const result = await enqueueGeneration({
    idempotencyKey,
    userId: userId,
    toolId: tool.id,
    topic,
    price,
    format: tool.output,
    values,
    // Byudjet ish HAJMIDAN hisoblanadi: 1 varaqlik insho 285 s lik
    // slotni band qilmasin, 45 betlik kurs ishi esa unga sig'may
    // yiqilmasin. `WORKER_JOB_TIMEOUT_MS` yuqori chegara bo'lib qoladi.
    budgetMs: budgetFor(tool, values, env.worker.jobTimeoutMs),
    /*
     * Qabul qarori (C22, `audit/designs/capacity.md`) — tranzaksiya ichida,
     * PUL YECHISHDAN OLDIN: foydalanuvchida QUEUED+IN_PROGRESS ≥
     * `queue.user_max_inflight` yoki navbatdagi kutish > `queue.max_wait_sec` (Sozlamalar)
     * bo'lsa 429 — pul ham, qator ham yo'q.
     */
    admission: await queueLimits(),
    // Bonus so'm cannot pay for video (program-17 D5): only the paid balance is charged.
    paidOnly: tool.id === "video",
  });

  if (!result.ok && result.reason === "idempotency_conflict") {
    throw new ApiError("Bu Idempotency-Key boshqa so'rov uchun ishlatilgan — yangi kalit bilan yuboring", 422);
  }
  if (!result.ok && result.reason === "admission") {
    const { code, retryAfterSec, error } = result.decision;
    return { kind: "admission", error, code, retryAfterSec };
  }
  if (!result.ok && result.paidOnly) {
    const bonusNote = result.bonus ? ` Bonus so'mingiz (${result.bonus.toLocaleString("uz-UZ")}) video uchun ishlamaydi.` : "";
    throw new ApiError(
      `Video faqat to'langan balans bilan yaratiladi. Kerak: ${result.required.toLocaleString("uz-UZ")} so'm, to'langan balansingizda: ${result.available.toLocaleString("uz-UZ")} so'm.${bonusNote} Balansni to'ldiring: /uz/wallet`,
      402,
      { required: result.required, available: result.available, bonus: result.bonus ?? 0, code: "paid_balance_required", topUp: "/uz/wallet" },
    );
  }
  if (!result.ok) {
    throw new ApiError(
      `Balans yetarli emas. Kerak: ${result.required.toLocaleString("uz-UZ")} so'm, mavjud: ${result.available.toLocaleString("uz-UZ")}.`,
      402,
      { required: result.required, available: result.available },
    );
  }

  return { kind: "queued", id: result.id, price: result.price, replayed: result.replayed };
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
