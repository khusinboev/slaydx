import { ApiError, handler, json } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { getGameSessionByToken, TOKEN_RE } from "@/lib/server/game-sessions";
import { publicGameView } from "@/lib/game/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * OCHIQ O'YIN MA'LUMOTI (loginsiz) — egasi qarori 8.
 *
 * `requireUser` YO'Q va bo'lmasligi kerak: havolani olgan o'quvchi
 * ro'yxatdan o'tmaydi. Shuning uchun bu yerda ikkita himoya qoladi:
 *
 *   1. TOKEN — 128 bitlik sir (`game-sessions.ts TOKEN_CHARS`), ya'ni
 *      havolani bilmagan odam o'yinni topa olmaydi;
 *   2. `publicGameView` — TO'G'RI JAVOB CHIQMAYDI. Bu shu route'ning
 *      butun xavfsizlik modeli: javob ochiq JSON da ketardi va uni
 *      har qanday o'quvchi DevTools da ko'rardi.
 *
 * `null` (token yo'q, muddati o'tgan, hujjat o'yin emas) — 404, sabab
 * AYTILMAYDI: mavjud tokenni mavjud bo'lmaganidan farqlash havolalarni
 * taxmin qilishni osonlashtirardi.
 */
export const GET = handler("o/get", async (req, ctx: Ctx) => {
  // `requireUser` chaqirilmaydi, ya'ni migratsiyani O'ZIMIZ kafolatlaymiz.
  await ensureMigrated();
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) throw new ApiError("Topilmadi", 404);

  const session = await getGameSessionByToken(token);
  if (!session || !session.doc || session.status !== "COMPLETED") throw new ApiError("Topilmadi", 404);

  const view = publicGameView(session.doc, session.kind, { seed: token });
  if (!view) throw new ApiError("Topilmadi", 404);

  return json({
    game: view,
    // Sarlavha — o'yinchi sahifasining tepasi (mavzu allaqachon `view.title` da).
    title: session.topic || view.title,
    kind: session.kind,
  });
});
