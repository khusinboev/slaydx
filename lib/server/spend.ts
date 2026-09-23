import "server-only";
import { ApiError } from "./api";
import { queryOne, transaction } from "./db";
import { env } from "./env";
import { rateLimit, windowStartOf, type RateOptions } from "./ratelimit";
import { complete as completeRole } from "../generation/llm-roles";

/**
 * BEPUL LLM endpointlari — sarf siyosati (prod-readiness C10: EXT-02,
 * ABUSE-01, CONC-11, CONC-13, SCALE-14, BEA-11).
 *
 * Reja (`/api/outline`), UDK taklifi, «Tuzatish» (`…/rewrite`) va
 * «Hammasini tuzatish» (`…/polish`) kredit yechmaydi. Ilgari ularni faqat
 * qisqa oynali chegara to'sardi: bitta bepul akkaunt (3 000 bonus ball bilan
 * 2 000 lik kartochka to'plami → «Tuzatish» ochiladi) kuniga ≈ $50–100
 * provayder pulini yoqa olardi, N akkaunt — N barobar; global shift ham,
 * o'chirish tugmasi ham yo'q edi, limitlagich esa baza xatosida OCHIQ edi.
 * Gemini kvotasi tugasa esa PULLIK generatsiya ham hamma uchun yiqilardi.
 *
 * Egasi qarori (2026-09-23) — hammasi shu modulda, route lar yupqa:
 *   1. har endpoint uchun foydalanuvchi bo'yicha KUNLIK chegara (env),
 *      kun Toshkent vaqti bilan (UTC+5) almashadi; eski qisqa oynali
 *      chegaralar ham qoladi;
 *   2. barcha foydalanuvchilar bo'yicha GLOBAL kunlik chegara (vazn bilan)
 *      → 503, pullik generatsiyaga tegmaydi;
 *   3. `FREE_LLM_DISABLED=true` → darhol 503, provayder chaqirilmaydi;
 *   4. «Tuzatish»/«Hammasini tuzatish» faqat PUL bilan (balans yoki Pro
 *      kvota) to'langan hujjatda — faqat bonus ball bilan to'langanda 402;
 *   5. bu chelaklar baza xatosida YOPIQ (503) — `rateLimit` ning
 *      umumiy ochiq xulqi boshqa chaqiruvchilar uchun o'zgarmaydi;
 *   6. bitta hujjatda bir vaqtda bitta AI tahrir (409 `busy`), mijoz
 *      uzilsa keyingi provayder chaqiruvlari qilinmaydi.
 *
 * Tartib (BEA-11): o'chirish tugmasi → hujjat egaligi/to'lovi/versiyasi →
 * chelaklar → bitta-parvoz qulfi → LLM. Ya'ni begona foydalanuvchi yoki
 * eskirgan tab egasining kunlik hisobini yemaydi.
 */

export type FreeLlmEndpoint = "outline" | "udk" | "rewrite" | "polish";

export type FreeLlmPolicy = {
  disabled: boolean;
  /** Foydalanuvchi bo'yicha kunlik urinish (Toshkent kuni). */
  daily: Record<FreeLlmEndpoint, number>;
  /** Barcha foydalanuvchilar bo'yicha kunlik birlik (`FREE_LLM_WEIGHT` bilan). */
  globalDaily: number;
};

export const FREE_LLM_DEFAULTS: FreeLlmPolicy = {
  disabled: false,
  daily: { outline: 20, udk: 20, rewrite: 30, polish: 10 },
  globalDaily: 20_000,
};

/** Env dagi siyosat (`FREE_LLM_*`, `lib/server/env.ts`). */
export function freeLlmPolicy(): FreeLlmPolicy {
  const f = env.freeLlm;
  return {
    disabled: f.disabled,
    daily: { outline: f.dailyOutline, udk: f.dailyUdk, rewrite: f.dailyRewrite, polish: f.dailyPolish },
    globalDaily: f.dailyGlobal,
  };
}

/**
 * Global hisobdagi vazn — endpointning ENG KO'P provayder chaqiruvi:
 * reja 1–2 (`buildOutline` qayta urinish bilan), UDK 1, «Tuzatish» 1,
 * «Hammasini tuzatish» ≤6 yozuvchi + 1 baholovchi. Shunda global shift
 * so'rov soni emas, chaqiruvlar soniga yaqin.
 */
export const FREE_LLM_WEIGHT: Record<FreeLlmEndpoint, number> = { outline: 2, udk: 1, rewrite: 1, polish: 7 };

/**
 * Qisqa oynali chegaralar — o'zgarmadi (chelak nomlari ham eskisi, ya'ni
 * deploy paytidagi hisob yo'qolmaydi). «Hammasini tuzatish» da qisqa oyna
 * yo'q edi — uning o'rnida hujjat bo'yicha kunlik chegara.
 */
export const FREE_LLM_BURST: Partial<Record<FreeLlmEndpoint, { count: number; windowSec: number }>> = {
  outline: { count: 12, windowSec: 600 },
  udk: { count: 30, windowSec: 3600 },
  rewrite: { count: 20, windowSec: 600 },
};

/** «Hammasini tuzatish» — bitta hujjatga kuniga (AUDIT-18 Q-1). */
export const POLISH_PER_DOC_DAILY = 3;

/**
 * Bitta-parvoz qulfining muddati (s) — route ning `maxDuration` idan
 * katta: jarayon yiqilib qulf bo'shatilmasa ham, shundan keyin o'z-o'zidan
 * eskiradi.
 */
const LEASE_TTL_SEC: Record<"rewrite" | "polish", number> = { rewrite: 90, polish: 180 };

/** Toshkent: UTC+5, yozgi vaqt yo'q. */
export const TASHKENT_UTC_OFFSET_SEC = 5 * 3600;
const DAY_SEC = 86_400;

/** Toshkent kunining boshlanishi (UTC instant) — kunlik chelaklar kaliti. */
export function tashkentDayStart(nowMs: number): Date {
  return windowStartOf(nowMs, DAY_SEC, TASHKENT_UTC_OFFSET_SEC);
}

const DISABLED_TEXT = "Bepul AI yordamchi vaqtincha o'chirilgan. Pullik generatsiya odatdagidek ishlaydi.";
const GLOBAL_TEXT =
  "Bepul AI yordamchining bugungi umumiy chegarasi tugadi — ertaga (Toshkent vaqti bilan 00:00 dan keyin) qayta urinib ko'ring. Pullik generatsiya odatdagidek ishlaydi.";
const DB_TEXT = "Xizmat hozir band — birozdan keyin qayta urinib ko'ring.";
const UNPAID_TEXT =
  "AI tahrir faqat pul bilan (balans yoki Pro obuna) to'langan hujjatlarda ishlaydi. Bu hujjat bonus ballar hisobidan yaratilgan — bonus AI tahrirni qoplamaydi.";
const BUSY_TEXT = "Bu hujjat ustida AI tahrir allaqachon ketmoqda — tugashini kuting.";

/** O'chirish tugmasi — route boshida, bazadan ham OLDIN. */
export function assertFreeLlmEnabled(policy: FreeLlmPolicy = freeLlmPolicy()): void {
  if (policy.disabled) throw new ApiError(DISABLED_TEXT, 503, { code: "disabled" });
}

export type FreeLlmRequest = {
  endpoint: FreeLlmEndpoint;
  userId: string;
  /** rewrite/polish — hujjat va klient ko'rgan versiya. */
  doc?: { id: string; baseVersion: number };
  /** `req.signal` — mijoz uzilsa keyingi LLM chaqiruvlari qilinmaydi. */
  signal?: AbortSignal;
};

export type FreeLlmDeps = {
  policy?: FreeLlmPolicy;
  /** Test seam — `Date.now()` o'rniga (kunlik chelaklar). */
  now?: number;
  /** Test seam — chelak nomlari oldidan (testlar bir-birining hisobini ko'rmasin). */
  bucketPrefix?: string;
  /** Test seam — rol bo'yicha LLM (standart `llm-roles.complete`). */
  complete?: typeof completeRole;
};

/**
 * Bepul LLM ishini siyosat ostida bajaradi. `run` ga uzilishni sezuvchi
 * `complete` beriladi — route uni dvigatelga (`deps.complete`) uzatadi.
 */
export async function withFreeLlm<T>(
  r: FreeLlmRequest,
  run: (complete: typeof completeRole) => Promise<T>,
  deps: FreeLlmDeps = {},
): Promise<T> {
  const policy = deps.policy ?? freeLlmPolicy();
  assertFreeLlmEnabled(policy);
  const now = deps.now ?? Date.now();
  const pre = deps.bucketPrefix ?? "";
  const { endpoint, userId, doc } = r;

  if ((endpoint === "rewrite" || endpoint === "polish") && !doc) throw new Error(`withFreeLlm: ${endpoint} hujjatsiz chaqirildi`);
  if (doc) await assertPaidDocument(doc.id, userId, doc.baseVersion);

  const burst = FREE_LLM_BURST[endpoint];
  if (burst) await hit(`${pre}${endpoint}:${userId}`, burst.count, burst.windowSec, {}, "burst");
  const day: RateOptions = { offsetSec: TASHKENT_UTC_OFFSET_SEC, now };
  await hit(`${pre}free-llm:${endpoint}:day:${userId}`, policy.daily[endpoint], DAY_SEC, day, "daily");
  if (endpoint === "polish" && doc) {
    await hit(`${pre}polish:${userId}:${doc.id}`, POLISH_PER_DOC_DAILY, DAY_SEC, day, "doc");
  }
  await hit(`${pre}free-llm:global:day`, policy.globalDaily, DAY_SEC, { ...day, weight: FREE_LLM_WEIGHT[endpoint] }, "global");

  const complete = guardComplete(deps.complete ?? completeRole, r.signal);
  if (!doc) return run(complete);

  const key = `${pre}inflight:doc:${doc.id}`;
  const lease = await acquireLease(key, LEASE_TTL_SEC[endpoint as "rewrite" | "polish"]);
  if (!lease) throw new ApiError(BUSY_TEXT, 409, { code: "busy" });
  try {
    return await run(complete);
  } finally {
    await releaseLease(key, lease);
  }
}

/** Bitta chelak: chegara → 429 (global → 503), baza xatosi → 503 (YOPIQ). */
async function hit(bucket: string, count: number, windowSec: number, opts: RateOptions, kind: "burst" | "daily" | "doc" | "global") {
  const res = await rateLimit(bucket, count, windowSec, { ...opts, failClosed: true });
  if (res.ok) return;
  if (res.error) throw new ApiError(DB_TEXT, 503, { retryAfter: res.retryAfterSec });
  if (kind === "global") {
    console.warn("[free-llm] global kunlik chegara tugadi", { limit: count });
    throw new ApiError(GLOBAL_TEXT, 503, { code: "global", retryAfter: res.retryAfterSec });
  }
  const text =
    kind === "burst"
      ? `Juda ko'p so'rov. ${res.retryAfterSec} soniyadan keyin urinib ko'ring.`
      : kind === "doc"
        ? `Bu hujjat bugun ${count} marta sayqallandi — ertaga (Toshkent vaqti bilan 00:00 dan keyin) qayta urinib ko'ring.`
        : `Bugungi bepul chegara tugadi (${count} ta). Ertaga (Toshkent vaqti bilan 00:00 dan keyin) qayta urinib ko'ring.`;
  throw new ApiError(text, 429, { retryAfter: res.retryAfterSec });
}

/**
 * Hujjat egasiniki, tayyor, klient ko'rgan versiyada va PUL bilan
 * to'langanmi.
 *
 * «Pul bilan»: `charge` qatori (`reference` = generatsiya id)
 * `balance` yoki `quota` (Pro obuna — pullik) dan nimadir olgan va u
 * `refund` bilan to'liq qaytarilmagan. Faqat `points` (ro'yxatdan o'tish
 * bonusi) bilan to'langan hujjat — 402: bonus bitta hujjatga yetadi,
 * lekin cheksiz bepul AI tahrirni ochmasligi kerak. `charge` qatori
 * yo'q hujjat ham rad etiladi (xavfsiz standart).
 *
 * Versiya va holat bu yerda — chelaklardan OLDIN (BEA-11): eskirgan tab
 * kunlik hisobni yemasin. Dvigatel ularni baribir qayta tekshiradi.
 */
export async function assertPaidDocument(genId: string, userId: string, baseVersion: number): Promise<void> {
  let row: { status: string; doc_version: number; paid: string } | null;
  try {
    row = await queryOne<{ status: string; doc_version: number; paid: string }>(
      `SELECT g.status, g.doc_version,
              COALESCE((SELECT SUM(-(t.quota_delta + t.balance_delta)) FROM transactions t
                         WHERE t.kind = 'charge' AND t.reference = g.id::text AND t.user_id = g.user_id), 0)
            - COALESCE((SELECT SUM(t.quota_delta + t.balance_delta) FROM transactions t
                         WHERE t.kind = 'refund' AND t.reference = g.id::text AND t.user_id = g.user_id), 0) AS paid
         FROM generations g
        WHERE g.id = $1 AND g.user_id = $2`,
      [genId, userId],
    );
  } catch (e) {
    // Yopiq: tekshira olmasak LLM ga yo'l yo'q.
    console.error("[free-llm] to'lov tekshiruvi", e instanceof Error ? e.message : e);
    throw new ApiError(DB_TEXT, 503);
  }
  if (!row) throw new ApiError("Topilmadi", 404);
  if (row.status !== "COMPLETED") throw new ApiError("Hujjat hali tayyor emas", 409, { code: "status", status: row.status });
  if (baseVersion !== row.doc_version) {
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: row.doc_version });
  }
  if (!(Number(row.paid) > 0)) throw new ApiError(UNPAID_TEXT, 402, { code: "unpaid" });
}

/**
 * Mijoz uzilgach (`signal.aborted`) keyingi chaqiruvlar provayderga
 * bormaydi — `null` («model javob bermadi») qaytadi, dvigatellar buni
 * allaqachon kutadi. Ketayotgan chaqiruv to'xtatilmaydi: `llm-roles.complete`
 * `signal` qabul qilmaydi (u o'z timeout i bilan tugaydi).
 */
function guardComplete(complete: typeof completeRole, signal?: AbortSignal): typeof completeRole {
  if (!signal) return complete;
  return (async (...args: Parameters<typeof completeRole>) => (signal.aborted ? null : complete(...args))) as typeof completeRole;
}

/**
 * Bitta-parvoz qulfi (`rate_limits` qatori, `window_start` = olingan payt).
 *
 * `pg_advisory_lock` ni so'rov davomida ushlab turish hovuzdan bitta
 * ulanishni 2 daqiqagacha band qilardi (hovuz — 10). Bu yerda qisqa
 * tranzaksiya: xact-qulf ostida «tirik qulf bormi» tekshiriladi va qator
 * yoziladi; ish tugagach qator o'chiriladi. Jarayon yiqilsa qator
 * `ttlSec` dan keyin eskiradi va `purgeRateLimits` uni tozalaydi.
 */
async function acquireLease(key: string, ttlSec: number): Promise<Date | null> {
  const at = new Date();
  try {
    return await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('free-llm-lease'), hashtext($1))", [key]);
      await c.query("DELETE FROM rate_limits WHERE bucket = $1 AND window_start <= $2", [key, new Date(at.getTime() - ttlSec * 1000)]);
      const live = await c.query("SELECT 1 FROM rate_limits WHERE bucket = $1 LIMIT 1", [key]);
      if (live.rows[0]) return null;
      await c.query("INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, $2, 1)", [key, at]);
      return at;
    });
  } catch (e) {
    console.error("[free-llm] qulf", e instanceof Error ? e.message : e);
    throw new ApiError(DB_TEXT, 503);
  }
}

async function releaseLease(key: string, at: Date): Promise<void> {
  try {
    await queryOne("DELETE FROM rate_limits WHERE bucket = $1 AND window_start = $2", [key, at]);
  } catch (e) {
    // Bo'shatib bo'lmadi — qulf `ttlSec` dan keyin o'zi eskiradi.
    console.error("[free-llm] qulfni bo'shatish", e instanceof Error ? e.message : e);
  }
}
