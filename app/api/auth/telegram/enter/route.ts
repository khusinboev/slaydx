import { NextResponse } from "next/server";
import { checkOrigin } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { peekLoginToken, redeemLoginToken } from "@/lib/server/telegram";
import { createSession, currentUser, revokeCurrentSession, setSessionCookie } from "@/lib/server/session";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { env } from "@/lib/server/env";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { peekRate } from "@/lib/server/rate-peek";
import { BRAND_NAME } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bir martalik kirish havolasi — botdan keladi. IKKI qadam (SECA-05):
 *
 *   GET  /api/auth/telegram/enter?t=<token>  → tasdiqlash sahifasi
 *        «Siz <ism> sifatida kirmoqdasiz» + «Kirish» tugmasi.
 *        Token SARFLANMAYDI, sessiya OCHILMAYDI.
 *   POST /api/auth/telegram/enter  (t=<token>, faqat shu sahifadan —
 *        `checkOrigin`) → token sarflanadi, sessiya ochiladi.
 *
 * Nega: havola Telegram chatiga boradi, lekin chat egasi uni BOSHQAGA
 * yuborishi mumkin. Botga `/login` yozgan tajovuzkor o'z akkauntiga
 * havola olib, qurbonga «shu yerdan kiring» deydi — ilgari GET darhol
 * kirardi va qurbon bilmay tajovuzkor akkauntida ishlardi (rezyume,
 * surat, to'lov — hammasi tajovuzkorga). Endi qurbon kimning nomi bilan
 * kirayotganini ko'radi va brauzerda boshqa akkaunt ochiq bo'lsa
 * ogohlantiriladi. Tasdiqlashni boshqa sayt avtomatik yubora olmaydi
 * (Origin), sahifani iframe'ga ham qo'ya olmaydi (CSP `frame-ancestors`).
 *
 * GET da `checkOrigin` yo'q: havola Telegram ilovasidan ochiladi —
 * oddiy navigatsiya. Himoyani tokenning o'zi beradi: tasodifiy 32 bayt,
 * xesh holida saqlanadi, BIR MARTALIK va 5 daqiqada eskiradi. Qo'shimcha
 * foyda: havolani oldindan ochuvchi (link preview, antivirus skaneri)
 * endi uni «yeb» qo'ymaydi.
 */

type RateGate = { ip: string; failBucket: string; blocked: boolean };

/**
 * Tokenni taxmin qilib bo'lmaydi, lekin urinishlar oqimini baribir
 * cheklaymiz (C29): IP bo'yicha keng shift (NAT ortida yuzlab
 * muvaffaqiyatli kirish) va FAQAT yaroqsiz tokenlar uchun qat'iy
 * chegara. Keng shift faqat POST da SANALADI — GET uni ko'radi xolos,
 * aks holda bitta kirish ikki marta sanalib, NAT sig'imi yarmiga tushardi.
 */
async function gate(req: Request, count: boolean): Promise<RateGate> {
  const ip = clientIp(req);
  const { enterPerIp, enterFailPerIp } = IP_LIMITS;
  const failBucket = `enter:fail:${ip}`;
  const wide = count
    ? await rateLimit(`enter:${ip}`, enterPerIp.count, enterPerIp.windowSec)
    : await peekRate(`enter:${ip}`, enterPerIp.count, enterPerIp.windowSec);
  const blocked = !wide.ok || !(await peekRate(failBucket, enterFailPerIp.count, enterFailPerIp.windowSec)).ok;
  return { ip, failBucket, blocked };
}

async function countFailure(g: RateGate): Promise<void> {
  const { enterFailPerIp } = IP_LIMITS;
  await rateLimit(g.failBucket, enterFailPerIp.count, enterFailPerIp.windowSec);
}

function baseUrl(req: Request): string {
  return env.appUrl || new URL(req.url).origin;
}

function failRedirect(req: Request, why: string): NextResponse {
  return NextResponse.redirect(`${baseUrl(req)}/uz/login?xato=${encodeURIComponent(why)}`, 303);
}

/**
 * POST javobidagi yo'naltirish — NISBIY `Location` (sahifa qaysi hostda
 * ochilgan bo'lsa, o'sha hostda qoladi). `APP_URL` dan farqli host
 * (`www`, IP) da forma yuborilgach absolyut boshqa-origin yo'naltirishni
 * CSP `form-action 'self'` to'sardi (review N4).
 */
function localRedirect(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "private, no-store" } });
}

function localFail(why: string): Response {
  return localRedirect(`/uz/login?xato=${encodeURIComponent(why)}`);
}

/** Tana eng ko'pi `max` bayt — `Content-Length` siz (chunked) tana ham oqim bo'yicha kesiladi (review N3). */
async function readSmallBody(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const MAX_FORM_BYTES = 4096;

const EXPIRED = "Havola eskirgan yoki allaqachon ishlatilgan. Qaytadan urinib ko'ring.";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Tasdiqlash sahifasi — skriptsiz, bitta forma (CSP `form-action 'self'`). */
function confirmPage(token: string, who: { name: string; username: string | null }, other: string | null): string {
  const handle = who.username ? ` (@${esc(who.username)})` : "";
  const warning = other
    ? `<p class="warn">Diqqat: bu brauzerda hozir boshqa akkaunt ochiq — <b>${esc(other)}</b>. ` +
      `Davom etsangiz, undan chiqasiz. Havolani sizga boshqa odam yuborgan bo'lsa — kirmang.</p>`
    : `<p class="muted">Bu siz bo'lmasangiz yoki havolani sizga boshqa odam yuborgan bo'lsa — kirmang.</p>`;
  return `<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Kirishni tasdiqlang — ${esc(BRAND_NAME)}</title>
<style>
:root{--bg:#fbf6ee;--card:#fffdf9;--fg:#2b2013;--muted:#6b5540;--border:#ecdfc9;--primary:#f59e0b;--primary-fg:#1c1406;--warn-bg:#fdecea;--warn-fg:#8a1c1c}
@media (prefers-color-scheme: dark){:root{--bg:#121014;--card:#1c1a17;--fg:#f3ece2;--muted:#a89a86;--border:#2e2820;--warn-bg:#3a1d1d;--warn-fg:#fca5a5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px}
h1{font-size:20px;margin:0 0 12px}p{margin:0 0 16px}.muted{color:var(--muted);font-size:14px}
.warn{background:var(--warn-bg);color:var(--warn-fg);border-radius:10px;padding:10px 12px;font-size:14px}
button{width:100%;border:0;border-radius:10px;padding:12px 16px;font:inherit;font-weight:600;background:var(--primary);color:var(--primary-fg);cursor:pointer}
a{display:block;text-align:center;margin-top:12px;color:var(--muted);font-size:14px}
</style></head>
<body><main>
<h1>${esc(BRAND_NAME)} — kirish</h1>
<p>Siz <b>${esc(who.name)}</b>${handle} sifatida kirmoqdasiz.</p>
${warning}
<form method="post" action="/api/auth/telegram/enter">
<input type="hidden" name="t" value="${esc(token)}">
<button type="submit">Kirish</button>
</form>
<a href="/uz">Bekor qilish</a>
</main></body></html>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  try {
    await ensureMigrated();
    const g = await gate(req, false);
    if (g.blocked) return failRedirect(req, "Juda ko'p urinish. Bir oz kuting.");

    const who = await peekLoginToken(token);
    if (!who) {
      await countFailure(g);
      return failRedirect(req, EXPIRED);
    }

    const current = await currentUser().catch(() => null);
    // Brauzer allaqachon AYNAN shu akkauntda — tasdiqlashga hojat yo'q.
    if (current && current.telegramId === who.telegramId) {
      return NextResponse.redirect(`${baseUrl(req)}/uz`, 303);
    }
    return new NextResponse(confirmPage(token, who, current ? current.name : null), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        /*
         * `Referrer-Policy` ni bu yerda QO'YMAYMIZ (review, SECA-05): global
         * `strict-origin-when-cross-origin` (next.config.ts) yetarli —
         * sahifada faqat o'z havolalarimiz, boshqa-origin so'rovga faqat
         * origin ketadi. `no-referrer` esa XAVFLI: Fetch spec bo'yicha shunday
         * sahifadan yuborilgan POST `Origin: null` bilan ketadi va
         * `checkOrigin` «Kirish» ni hamma uchun 403 qiladi.
         */
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    console.error("[auth/enter]", e instanceof Error ? e.message : e);
    return failRedirect(req, "Kirishda xatolik. Qaytadan urinib ko'ring.");
  }
}

export async function POST(req: Request) {
  // Tasdiqlashni FAQAT o'z sahifamiz yuboradi — boshqa sayt avtomatik
  // forma bilan qurbonni tajovuzkor akkauntiga kirita olmaydi.
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "So'rov manbasi noto'g'ri" }, { status: 403 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) {
    return NextResponse.json({ error: "So'rov hajmi juda katta" }, { status: 413 });
  }
  try {
    await ensureMigrated();
    const g = await gate(req, true);
    if (g.blocked) return localFail("Juda ko'p urinish. Bir oz kuting.");

    const body = await readSmallBody(req, MAX_FORM_BYTES);
    if (body === null) return NextResponse.json({ error: "So'rov hajmi juda katta" }, { status: 413 });
    // Buzuq forma — token bo'sh, pastda «yaroqsiz» sifatida sanaladi.
    const token = new URLSearchParams(body).get("t") ?? "";

    const result = await redeemLoginToken(token);
    if (!result.ok) {
      await countFailure(g);
      return localFail(result.reason === "expired" ? EXPIRED : "Havola yaroqsiz.");
    }

    // Brauzerdagi oldingi sessiya (boshqa YOKI shu akkaunt) bazada ham
    // yopiladi — cookie ustidan yozilgani yetmaydi: eski token tirik qolardi
    // (review N5). Cookie bo'lmasa hech narsa qilmaydi.
    await revokeCurrentSession();

    const { token: sessionToken, expiresAt } = await createSession(result.user.id, {
      userAgent: req.headers.get("user-agent"),
      ip: g.ip,
    });
    await setSessionCookie(sessionToken, expiresAt);
    return localRedirect("/uz");
  } catch (e) {
    console.error("[auth/enter]", e instanceof Error ? e.message : e);
    return localFail("Kirishda xatolik. Qaytadan urinib ko'ring.");
  }
}
