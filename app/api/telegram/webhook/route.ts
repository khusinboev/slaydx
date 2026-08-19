import { NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/session";
import { botConfigured, handleUpdate, type TelegramUpdate } from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram webhook (prod uchun).
 *
 * Lokal ishlab chiqishda ochiq HTTPS manzil bo'lmaydi — u yerda
 * `npm run bot` long-polling rejimida ishlaydi. Ikkalasi ham bir xil
 * `handleUpdate` ni chaqiradi.
 *
 * Himoya: `setWebhook` da o'rnatilgan maxfiy sarlavha tekshiriladi,
 * aks holda har kim soxta update yuborishi mumkin edi.
 */
export async function POST(req: Request) {
  if (!botConfigured()) return NextResponse.json({ ok: true });

  // `CRON_SECRET` majburiy.
  //
  // Ilgari u yo'q bo'lsa `SESSION_SECRET` ga tushardi — ya'ni sessiya
  // imzo kaliti Telegram sozlamalariga ko'chirilardi va u yerdan sizib
  // chiqsa barcha sessiyalarni qalbakilashtirish mumkin bo'lardi.
  if (!env.cronSecret) {
    console.error("[telegram/webhook] CRON_SECRET sozlanmagan — webhook o'chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!got || !safeEqual(got, env.cronSecret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    await ensureMigrated();
    const update = (await req.json()) as TelegramUpdate;
    await handleUpdate(update);
  } catch (e) {
    // Telegram 200 dan boshqasini olsa update ni qayta-qayta yuboradi.
    console.error("[telegram/webhook]", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
