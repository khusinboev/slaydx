import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { createGameSession, listGameSessions } from "@/lib/server/game-sessions";
import { getGeneration } from "@/lib/server/jobs";
import { publicGameKindOf, publicGameView } from "@/lib/game/public";
import { gamePath } from "@/lib/game/qr";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Havolaning TO'LIQ manzili.
 *
 * `APP_URL` birinchi: prodda QR aynan shu domenga ishora qilishi kerak.
 * U bo'lmasa (dev, tarmoq IP si) so'rovning `Host` i ishlatiladi —
 * o'qituvchi telefonidan ochiladigan havola `localhost` bo'lib
 * qolmasin.
 */
export function shareUrl(req: Request, token: string): string {
  const path = gamePath(token);
  if (env.appUrl) return `${env.appUrl}${path}`;
  try {
    return new URL(path, req.url).toString();
  } catch {
    return path;
  }
}

/**
 * O'YIN HAVOLASINI YARATADI (egasi).
 *
 * Egalik ikki qavat: `requireUser` + `createGameSession` ichidagi
 * `WHERE g.user_id = $` (SQL darajasida — AUDIT-4 N-1 qoidasi).
 *
 * Har chaqiruv YANGI havola beradi: o'qituvchi ayni o'yinni ikki sinfga
 * ikki havola bilan tarqatib, natijalarni alohida ko'ra olishi kerak
 * (shuning uchun token generatsiyada emas, `game_sessions` da).
 */
export const POST = handler("generations/share", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  // Havola yaratish arzon, lekin cheksiz emas: bitta hujjatga yuzlab
  // token yasash natijalar panelini ma'nosiz qilardi.
  await limit(`share:${user.id}`, 30, 3600);

  const gen = await getGeneration(id, user.id);
  if (!gen) throw new ApiError("Topilmadi", 404);
  if (gen.status !== "COMPLETED") throw new ApiError("O'yin hali tayyor emas", 409);

  /*
   * Faqat O'YNALADIGAN vositalar: podkast yoki referatning ochiq
   * havolasi hech narsa bermaydi va uni «ulashish» deb ko'rsatish
   * foydalanuvchini adashtirardi.
   */
  const kind = publicGameKindOf(gen.type);
  if (!kind) throw new ApiError("Bu vosita uchun o'yin havolasi yo'q", 400);

  /*
   * BEA-10: vosita turi O'YNALADIGAN bo'lsa ham, HUJJATNING O'ZIDA
   * o'ynaladigan element bo'lmasligi mumkin (masalan faqat "Ochiq
   * savol"/"Moslashtirish" turlaridan tuzilgan test — `publicGameView`
   * ularni chiqarmaydi, chunki serverda avtomatik baholab bo'lmaydi).
   * Bunday holda havola berilmasin: aks holda har o'quvchi
   * `/api/o/[token]` da 404 ga uchraydi va o'qituvchi buni faqat
   * darsda bilib oladi.
   */
  if (!gen.doc || !publicGameView(gen.doc, kind)) {
    throw new ApiError(
      "Bu hujjatda o'ynaladigan savol yo'q (faqat bitta/ko'p tanlov va to'g'ri/noto'g'ri turlari o'ynaladi)",
      409,
      { code: "not_playable" },
    );
  }

  const session = await createGameSession(id, user.id, kind);
  if (!session) throw new ApiError("Topilmadi", 404);

  return json({ token: session.token, url: shareUrl(req, session.token), kind: session.kind, expiresAt: session.expiresAt });
});

/** Mavjud havolalar (panel ularni qayta yaratmasdan ko'rsatishi uchun). */
export const GET = handler("generations/share-list", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
  const sessions = await listGameSessions(id, user.id);
  return json({
    sessions: sessions.map((s) => ({ token: s.token, url: shareUrl(req, s.token), kind: s.kind, createdAt: s.createdAt, expiresAt: s.expiresAt })),
  });
});
