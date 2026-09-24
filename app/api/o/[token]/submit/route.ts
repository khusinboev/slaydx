import { randomUUID } from "node:crypto";
import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { clientIp } from "@/lib/server/ratelimit";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import {
  addResult,
  getGameSessionByToken,
  ipHash,
  PLAYER_NAME_MAX,
  ResultCapError,
  SUBMISSION_ID_RE,
  TOKEN_RE,
} from "@/lib/server/game-sessions";
import { scoreAnswers, scorePercent, type PlayerAnswers } from "@/lib/game/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Bitta o'yin + bitta IP dan daqiqada shuncha natija (C29): ikki sinf bitta
 * maktab IP sida ham sig'adi. IP shipi (`IP_LIMITS.submitPerIp`) — barcha
 * o'yinlar bo'yicha toshqin chegarasi. Ilgari barcha o'yinlar uchun 30/IP
 * edi — 31-o'quvchi 429 olardi.
 */
export const SUBMIT_PER_MINUTE = IP_LIMITS.submitPerGamePerIp.count;

/**
 * O'YIN NATIJASINI QABUL QILADI (loginsiz) — egasi qarori 8.
 *
 * BALL SERVERDA hisoblanadi (`scoreAnswers`): klient yuborgan har
 * qanday `score` E'TIBORSIZ qoladi. Aks holda natijalar jadvali
 * o'quvchi yozgan songa aylanardi — narx serverda hisoblanishi bilan
 * bir xil sabab (CLAUDE.md).
 *
 * Himoyalar: `checkOrigin` (CSRF — so'rov bizning sahifamizdan),
 * `rateLimit` IP bo'yicha, ism uzunligi, token shakli.
 *
 * IDEMPOTENT (C36 UX-06/ABUSE-04): klient `submissionId` (`crypto.randomUUID()`,
 * bitta urinish uchun BIR MARTA) yuboradi. Tarmoq uzilib javob kelmay
 * qolsa-yu, server aslida yozib ulgurgan bo'lsa, "Qayta yuborish" AYNI
 * id bilan qayta so'raydi — `addResult` ikkinchi qator yozmaydi va
 * BIRINCHI natijani qaytaradi, ya'ni javob ikkala safar ham bir xil.
 * Sessiya boshiga natijalar soni `RESULT_CAP_PER_SESSION` dan oshsa —
 * 409, aniq xabar bilan.
 */
export const POST = handler("o/submit", async (req, ctx: Ctx) => {
  await ensureMigrated();
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);

  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) throw new ApiError("Topilmadi", 404);

  const ip = clientIp(req);
  await limit(`o:submit:${token}:${ip}`, SUBMIT_PER_MINUTE, IP_LIMITS.submitPerGamePerIp.windowSec);
  await limit(`o:submit:${ip}`, IP_LIMITS.submitPerIp.count, IP_LIMITS.submitPerIp.windowSec);

  const body = await readJson<{ name?: unknown; answers?: unknown; seconds?: unknown; submissionId?: unknown }>(req, 200_000);

  const session = await getGameSessionByToken(token);
  if (!session || !session.doc || session.status !== "COMPLETED") throw new ApiError("Topilmadi", 404);

  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, PLAYER_NAME_MAX);
  if (!name) throw new ApiError("Ismingizni kiriting", 400);

  /*
   * submissionId (Sharh R3): BO'SH bo'lsa serverda o'zi yaratamiz —
   * deploy paytida eski (oldindan yuklangan) sahifadagi o'quvchi bu
   * maydonni umuman yubormaydi, uni 400 bilan qaytarish esa urinishning
   * o'zini yo'qotardi (dedupe/cap saqlanadi, faqat RETRY endi bu
   * urinish bilan qayta yozmaydi — eski klient qayta yuborsa yangi
   * qator ochiladi, xuddi submissionId kiritilishidan OLDINGI kabi).
   * Kichik harfga: regex `/i` bo'lsa ham UNIQUE indeks registrga sezgir
   * (`addResult` ham buni takrorlaydi — mudofaa ikki qatlamda).
   */
  const rawSubmissionId = String(body.submissionId ?? "").trim().toLowerCase();
  const submissionId = rawSubmissionId || randomUUID();
  if (!SUBMISSION_ID_RE.test(submissionId)) throw new ApiError("Noto'g'ri so'rov", 400);

  const answers: PlayerAnswers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? (body.answers as PlayerAnswers) : {};
  const seconds = Number(body.seconds);

  const scored = scoreAnswers(session.doc, session.kind, answers);
  let result;
  try {
    result = await addResult({
      sessionId: session.id,
      submissionId,
      playerName: name,
      score: scored.score,
      total: scored.total,
      seconds: Number.isFinite(seconds) ? seconds : 0,
      /*
       * `answers_json` da ELEMENT BO'YICHA to'g'ri/xato saqlanadi (javob
       * matni emas): o'qituvchi «qaysi savolda ko'pchilik yiqildi» ni
       * ko'radi, jadval esa o'yinning javoblarini takrorlamaydi.
       */
      answers: { results: scored.results, seconds: Number.isFinite(seconds) ? seconds : 0 },
      ipHash: ipHash(ip),
    });
  } catch (e) {
    if (e instanceof ResultCapError) throw new ApiError(e.message, 409, { code: "result_cap" });
    throw e;
  }

  /*
   * Javobda FAQAT ball: to'g'ri javoblar ro'yxati qaytarilsa, o'quvchi
   * bitta urinishdan keyin hammasini bilib olardi va havolani
   * do'stlariga to'liq javob bilan uzatardi. `result` — YOZILGAN (yoki
   * takroriy so'rovda AVVAL yozilgan) qator, qayta hisoblangan `scored`
   * emas: retry har doim BIR XIL javob olishi shart.
   */
  return json({ score: result.score, total: result.total, percent: scorePercent(result) });
});
