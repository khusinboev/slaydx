import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { clientIp } from "@/lib/server/ratelimit";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { addResult, getGameSessionByToken, ipHash, PLAYER_NAME_MAX, TOKEN_RE } from "@/lib/server/game-sessions";
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
 */
export const POST = handler("o/submit", async (req, ctx: Ctx) => {
  await ensureMigrated();
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);

  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) throw new ApiError("Topilmadi", 404);

  const ip = clientIp(req);
  await limit(`o:submit:${token}:${ip}`, SUBMIT_PER_MINUTE, IP_LIMITS.submitPerGamePerIp.windowSec);
  await limit(`o:submit:${ip}`, IP_LIMITS.submitPerIp.count, IP_LIMITS.submitPerIp.windowSec);

  const body = await readJson<{ name?: unknown; answers?: unknown; seconds?: unknown }>(req, 200_000);

  const session = await getGameSessionByToken(token);
  if (!session || !session.doc || session.status !== "COMPLETED") throw new ApiError("Topilmadi", 404);

  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, PLAYER_NAME_MAX);
  if (!name) throw new ApiError("Ismingizni kiriting", 400);

  const answers: PlayerAnswers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? (body.answers as PlayerAnswers) : {};
  const seconds = Number(body.seconds);

  const scored = scoreAnswers(session.doc, session.kind, answers);
  await addResult({
    sessionId: session.id,
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

  /*
   * Javobda FAQAT ball: to'g'ri javoblar ro'yxati qaytarilsa, o'quvchi
   * bitta urinishdan keyin hammasini bilib olardi va havolani
   * do'stlariga to'liq javob bilan uzatardi.
   */
  return json({ score: scored.score, total: scored.total, percent: scorePercent(scored) });
});
