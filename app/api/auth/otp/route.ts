import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import {
  consumeLoginCode,
  issueLoginCode,
  normalizeIdentifier,
  upsertLocalUser,
} from "@/lib/server/auth";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { clientIp } from "@/lib/server/ratelimit";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Zaxira kirish: 5 xonali bir martalik kod.
 *
 * Ilgari LoginModal da istalgan 5 ta raqam kiritilsa kirilardi — ya'ni
 * hech qanday tekshiruv yo'q edi. Endi kod serverda yaratiladi, hash
 * holida saqlanadi, 2 daqiqada eskiradi va 5 urinishdan keyin o'ladi.
 *
 * Kodni yetkazish (OTP bot / SMS) hali ulanmagan: `DEV_LOGIN_ENABLED=1`
 * bo'lsa kod javobda qaytariladi. Prod da bu bayroq yoqilsa,
 * `assertRuntimeConfig()` ogohlantiradi va kod hech qachon oshkor bo'lmaydi.
 */

type RequestBody = { identifier?: string };
type VerifyBody = { identifier?: string; code?: string };

export const POST = handler("auth/otp", async (req) => {
  await ensureMigrated();
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);

  // Kodni yetkazadigan kanal yo'q bo'lsa endpoint umuman ishlamaydi.
  //
  // Ilgari u kod yaratib, «yuborildi» derdi — foydalanuvchi hech qachon
  // kelmaydigan kodni kutardi, baza esa foydasiz qatorlar bilan to'lardi.
  if (!env.devLoginEnabled) {
    throw new ApiError(
      "Telefon orqali kirish hali ulanmagan. Telegram orqali kiring.",
      503,
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") === "verify" ? "verify" : "request";
  const ip = clientIp(req);

  if (action === "request") {
    const body = await readJson<RequestBody>(req, 4_000);
    const identifier = normalizeIdentifier(String(body.identifier ?? ""));
    if (identifier.length < 3) throw new ApiError("Telefon yoki foydalanuvchi nomini kiriting", 400);

    // Ikki qatlam: bitta raqamga spam va bitta IP dan ko'p raqamga so'rov.
    await limit(`otp:req:${identifier}`, 3, 600);
    await limit(`otp:ip:${ip}`, 15, 600);

    const code = await issueLoginCode(identifier);
    return json({ sent: true, delivery: "dev", devCode: code });
  }

  const body = await readJson<VerifyBody>(req, 4_000);
  const identifier = normalizeIdentifier(String(body.identifier ?? ""));
  const code = String(body.code ?? "");
  if (!identifier) throw new ApiError("Identifikator yo'q", 400);

  await limit(`otp:verify:${identifier}`, 10, 600);
  await limit(`otp:verify:ip:${ip}`, 30, 600);

  const check = await consumeLoginCode(identifier, code);
  if (!check.ok) {
    const message =
      check.reason === "expired"
        ? "Kod muddati tugagan — yangisini so'rang"
        : check.reason === "attempts"
          ? "Urinishlar tugadi — yangi kod so'rang"
          : "Kod noto'g'ri";
    throw new ApiError(message, 401);
  }

  const user = await upsertLocalUser(identifier);
  const { token, expiresAt } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });
  await setSessionCookie(token, expiresAt);
  return json({ user });
});
