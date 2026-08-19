import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";
import { ensureMigrated } from "./db";
import { currentUser, type SessionUser } from "./session";
import { clientIp, rateLimit } from "./ratelimit";

/**
 * Route handler'lar uchun umumiy yordamchi: migratsiya, sessiya,
 * rate limit, CSRF va xato formati bir joyda.
 */

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Kutilmagan xatoni javobga chiqarmaydi.
 *
 * Ilgari `/api/generate` `e.message` ni to'g'ridan-to'g'ri qaytarardi —
 * bu ichki yo'llar va provayder xabarlarini oshkor qilishi mumkin edi.
 */
export function serverError(scope: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[${scope}]`, message);
  return NextResponse.json(
    {
      error: "Ichki xatolik. Birozdan keyin qayta urinib ko'ring.",
      ...(env.isProd ? {} : { detail: message }),
    },
    { status: 500 },
  );
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * Holat o'zgartiruvchi so'rovlar uchun CSRF tekshiruvi.
 *
 * Ilgari bu funksiya `Origin` yo'q bo'lsa `true` qaytarardi. Bu
 * `SameSite=Lax` bilan yetarli edi, lekin Telegram Mini App uchun
 * `SameSite=None` yoqilsa cookie cross-site so'rovlarda ham yuboriladi
 * va Origin tekshiruvi **yagona** CSRF himoyasiga aylanadi. Shuning
 * uchun endi qat'iy:
 *
 *   - `Sec-Fetch-Site` bo'lsa (barcha zamonaviy brauzerlar yuboradi),
 *     `same-origin` yoki `none` bo'lishi shart;
 *   - `Origin` bo'lsa, u bizning domenimiz bo'lishi shart;
 *   - ikkalasi ham yo'q bo'lsa — bu brauzer emas (curl, server-to-server),
 *     bunday so'rovda cookie ham bo'lmaydi, shuning uchun xavf yo'q.
 */
export function checkOrigin(req: Request): boolean {
  // Brauzer bu sarlavhani soxtalashtira olmaydi (forbidden header).
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = req.headers.get("origin");
  if (!origin) return true;

  let originHost: string;
  let originFull: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    originHost = parsed.host;
    originFull = parsed.origin;
  } catch {
    return false;
  }

  // 1) Origin so'rov kelgan Host bilan bir xilmi.
  //
  // Bu «same-origin» ning ta'rifi va u yerda CSRF xavfi yo'q: boshqa
  // domendan kelgan so'rovda brauzer bizning cookie'mizni yubormaydi,
  // chunki cookie o'z domeniga bog'langan.
  //
  // Bu shart bo'lmasa sayt faqat `APP_URL` dagi manzilda ishlardi:
  // `127.0.0.1`, tarmoq IP si yoki prod'dagi `www` varianti — hammasi
  // 403 berardi.
  const host = req.headers.get("host");
  if (host && originHost === host) return true;

  // 2) Yoki ochiq ruxsat etilgan manzillardan biri.
  //
  // Bu yerda sxema ham tekshiriladi: sozlamada `https://` yozilgan
  // bo'lsa, `http://` variant o'tmasligi kerak.
  for (const allowed of allowedOrigins()) {
    if (allowed.startsWith("http")) {
      if (originFull === allowed) return true;
    } else if (originHost === allowed) {
      return true;
    }
  }
  return false;
}

/** `APP_URL` va `ALLOWED_ORIGINS` — to'liq origin yoki faqat host. */
function allowedOrigins(): string[] {
  const out: string[] = [];
  for (const raw of [env.appUrl, ...env.allowedOrigins]) {
    if (!raw) continue;
    try {
      out.push(new URL(raw).origin);
    } catch {
      // Sxemasiz yozilgan bo'lishi mumkin: «example.uz».
      out.push(raw.replace(/^\/+|\/+$/g, ""));
    }
  }
  return out;
}

export type AuthedContext = {
  user: SessionUser;
  ip: string;
};

/**
 * Sessiyani talab qiladi. Kirish bo'lmasa 401.
 *
 * Bu funksiya `/api/generate` ni ochiq qoldirmaslik uchun bor: ilgari
 * endpoint autentifikatsiyasiz edi va har kim pullik LLM chaqiruvini
 * cheksiz ishga tushira olardi.
 */
export async function requireUser(req: Request): Promise<AuthedContext> {
  await ensureMigrated();
  // CSRF faqat holat o'zgartiruvchi metodlarga tegishli. GET ni ham
  // bloklasak, Telegram'dan yuborilgan yuklab olish havolasi ishlamay
  // qolardi (u yerda `Sec-Fetch-Site: cross-site` bo'ladi).
  if (req.method !== "GET" && req.method !== "HEAD" && !checkOrigin(req)) {
    throw new ApiError("So'rov manbasi noto'g'ri", 403);
  }
  const user = await currentUser();
  if (!user) throw new ApiError("Kirish talab qilinadi", 401);
  return { user, ip: clientIp(req) };
}

/** Sessiya ixtiyoriy bo'lgan endpointlar uchun. */
export async function optionalUser(req: Request): Promise<{ user: SessionUser | null; ip: string }> {
  await ensureMigrated();
  const user = await currentUser().catch(() => null);
  return { user, ip: clientIp(req) };
}

export async function limit(
  key: string,
  count: number,
  windowSec: number,
): Promise<void> {
  const res = await rateLimit(key, count, windowSec);
  if (!res.ok) {
    throw new ApiError(
      `Juda ko'p so'rov. ${res.retryAfterSec} soniyadan keyin urinib ko'ring.`,
      429,
      { retryAfter: res.retryAfterSec },
    );
  }
}

/** Route handler'ni o'raydi: `ApiError` ni to'g'ri statusga aylantiradi. */
export function handler<A extends unknown[]>(
  scope: string,
  fn: (req: Request, ...args: A) => Promise<Response>,
) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      if (e instanceof ApiError) {
        const headers: Record<string, string> = {};
        if (e.status === 429 && typeof e.extra.retryAfter === "number") {
          headers["Retry-After"] = String(e.extra.retryAfter);
        }
        return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status, headers });
      }
      return serverError(scope, e);
    }
  };
}

/** JSON body ni xavfsiz o'qiydi (hajm chegarasi bilan). */
export async function readJson<T = unknown>(req: Request, maxBytes = 1_000_000): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new ApiError("So'rov hajmi juda katta", 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError("So'rov hajmi juda katta", 413);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("Noto'g'ri JSON", 400);
  }
}
