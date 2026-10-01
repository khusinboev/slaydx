import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { budgetFor } from "@/lib/generation/budget";
import { clampListLimit, decodeCursor, enqueueGeneration, IDEMPOTENCY_WINDOW_HOURS, listGenerations } from "@/lib/server/jobs";
import { sanitizeValues } from "@/lib/server/validate";
import { sourceCharsForRequest } from "@/lib/server/source-upload";
import { missingRequired, preflightError, TOOL_BY_SLUG, topicOf } from "@/lib/tools";
import { startInlineWorker } from "@/lib/server/worker";
import { env } from "@/lib/server/env";
import { queryOne } from "@/lib/server/db";
import { effectivePrice } from "@/lib/server/pricing";
import { getSetting } from "@/lib/server/settings";
import type { ToolId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Foydalanuvchining o'z generatsiyalari. Boshqa userniki chiqmaydi.
 *
 * Kursor bilan sahifalash (BEA-06, FE-08): `?limit=1..100` (standart 50)
 * va `?cursor=<oldingi javobdagi nextCursor>`. Javob kaliti `generations`
 * o'zgarmagan, qo'shimcha `nextCursor` (`null` — oxirgi sahifa).
 */
export const GET = handler("generations/list", async (req) => {
  const { user } = await requireUser(req);
  const params = new URL(req.url).searchParams;
  const rawCursor = params.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) throw new ApiError("Noto'g'ri kursor", 400);
  const { items, nextCursor } = await listGenerations(user.id, {
    limit: clampListLimit(params.get("limit")),
    cursor,
  });
  return json({ generations: items, nextCursor });
});

/**
 * Yangi generatsiyani navbatga qo'yadi.
 *
 * Muhim farqlar (ilgari `/api/generate` shu ishni qilardi):
 *   - kirish talab qilinadi — anonim so'rov pullik LLM ni chaqira olmaydi,
 *   - narx **serverda** hisoblanadi — klient yuborgan `price` e'tiborsiz,
 *   - pul yechish va navbatga qo'yish bitta tranzaksiyada,
 *   - hujjat HTTP ichida emas, worker da yaratiladi (timeout yo'q).
 */
export const POST = handler("generations/create", async (req) => {
  const { user } = await requireUser(req);

  // Ikki qatlam: qisqa portlash va soatlik umumiy chegara.
  await limit(`gen:burst:${user.id}`, 5, 60);
  await limit(`gen:hour:${user.id}`, 60, 3600);

  // Takroriy yuborish (javob yo'qolgan) ikkinchi marta pul yechmasin (C34).
  const idempotencyKey = readIdempotencyKey(req);

  /*
   * 1 200 000 bayt: tarjima chegarasi 200 000 BELGI, kirill/o'zbek matni
   * UTF-8 da belgisiga ~2 bayt, JSON qochirish (`\n`, `\"`) esa ustiga
   * qo'shadi — 400 000 bayt oldin 200 000 belgilik matnni «So'rov hajmi
   * juda katta» deb rad etardi.
   */
  const body = await readJson<{ slug?: unknown; values?: unknown; expectedPrice?: unknown }>(req, 1_200_000);
  const expectedPrice = readExpectedPrice(body.expectedPrice);
  const slug = typeof body.slug === "string" ? body.slug : "";
  const tool = slug ? TOOL_BY_SLUG[slug] : undefined;
  if (!tool) throw new ApiError("Noma'lum vosita", 400);

  const values = sanitizeValues(body.values);
  if (!values) throw new ApiError("Forma qiymatlari noto'g'ri", 400);

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
        ? await sourceCharsForRequest(user.id, assetId)
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
  const replay = idempotencyKey ? await idempotencyKeyTaken(user.id, idempotencyKey) : false;

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
    throw new ApiError(`Narx o'zgardi. Yangi narx: ${price.toLocaleString("uz-UZ")} tanga.`, 409, {
      code: "price_changed",
      price,
    });
  }

  const topic = topicOf(values, tool);

  const result = await enqueueGeneration({
    idempotencyKey,
    userId: user.id,
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
     * `USER_MAX_INFLIGHT` yoki navbatdagi kutish > `QUEUE_MAX_WAIT_SEC`
     * bo'lsa 429 — pul ham, qator ham yo'q.
     */
    admission: env.queue,
  });

  if (!result.ok && result.reason === "idempotency_conflict") {
    throw new ApiError("Bu Idempotency-Key boshqa so'rov uchun ishlatilgan — yangi kalit bilan yuboring", 422);
  }
  if (!result.ok && result.reason === "admission") {
    const { code, retryAfterSec, error } = result.decision;
    return json(
      { error, code, retryAfterSec },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }
  if (!result.ok) {
    throw new ApiError(
      `Balans yetarli emas. Kerak: ${result.required.toLocaleString("uz-UZ")} tanga, mavjud: ${result.available.toLocaleString("uz-UZ")}.`,
      402,
      { required: result.required, available: result.available },
    );
  }

  // Inline rejimda worker shu processda ishlaydi — birinchi so'rovda uyg'otamiz.
  if (env.worker.inline) startInlineWorker();

  /*
   * Takror (shu kalit bilan avval yaratilgan ish) — ASL javob bilan AYNAN bir
   * xil: o'sha id, o'sha (yechilgan) narx, o'sha status kodi. Klient javobni
   * yo'qotib qayta yuborganini bilmasligi ham mumkin — farq faqat sarlavhada.
   */
  return json(
    { id: result.id, price: result.price, status: "QUEUED" },
    { status: 202, headers: result.replayed ? { "Idempotent-Replayed": "true" } : undefined },
  );
});

/**
 * Optional `expectedPrice` (the price the client displayed). Absent: `undefined`;
 * present but not a non-negative safe integer: 400.
 */
function readExpectedPrice(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    throw new ApiError("Kutilgan narx noto'g'ri", 400);
  }
  return raw;
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

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `Idempotency-Key` sarlavhasi (C34, klient shartnomasi: UUID v4). Yo'q —
 * `undefined` (eski xatti-harakat). Bor, lekin UUID emas — 400: noto'g'ri
 * kalitni jim e'tiborsiz qoldirish klientni «himoyalangan» deb aldardi.
 * Katta-kichik harf farq qilmaydi (bazada kichik harfda).
 */
function readIdempotencyKey(req: Request): string | undefined {
  const raw = req.headers.get("idempotency-key");
  if (raw === null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new ApiError("Idempotency-Key UUID bo'lishi kerak", 400);
  return key;
}
