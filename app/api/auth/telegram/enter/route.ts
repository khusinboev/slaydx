import { NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/server/db";
import { redeemLoginToken } from "@/lib/server/telegram";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bir martalik kirish havolasi — botdan keladi.
 *
 *   GET /api/auth/telegram/enter?t=<token>
 *
 * Sessiya SHU so'rovni yuborgan brauzerda ochiladi. Havola esa faqat
 * foydalanuvchining Telegram chatiga borgan, ya'ni «o'z chiptasini
 * qurbonga yuborish» hujumi ishlamaydi: tajovuzkorning brauzeri
 * tokenni umuman ko'rmaydi.
 *
 * Nega GET va nega `checkOrigin` yo'q: havola Telegram ilovasidan
 * ochiladi, ya'ni bu oddiy navigatsiya — `Origin` sarlavhasi bo'lmaydi
 * va CSRF tekshiruvi bu yerda o'rinsiz. Himoyani tokenning o'zi beradi:
 * u tasodifiy 32 bayt, xesh holida saqlanadi, BIR MARTALIK va 5 daqiqada
 * eskiradi. Bu — magic link naqshining standart shakli.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const base = env.appUrl || url.origin;
  const fail = (why: string) =>
    NextResponse.redirect(`${base}/uz/login?xato=${encodeURIComponent(why)}`, 303);

  try {
    await ensureMigrated();

    // Tokenni taxmin qilib bo'lmaydi, lekin urinishlar oqimini baribir
    // cheklaymiz — bo'sh urinishlar bazani bezovta qilmasin.
    const ip = clientIp(req);
    if (!(await rateLimit(`enter:${ip}`, 30, 300)).ok) {
      return fail("Juda ko'p urinish. Bir oz kuting.");
    }

    const result = await redeemLoginToken(token);
    if (!result.ok) {
      return fail(
        result.reason === "expired"
          ? "Havola eskirgan yoki allaqachon ishlatilgan. Qaytadan urinib ko'ring."
          : "Havola yaroqsiz.",
      );
    }

    const { token: sessionToken, expiresAt } = await createSession(result.user.id, {
      userAgent: req.headers.get("user-agent"),
      ip,
    });
    await setSessionCookie(sessionToken, expiresAt);
    return NextResponse.redirect(`${base}/uz`, 303);
  } catch (e) {
    console.error("[auth/enter]", e instanceof Error ? e.message : e);
    return fail("Kirishda xatolik. Qaytadan urinib ko'ring.");
  }
}
